#!/usr/bin/env node
/**
 * 用户流程模拟脚本
 *
 * 模拟真实用户通过 WhatsApp 依次发送：
 *   1. IC 号码（文字消息）
 *   2. 收据截图（图片消息）
 *
 * 数据写入真实的 data/ 目录，管理后台可立即看到。
 * 完整走 messageHandler → registrationHandler/receiptHandler 业务逻辑，
 * 不 mock 任何服务层。
 *
 * 用法（从项目根目录执行）：
 *   node wa-bot/scripts/simulate-user.js
 *   node wa-bot/scripts/simulate-user.js --phone 60199887766 --ic 900101-14-5001
 *
 * 可选参数：
 *   --phone  手机号（纯数字，不含 @c.us 后缀）  默认：60188887777
 *   --ic     马来西亚 IC 号码                   默认：900202-14-5678
 *   --count  模拟收据张数                       默认：1
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── 路径修正（必须在 require 业务模块之前设置）────────────────────────────────
// receiptStore 默认 DATA_DIR 从 wa-bot/src/services 向上 4 级，本地会解析到
// automation-ocr 的父目录。通过 DATA_DIR 覆盖，统一指向 automation-ocr/data/
const PROJECT_ROOT = path.resolve(__dirname, '../../');
process.env.DATA_DIR = path.join(PROJECT_ROOT, 'data');

const { handleMessage } = require('../src/messageHandler');
const excelService      = require('../src/services/excelService');

// ─── 解析命令行参数 ────────────────────────────────────────────────────────────

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
    if (args[i] === '--count' && args[i + 1]) result.count = parseInt(args[++i], 10);
  }

  // WhatsApp 消息的 from 字段格式为 "手机号@c.us"
  result.waId = `${result.phone}@c.us`;
  return result;
}

// ─── 最小合法 JPEG（1×1 白色像素）────────────────────────────────────────────
// 避免依赖外部图片文件；管理后台能正常渲染缩略图
const DUMMY_RECEIPT_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAg' +
  'IBBQEAAAAAAAAAAAAAAQIDBAUREiExQf/EABUBAQEAAAAAAAAAAAAAAAAAAAEC/8QAFBEB' +
  'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqGdmMl32RJVI5jqO42Zo3a8AAAA=';

// ─── Mock Message 工厂 ────────────────────────────────────────────────────────
//
// handleMessage 对 message 对象的期望：
//   - message.from          发送方 WhatsApp ID（格式：手机号@c.us）
//   - message.type          消息类型（'chat' / 'image'）
//   - message.hasMedia      是否含媒体
//   - message.body          文字内容
//   - message.timestamp     时间戳（秒）
//   - message.fromMe        是否自己发的（过滤自发消息）
//   - message.getChat()     返回 { isGroup: false, id: { _serialized } }
//   - message.downloadMedia() 返回 { data: base64, mimetype }（仅图片消息）
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

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function run() {
  const { phone, ic, waId, count } = parseArgs();

  console.log('🤖 用户流程模拟\n');
  console.log(`  手机号: ${phone}  (${waId})`);
  console.log(`  IC:     ${ic}`);
  console.log(`  收据数: ${count}`);
  console.log(`  DATA_DIR: ${process.env.DATA_DIR}\n`);

  // 初始化 Excel（确保文件存在，首次运行时创建）
  await excelService.initExcel();

  // 确保 images 目录存在（receiptStore 在写图片前不保证目录已创建）
  const imagesDir = path.join(process.env.DATA_DIR, 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  // ── Step 1: 发送 IC 号码（文字消息）──────────────────────────────────────
  console.log(`[1/2] 发送 IC 号码: ${ic}`);
  await handleMessage(makeTextMessage(waId, ic));
  console.log('      ✓ IC 消息已处理\n');

  // ── Step 2: 发送收据图片（可多张）────────────────────────────────────────
  console.log(`[2/2] 发送收据图片（${count} 张）`);
  for (let i = 1; i <= count; i++) {
    await handleMessage(makeImageMessage(waId));
    console.log(`      ✓ 收据 ${i}/${count} 已处理`);
  }

  console.log('\n✅ 模拟完成！');
  console.log(`   sessions.json: ${path.join(PROJECT_ROOT, 'data/sessions.json')}`);
  console.log(`   receipts JSON: ${path.join(process.env.DATA_DIR, 'pending_receipts.json')}`);
  console.log(`   Excel:         ${path.join(process.env.DATA_DIR, 'excel/records.xlsx')}`);
  console.log('\n访问 /admin 即可看到刚写入的注册记录和待审核收据。');
}

run().catch((err) => {
  console.error('❌ 模拟失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
