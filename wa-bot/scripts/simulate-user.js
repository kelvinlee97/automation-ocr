#!/usr/bin/env node
/**
 * User flow simulation script
 *
 * Simulate a real user sending via WhatsApp:
 *   1. IC number (text message)
 *   2. Screenshot of receipt (picture message)
 *
 * The data is written to the real data/ directory and can be seen immediately in the management backend.
 * Complete the messageHandler → registrationHandler/receiptHandler business logic,
 * Do not mock any service layer.
 *
 * Usage (executed from the project root directory):
 *   node wa-bot/scripts/simulate-user.js
 *   node wa-bot/scripts/simulate-user.js --phone 60199887766 --ic 900101-14-5001
 *
 * Optional parameters:
 *   --phone mobile phone number (pure numbers, excluding @c.us suffix) Default: 60188887777
 *   --ic Malaysia IC number Default: 900202-14-5678
 *   --count Number of simulated receipts Default: 1
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── Path correction (must be set before require business module)────────────────────────────────
// The default DATA_DIR of receiptStore is 4 levels upward from wa-bot/src/services, which will be resolved locally.
// ClaimFlow's parent directory. Covered by DATA_DIR and uniformly pointed to ClaimFlow/data/
const PROJECT_ROOT = path.resolve(__dirname, '../../');
process.env.DATA_DIR = path.join(PROJECT_ROOT, 'data');

const { handleMessage } = require('../src/messageHandler');
const excelService      = require('../src/services/excelService');

// ─── Parsing command line parameters ────────────────────────────────────────────────────────

function parseArgs() {
  const args   = process.argv.slice(2);
  const result = {
    phone: '60188887777',
    ic:    '900202-14-5678',
    count: 1,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phone' && args[i + 1]) result.phone = args[++i];
    if (args[i] === '--ic'    && args[i + 1]) result.ic    = args[++i];
    if (args[i] === '--count' && args[i + 1]) result.count = parseInt(args[++i], 10) || 1;
  }

  // The from field format of WhatsApp messages is "mobile number@c.us"
  result.waId = `${result.phone}@c.us`;
  return result;
}

// ─── Smallest legal JPEG (1×1 white pixels) ──────────────────────────────────────────
// Avoid relying on external image files; the management background can render thumbnails normally
const DUMMY_RECEIPT_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAg' +
  'IBBQEAAAAAAAAAAAAAAQIDBAUREiExQf/EABUBAQEAAAAAAAAAAAAAAAAAAAEC/8QAFBEB' +
  'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqGdmMl32RJVI5jqO42Zo3a8AAAA=';

// ───Mock Message Factory────────────────────────────────────────────────────
//
// handleMessage expects the message object:
//   - message.from sender WhatsApp ID (format: mobile number@c.us)
//   - message.type message type ('chat' / 'image')
//   - message.hasMedia whether it contains media
//   - message.body text content
//   - message.timestamp timestamp (seconds)
//   - message.fromMe whether it was sent by yourself (filtering spontaneous messages)
//   - message.getChat() returns { isGroup: false, id: { _serialized } }
//   - message.downloadMedia() returns { data: base64, mimetype } (image messages only)
//

function makeTextMessage(waId, body) {
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

function makeImageMessage(waId) {
  return {
    from:     waId,
    body:     '',
    type:     'image',
    hasMedia: true,
    fromMe:   false,
    timestamp: Math.floor(Date.now() / 1000),
    getChat:  async () => ({ isGroup: false, id: { _serialized: waId } }),
    downloadMedia: async () => ({
      data:     DUMMY_RECEIPT_BASE64,
      mimetype: 'image/jpeg',
    }),
  };
}

// ─── Main process ─────────────────────────────────────────────────────────────

async function run() {
  const { phone, ic, waId, count } = parseArgs();

  console.log('🤖 User flow simulation\\n');
  console.log(`Mobile number: ${phone} (${waId})`);
  console.log(`  IC:     ${ic}`);
  console.log(`Number of receipts: ${count}`);
  console.log(`  DATA_DIR: ${process.env.DATA_DIR}\n`);

  // Initialize Excel (make sure the file exists, create it on first run)
  await excelService.initExcel();

  // Make sure the images directory exists (receiptStore does not guarantee that the directory has been created before writing images)
  const imagesDir = path.join(process.env.DATA_DIR, 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  // ── Step 1: Send IC number (text message)────────────────────────────────────
  console.log(`[1/2] Send IC number: ${ic}`);
  await handleMessage(makeTextMessage(waId, ic));
  console.log('✓ IC message processed\\n');

  // ── Step 2: Send receipt pictures (can be multiple)──────────────────────────────────────
  console.log(`[2/2] Send receipt pictures (${count} pictures)`);
  for (let i = 1; i <= count; i++) {
    await handleMessage(makeImageMessage(waId));
    console.log(`✓ Receipt ${i}/${count} processed`);
  }

  console.log('\\n✅ Simulation completed!');
  console.log(`   sessions.json: ${path.join(PROJECT_ROOT, 'data/sessions.json')}`);
  console.log(`   receipts JSON: ${path.join(process.env.DATA_DIR, 'pending_receipts.json')}`);
  console.log(`   Excel:         ${path.join(process.env.DATA_DIR, 'excel/records.xlsx')}`);
  console.log('\\nAccess /admin to see the newly written registration records and receipts to be reviewed.');
}

run().catch((err) => {
  console.error('❌ Simulation failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
