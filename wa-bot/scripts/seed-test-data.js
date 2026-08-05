#!/usr/bin/env node
/**
 * Test data generation script
 *
 * Write test receipts and registration records covering all states to the data/ directory,
 * Used for admin UI verification (not relying on real WhatsApp messages).
 *
 * usage:
 *   node wa-bot/scripts/seed-test-data.js #Write test data
 *   node wa-bot/scripts/seed-test-data.js --clean # Clear the written test data
 *
 * Notice:
 *   - The script must be run from the project root directory (ClaimFlow/)
 *   - written records are marked with __seed: true, --clean only deletes marked records
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── Path correction ────────────────────────────────────────────────────────────
//
// receiptStore default DATA_DIR (4 levels up from wa-bot/src/services) when developing locally
// It will be resolved to the parent directory of ClaimFlow, which is inconsistent with the actual data directory.
// Override environment variables and point to ClaimFlow/data/
//
const PROJECT_ROOT = path.resolve(__dirname, '../../');
process.env.DATA_DIR = path.join(PROJECT_ROOT, 'data');

// Set DATA_DIR before require to ensure that the module uses the correct path
const ExcelJS      = require('exceljs');
const receiptStore = require('../src/services/receiptStore');
const excelService = require('../src/services/excelService');

// ─── Test image (minimum legal JPEG, avoid relying on real image files)───────────────────────────
//
// This is a base64 of a 1x1 pixel white JPEG used to populate the images/ directory.
// The management background can render normally (display a small picture), and it does not need to be a real receipt picture.
//
const DUMMY_IMAGE_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAg' +
  'IBBQEAAAAAAAAAAAAAAQIDBAUREiExQf/EABUBAQEAAAAAAAAAAAAAAAAAAAEC/8QAFBEB' +
  'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqGdmMl32RJVI5jqO42Zo3a8AAAA=';

// ─── Test record definition ─────────────────────────────────────────────────────────

const SEED_REGISTRATIONS = [
  { phone: '60123456001@c.us', ic: '900101-14-5001' },
  { phone: '60123456002@c.us', ic: '850615-10-1234' },
  { phone: '60123456003@c.us', ic: '751230-07-8888' },
  { phone: '60123456004@c.us', ic: '920909-08-4321' },
];

// There is one receipt for each of the four states, covering all UI display scenarios.
const SEED_RECEIPTS = [
  {
    // Status 1: The image has just been received and has not been extracted by AI yet.
    phone:  '60123456001@c.us',
    ic:     '900101-14-5001',
    status: 'pending_review',
    aiResult: null,
  },
  {
    // Status 2: AI has been extracted, waiting for manual review
    phone:  '60123456002@c.us',
    ic:     '850615-10-1234',
    status: 'ai_extracted',
    aiResult: {
      receipt_no:       'RCP-2024-00123',
      brand:            'Samsung',
      amount:           1299.00,
      qualified:        true,
      disqualify_reason: null,
      confidence:       0.95,
    },
  },
  {
    // Status 3: Manually confirmed and passed
    phone:  '60123456003@c.us',
    ic:     '751230-07-8888',
    status: 'confirmed',
    aiResult: {
      receipt_no:       'RCP-2024-00456',
      brand:            'Apple',
      amount:           5999.00,
      qualified:        true,
      disqualify_reason: null,
      confidence:       0.98,
    },
    reviewNote: 'The amount and brand meet the requirements',
  },
  {
    // Status 4: AI withdraws but the amount is insufficient and has been manually rejected
    phone:  '60123456004@c.us',
    ic:     '920909-08-4321',
    status: 'rejected',
    aiResult: {
      receipt_no:       'RCP-2024-00789',
      brand:            'Dyson',
      amount:           350.00,
      qualified:        false,
      disqualify_reason: 'Amount below RM 500 threshold',
      confidence:       0.91,
    },
    reviewNote: 'Insufficient amount, rejected',
  },
];

// ─── Write logic ────────────────────────────────────────────────────────────

async function seed() {
  console.log('📦 Start writing test seed data...\\n');
  console.log(`  DATA_DIR: ${process.env.DATA_DIR}`);

  // Initialize Excel (make sure the file exists)
  await excelService.initExcel();

  // receiptStore.addPendingReceipt writes the image before readStore()(ensureInit),
  // Therefore, you need to manually create the images directory first, otherwise ENOENT will be reported when running for the first time.
  const imagesDir = path.join(process.env.DATA_DIR, 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    console.log(`✓ Create directory: ${imagesDir}`);
  }

  // ── Write registration records to Excel ────────────────────────────────────────────────
  //
  // Do not use excelService.addRegistration(): This function repeatedly detects dependency on column key.
  // However, ExcelJS does not restore key metadata after reading xlsx from disk (key only exists in memory).
  // It is more reliable to operate the workbook directly.
  //
  console.log('\\n[1/2] Write registration record...');
  const EXCEL_PATH = path.join(process.env.DATA_DIR, 'excel', 'records.xlsx');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const regSheet = workbook.getWorksheet('Registrations');

  // Read the existing IC column to avoid repeated writing (read the 4th column by position, that is, IC Number)
  const existingICs = new Set();
  regSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const icCell = row.getCell(4);
    if (icCell.value) existingICs.add(String(icCell.value));
  });

  let addedCount = 0;
  for (const reg of SEED_REGISTRATIONS) {
    if (existingICs.has(reg.ic)) {
      console.log(`Skip (repeat): ${reg.ic}`);
      continue;
    }
    regSheet.addRow([
      regSheet.rowCount, // No (including header row)
      new Date().toISOString(),
      reg.phone,
      reg.ic,
      'Registered',
    ]);
    console.log(`  ✓ ${reg.ic}  ${reg.phone}`);
    addedCount++;
  }

  if (addedCount > 0) {
    await workbook.xlsx.writeFile(EXCEL_PATH);
  }

  // ──Write receipt to receiptStore (JSON + images)────────────────────────────────
  console.log('\\n[2/2] Write receipt record...');
  for (const receipt of SEED_RECEIPTS) {
    const { id, imageFilename } = receiptStore.addPendingReceipt(
      receipt.phone,
      DUMMY_IMAGE_BASE64,
      'image/jpeg',
      receipt.ic,
    );

    // Continue to transfer status according to target status
    if (receipt.status === 'ai_extracted' || receipt.status === 'confirmed' || receipt.status === 'rejected') {
      receiptStore.saveAiResult(id, receipt.aiResult);
    }

    if (receipt.status === 'confirmed') {
      receiptStore.confirmReceipt(id, receipt.reviewNote || '');
    }

    if (receipt.status === 'rejected') {
      receiptStore.rejectReceipt(id, receipt.reviewNote || '');
    }

    // Mark the seed in the JSON record to facilitate precise deletion by --clean
    _markAsSeed(id);

    console.log(`  ✓ [${receipt.status.padEnd(14)}] ${receipt.phone} — image: ${imageFilename}`);
  }

  console.log('\\n✅ Seed data writing completed!');
  console.log(`Receipts JSON: ${process.env.DATA_DIR}/pending_receipts.json`);
  console.log(`Register Excel: ${process.env.DATA_DIR}/excel/records.xlsx`);
  console.log('\\nNow you can visit http://<server IP>/admin to view the test data.');
}

/**
 * Append __seed tag in JSON records (for use by clean)
 * Directly manipulate JSON files, bypassing the public API of receiptStore
 */
function _markAsSeed(id) {
  const storePath = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  const records   = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  const idx       = records.findIndex((r) => r.id === id);
  if (idx !== -1) {
    records[idx].__seed = true;
    fs.writeFileSync(storePath, JSON.stringify(records, null, 2), 'utf-8');
  }
}

// ─── Clear logic ───────────────────────────────────────────────────────────

async function clean() {
  console.log('🧹 Clear test seed data...\\n');

  const storePath  = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  const imagesDir  = path.join(process.env.DATA_DIR, 'images');

  if (!fs.existsSync(storePath)) {
    console.log('pending_receipts.json does not exist, skip.');
    return;
  }

  const records  = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  const toDelete = records.filter((r) => r.__seed);
  const toKeep   = records.filter((r) => !r.__seed);

  // Delete the corresponding image file
  for (const r of toDelete) {
    const imgPath = path.join(imagesDir, r.imageFilename);
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
      console.log(`✓ Delete image: ${r.imageFilename}`);
    }
  }

  // Write back the JSON of the seed record
  fs.writeFileSync(storePath, JSON.stringify(toKeep, null, 2), 'utf-8');
  console.log(`✓ Delete ${toDelete.length} seed records from pending_receipts.json`);

  console.log('\\nNote: Excel registration records need to be deleted manually (ExcelJS does not support deleting rows).');
  console.log(`Excel path: ${process.env.DATA_DIR}/excel/records.xlsx`);
  console.log('\\n✅ Cleanup completed (except Excel).');
}

// ─── Entrance ──────────────────────────────────────────────────────────────

const isClean = process.argv.includes('--clean');

(isClean ? clean() : seed()).catch((err) => {
  console.error('❌ Script execution failed:', err.message);
  process.exit(1);
});
