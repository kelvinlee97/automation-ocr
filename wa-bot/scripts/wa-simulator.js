#!/usr/bin/env node
/**
 * wa-simulator.js — WhatsApp user flow reusable simulation tool
 *
 * Multiple named scenarios are built-in, and the messageHandler business logic is completely written into the real data/ directory.
 * The results can be seen immediately in the management backend.
 *
 * ───Usage ─────────────────────────────────────────────────────────────
 *   node wa-bot/scripts/wa-simulator.js #Run the default scenario (happy-path)
 *   node wa-bot/scripts/wa-simulator.js --scene <name> # Run the specified scene
 *   node wa-bot/scripts/wa-simulator.js --all #Run all scenarios
 *   node wa-bot/scripts/wa-simulator.js --list # View all scenarios
 *   node wa-bot/scripts/wa-simulator.js --clean # Clear all simulation data
 *
 * ─── Custom parameters (override scene default values)──────────────────────────────────────────
 *   --phone <number> Mobile phone number (pure numbers, excluding @c.us suffix)
 *   --ic <IC> Malaysian IC number
 *
 * ─── Built-in scenes ────────────────────────────────────────────────────────────
 *   happy-path normal process: issue IC → issue 1 receipt
 *   multi-receipt: send IC → send 3 receipts
 *   no-ic skips IC and sends pictures directly (ic field is null)
 *   invalid-ic sends invalid IC first → then sends legal IC → sends receipt (verification fault tolerance)
 *   duplicate-ic The same IC is registered twice (verification of deduplication logic)
 *   group-ignored simulates a group message (should be silently ignored, no data is written)
 *
 * Notice:
 *   - Must be run from the project root (ClaimFlow/)
 *   - Simulate records with __simulate: true flag, --clean only deletes records with the flag
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── Path correction (must be before require business module)───────────────────────────────────
// The default DATA_DIR of receiptStore is 4 levels upward from wa-bot/src/services, which will be resolved locally.
// ClaimFlow's parent directory. Covered by DATA_DIR and uniformly pointed to ClaimFlow/data/
const PROJECT_ROOT = path.resolve(__dirname, '../../');
process.env.DATA_DIR = path.join(PROJECT_ROOT, 'data');

const { handleMessage } = require('../src/messageHandler');
const excelService      = require('../src/services/excelService');

// ─── Smallest legal JPEG (1×1 white pixels, base64) ───────────────────────────────────
// Used for all picture messages to avoid relying on external files; the management background can render thumbnails normally
const DUMMY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAg' +
  'IBBQEAAAAAAAAAAAAAAQIDBAUREiExQf/EABUBAQEAAAAAAAAAAAAAAAAAAAEC/8QAFBEB' +
  'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqGdmMl32RJVI5jqO42Zo3a8AAAA=';

// ─── Message Factory ────────────────────────────────────────────────────────
//
// Each factory function returns a mock object that satisfies the handleMessage interface.
// Fields are aligned with whatsapp-web.js Message: from, type, hasMedia, body, timestamp, etc.
//

function makeTextMsg(waId, body) {
  return {
    from:      waId,
    body,
    type:      'chat',
    hasMedia:  false,
    fromMe:    false,
    timestamp: Math.floor(Date.now() / 1000),
    getChat:   async () => ({ isGroup: false, id: { _serialized: waId } }),
  };
}

function makeImageMsg(waId) {
  return {
    from:     waId,
    body:     '',
    type:     'image',
    hasMedia: true,
    fromMe:   false,
    timestamp: Math.floor(Date.now() / 1000),
    getChat:  async () => ({ isGroup: false, id: { _serialized: waId } }),
    downloadMedia: async () => ({ data: DUMMY_JPEG_BASE64, mimetype: 'image/jpeg' }),
  };
}

// Group message: getChat returns isGroup: true, messageHandler should be silently ignored
function makeGroupMsg(waId, body) {
  return {
    from:      waId,
    body,
    type:      'chat',
    hasMedia:  false,
    fromMe:    false,
    timestamp: Math.floor(Date.now() / 1000),
    getChat:   async () => ({ isGroup: true, id: { _serialized: `${waId}-group@g.us` } }),
  };
}

// ─── Scene definition ────────────────────────────────────────────────────────────
//
// Each scene is an object:
//   name scene unique identifier
//   desc description (--list display)
//   phone simulated mobile phone number
//   steps async step array, each step returns { label, msg } or directly an async fn(ctx)
//
// ctx contains { waId, log } for use by step functions.
//

const SCENES = [
  {
    name:  'happy-path',
    desc:  'Normal process: issue IC → issue 1 receipt',
    phone: '60100010001',
    steps: async ({ waId, log }) => {
      log('Send IC: 900101-14-5001');
      await handleMessage(makeTextMsg(waId, '900101-14-5001'));

      log('Send receipt image');
      await handleMessage(makeImageMsg(waId));
    },
  },

  {
    name:  'multi-receipt',
    desc:  'Multiple receipt process: issue IC → issue 3 receipts',
    phone: '60100020002',
    steps: async ({ waId, log }) => {
      log('Send IC: 850615-10-1234');
      await handleMessage(makeTextMsg(waId, '850615-10-1234'));

      for (let i = 1; i <= 3; i++) {
        log(`Send receipt image ${i}/3`);
        await handleMessage(makeImageMsg(waId));
      }
    },
  },

  {
    name:  'no-ic',
    desc:  'Skip IC and send pictures directly (ic field will be null, verification relaxed mode)',
    phone: '60100030003',
    steps: async ({ waId, log }) => {
      log('Send receipt image directly (no IC submitted)');
      await handleMessage(makeImageMsg(waId));
    },
  },

  {
    name:  'invalid-ic',
    desc:  'Issue invalid IC first, then issue valid IC, and finally issue receipt (verification fault tolerance and retry)',
    phone: '60100040004',
    steps: async ({ waId, log }) => {
      log('Sent invalid IC: 123456789 (should be silently ignored)');
      await handleMessage(makeTextMsg(waId, '123456789'));

      log('Invalid IC sent: ABCD-EF-GHIJ (should be silently ignored)');
      await handleMessage(makeTextMsg(waId, 'ABCD-EF-GHIJ'));

      log('Send legal IC: 751230-07-8888');
      await handleMessage(makeTextMsg(waId, '751230-07-8888'));

      log('Send receipt image');
      await handleMessage(makeImageMsg(waId));
    },
  },

  {
    name:  'duplicate-ic',
    desc:  'The same IC is registered twice (verify Excel deduplication: the second time should record the log but not report an error)',
    phone: '60100050005',
    steps: async ({ waId, log }) => {
      log('1st sending IC: 920909-08-4321');
      await handleMessage(makeTextMsg(waId, '920909-08-4321'));

      // Send the same IC again under the same session (simulating user resending)
      log('Send the same IC for the second time: 920909-08-4321 (you should be prompted to repeat but allowed to continue)');
      await handleMessage(makeTextMsg(waId, '920909-08-4321'));

      log('Send receipt image');
      await handleMessage(makeImageMsg(waId));
    },
  },

  {
    name:  'group-ignored',
    desc:  'Group messages (should be silently ignored by messageHandler, no new records in data/)',
    phone: '60100060006',
    steps: async ({ waId, log }) => {
      log('Send group text message (should be ignored)');
      await handleMessage(makeGroupMsg(waId, '900101-14-5001'));

      log('Send group picture message (should be ignored)');
      // Group image: isGroup: true, constructed directly without makeImageMsg (no downloadMedia required)
      await handleMessage({
        ...makeImageMsg(waId),
        getChat: async () => ({ isGroup: true, id: { _serialized: `${waId}-group@g.us` } }),
      });

      log('Verification: The above messages should be ignored, there are no new records in data/');
    },
  },
];

// ───Execution engine────────────────────────────────────────────────────────────

async function runScene(scene, overrides = {}) {
  const phone = overrides.phone || scene.phone;
  const waId  = `${phone}@c.us`;

  console.log(`\\n Scene: [${scene.name}] ${scene.desc}`);
  console.log(`Mobile phone: ${phone}`);

  let stepNum = 1;
  const log = (msg) => console.log(`    [${stepNum++}] ${msg}`);

  const before = countRecords();
  await scene.steps({ waId, phone, log });
  const after  = countRecords();

  const delta = after - before;
  const tag   = scene.name === 'group-ignored'
    ? (delta === 0 ? '✓ Correct: Group messages are ignored' : `✗ Exception: ${delta} records written (should be 0)`)
    : `✓ Add ${delta} receipt records`;

  console.log(`  ${tag}`);
  _markNewAsSim(before);
}

/** Read the current number of records in pending_receipts.json */
function countRecords() {
  const p = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  if (!fs.existsSync(p)) return 0;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')).length; } catch { return 0; }
}

/**
 * Mark the newly added receipt record (the part after index 0 to before-1) with __simulate
 * receiptStore is written according to unshift, and the latest record is at the head of the array.
 */
function _markNewAsSim(countBefore) {
  const p = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  if (!fs.existsSync(p)) return;
  const records = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const newCount = records.length - countBefore;
  // The newCount bar in the header is newly added this time (unshift order)
  for (let i = 0; i < newCount; i++) {
    records[i].__simulate = true;
  }
  fs.writeFileSync(p, JSON.stringify(records, null, 2), 'utf-8');
}

// ─── --clean ──────────────────────────────────────────────────────────────────

async function clean() {
  console.log('🧹 Clear all simulation data (__simulate: true)\\n');

  const storePath = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  const imagesDir = path.join(process.env.DATA_DIR, 'images');

  if (!fs.existsSync(storePath)) {
    console.log('pending_receipts.json does not exist, skip.');
    return;
  }

  const records  = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  const toDelete = records.filter((r) => r.__simulate);
  const toKeep   = records.filter((r) => !r.__simulate);

  for (const r of toDelete) {
    const imgPath = path.join(imagesDir, r.imageFilename);
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
      console.log(`✓ Delete image: ${r.imageFilename}`);
    }
  }

  fs.writeFileSync(storePath, JSON.stringify(toKeep, null, 2), 'utf-8');
  console.log(`✓ Delete ${toDelete.length} mock records from pending_receipts.json`);
  console.log('\\nNote: Excel registration records cannot be automatically deleted (ExcelJS does not support deleting rows).');
  console.log(`  Excel: ${path.join(process.env.DATA_DIR, 'excel/records.xlsx')}`);
  console.log('\\n✅ Clearance completed.');
}

// ─── --list ───────────────────────────────────────────────────────────────────

function listScenes() {
  console.log('\\nAvailable scenarios:\\n');
  for (const s of SCENES) {
    console.log(`  ${s.name.padEnd(16)} ${s.desc}`);
  }
  console.log('\\nUsage: node wa-bot/scripts/wa-simulator.js --scene <name>');
  console.log('      node wa-bot/scripts/wa-simulator.js --all\n');
}

// ─── Initialization (make sure the directory and files exist)────────────────────────────────────────────

async function ensureDataDirs() {
  await excelService.initExcel();
  const imagesDir = path.join(process.env.DATA_DIR, 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
}

// ───Command line entry ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) { listScenes(); return; }
  if (args.includes('--clean')) { await clean(); return; }

  // Parse optional override parameters
  const overrides = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phone' && args[i + 1]) overrides.phone = args[++i];
    if (args[i] === '--ic'    && args[i + 1]) overrides.ic    = args[++i];
  }

  await ensureDataDirs();

  if (args.includes('--all')) {
    console.log('🤖 Run all scenarios\\n');
    console.log(`  DATA_DIR: ${process.env.DATA_DIR}`);
    for (const scene of SCENES) {
      await runScene(scene, overrides);
    }
    console.log('\\n✅ All scenes completed. Visit /admin to view the results.');
    return;
  }

  // Specify scene
  const sceneIdx = args.indexOf('--scene');
  const sceneName = sceneIdx !== -1 ? args[sceneIdx + 1] : 'happy-path';
  const scene = SCENES.find((s) => s.name === sceneName);

  if (!scene) {
    console.error(`❌ Unknown scene: "${sceneName}". Use --list to view available scenarios.`);
    process.exit(1);
  }

  console.log('🤖 User flow simulation\\n');
  console.log(`  DATA_DIR: ${process.env.DATA_DIR}`);
  await runScene(scene, overrides);
  console.log('\\n✅ Complete. Visit /admin to view the results.');
}

main().catch((err) => {
  console.error('❌ Simulation failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
