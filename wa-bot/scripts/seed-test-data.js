#!/usr/bin/env node
/**
 * 测试数据生成脚本
 *
 * 向 data/ 目录写入覆盖所有状态的测试收据和注册记录，
 * 供管理后台 UI 验证使用（不依赖真实 WhatsApp 消息）。
 *
 * 用法：
 *   node wa-bot/scripts/seed-test-data.js          # 写入测试数据
 *   node wa-bot/scripts/seed-test-data.js --clean  # 清除已写入的测试数据
 *
 * 注意：
 *   - 脚本必须从项目根目录运行（automation-ocr/）
 *   - 写入的记录带 __seed: true 标记，--clean 仅删除带标记的记录
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── 路径修正 ──────────────────────────────────────────────────────────────────
//
// receiptStore 默认的 DATA_DIR（从 wa-bot/src/services 向上 4 级）在本地开发时
// 会解析到 automation-ocr 的父目录，与实际数据目录不一致。
// 通过环境变量覆盖，统一指向 automation-ocr/data/
//
const PROJECT_ROOT = path.resolve(__dirname, '../../');
process.env.DATA_DIR = path.join(PROJECT_ROOT, 'data');

// 设置好 DATA_DIR 后再 require，确保模块使用正确路径
const ExcelJS      = require('exceljs');
const receiptStore = require('../src/services/receiptStore');
const excelService = require('../src/services/excelService');

// ─── 测试图片（最小合法 JPEG，避免依赖真实图片文件）──────────────────────────
//
// 这是一个 1x1 像素白色 JPEG 的 base64，用于填充 images/ 目录。
// 管理后台能正常渲染（显示小图），不需要是真实收据图片。
//
const DUMMY_IMAGE_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAg' +
  'IBBQEAAAAAAAAAAAAAAQIDBAUREiExQf/EABUBAQEAAAAAAAAAAAAAAAAAAAEC/8QAFBEB' +
  'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqGdmMl32RJVI5jqO42Zo3a8AAAA=';

// ─── 测试记录定义 ──────────────────────────────────────────────────────────────

const SEED_REGISTRATIONS = [
  { phone: '60123456001@c.us', ic: '900101-14-5001' },
  { phone: '60123456002@c.us', ic: '850615-10-1234' },
  { phone: '60123456003@c.us', ic: '751230-07-8888' },
  { phone: '60123456004@c.us', ic: '920909-08-4321' },
];

// 收据按四种状态各一条，覆盖全部 UI 展示场景
const SEED_RECEIPTS = [
  {
    // 状态 1：刚收到图片，尚未 AI 提取
    phone:  '60123456001@c.us',
    ic:     '900101-14-5001',
    status: 'pending_review',
    aiResult: null,
  },
  {
    // 状态 2：AI 已提取，等待人工审核
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
    // 状态 3：人工已确认通过
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
    reviewNote: '金额和品牌均符合要求',
  },
  {
    // 状态 4：AI 提取但金额不足，已人工拒绝
    phone:  '60123456004@c.us',
    ic:     '920909-08-4321',
    status: 'rejected',
    aiResult: {
      receipt_no:       'RCP-2024-00789',
      brand:            'Dyson',
      amount:           350.00,
      qualified:        false,
      disqualify_reason: '金额低于 RM 500 门槛',
      confidence:       0.91,
    },
    reviewNote: '金额不足，已拒绝',
  },
];

// ─── 写入逻辑 ─────────────────────────────────────────────────────────────────

async function seed() {
  console.log('📦 开始写入测试种子数据...\n');
  console.log(`  DATA_DIR: ${process.env.DATA_DIR}`);

  // 初始化 Excel（确保文件存在）
  await excelService.initExcel();

  // receiptStore.addPendingReceipt 在 readStore()（ensureInit）之前就写图片，
  // 所以需要先手动创建 images 目录，否则首次运行会报 ENOENT
  const imagesDir = path.join(process.env.DATA_DIR, 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    console.log(`  ✓ 创建目录: ${imagesDir}`);
  }

  // ── 写入注册记录到 Excel ──────────────────────────────────────────────────
  //
  // 不走 excelService.addRegistration()：该函数重复检测依赖 column key，
  // 而 ExcelJS 从磁盘读取 xlsx 后不恢复 key 元数据（key 只在内存中存在）。
  // 直接操作 workbook 更可靠。
  //
  console.log('\n[1/2] 写入注册记录...');
  const EXCEL_PATH = path.join(process.env.DATA_DIR, 'excel', 'records.xlsx');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const regSheet = workbook.getWorksheet('Registrations');

  // 读取已存在的 IC 列，避免重复写入（按位置读取第 4 列，即 IC Number）
  const existingICs = new Set();
  regSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 跳过表头
    const icCell = row.getCell(4);
    if (icCell.value) existingICs.add(String(icCell.value));
  });

  let addedCount = 0;
  for (const reg of SEED_REGISTRATIONS) {
    if (existingICs.has(reg.ic)) {
      console.log(`  跳过（重复）：${reg.ic}`);
      continue;
    }
    regSheet.addRow([
      regSheet.rowCount, // No（含表头行）
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

  // ── 写入收据到 receiptStore（JSON + images）────────────────────────────────
  console.log('\n[2/2] 写入收据记录...');
  for (const receipt of SEED_RECEIPTS) {
    const { id, imageFilename } = receiptStore.addPendingReceipt(
      receipt.phone,
      DUMMY_IMAGE_BASE64,
      'image/jpeg',
      receipt.ic,
    );

    // 根据目标 status 继续流转状态
    if (receipt.status === 'ai_extracted' || receipt.status === 'confirmed' || receipt.status === 'rejected') {
      receiptStore.saveAiResult(id, receipt.aiResult);
    }

    if (receipt.status === 'confirmed') {
      receiptStore.confirmReceipt(id, receipt.reviewNote || '');
    }

    if (receipt.status === 'rejected') {
      receiptStore.rejectReceipt(id, receipt.reviewNote || '');
    }

    // 在 JSON 记录中打上 seed 标记，方便 --clean 精确删除
    _markAsSeed(id);

    console.log(`  ✓ [${receipt.status.padEnd(14)}] ${receipt.phone} — image: ${imageFilename}`);
  }

  console.log('\n✅ 种子数据写入完成！');
  console.log(`   收据 JSON: ${process.env.DATA_DIR}/pending_receipts.json`);
  console.log(`   注册 Excel: ${process.env.DATA_DIR}/excel/records.xlsx`);
  console.log('\n现在可以访问 http://<服务器IP>/admin 查看测试数据。');
}

/**
 * 在 JSON 记录中追加 __seed 标记（供 clean 使用）
 * 直接操作 JSON 文件，绕过 receiptStore 的公开 API
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

// ─── 清除逻辑 ─────────────────────────────────────────────────────────────────

async function clean() {
  console.log('🧹 清除测试种子数据...\n');

  const storePath  = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  const imagesDir  = path.join(process.env.DATA_DIR, 'images');

  if (!fs.existsSync(storePath)) {
    console.log('  pending_receipts.json 不存在，跳过。');
    return;
  }

  const records  = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  const toDelete = records.filter((r) => r.__seed);
  const toKeep   = records.filter((r) => !r.__seed);

  // 删除对应的图片文件
  for (const r of toDelete) {
    const imgPath = path.join(imagesDir, r.imageFilename);
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
      console.log(`  ✓ 删除图片: ${r.imageFilename}`);
    }
  }

  // 写回去掉 seed 记录的 JSON
  fs.writeFileSync(storePath, JSON.stringify(toKeep, null, 2), 'utf-8');
  console.log(`  ✓ 从 pending_receipts.json 删除 ${toDelete.length} 条种子记录`);

  console.log('\n注意：Excel 注册记录需手动删除（ExcelJS 不支持删除行）。');
  console.log(`  Excel 路径: ${process.env.DATA_DIR}/excel/records.xlsx`);
  console.log('\n✅ 清除完成（Excel 除外）。');
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

const isClean = process.argv.includes('--clean');

(isClean ? clean() : seed()).catch((err) => {
  console.error('❌ 脚本执行失败:', err.message);
  process.exit(1);
});
