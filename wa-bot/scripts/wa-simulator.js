#!/usr/bin/env node
/**
 * wa-simulator.js — WhatsApp 用户流程可复用模拟工具
 *
 * 内建多个命名场景，完整走 messageHandler 业务逻辑写入真实 data/ 目录，
 * 管理后台可立即看到结果。
 *
 * ─── 用法 ────────────────────────────────────────────────────────────────────
 *   node wa-bot/scripts/wa-simulator.js                    # 运行默认场景（happy-path）
 *   node wa-bot/scripts/wa-simulator.js --scene <名称>     # 运行指定场景
 *   node wa-bot/scripts/wa-simulator.js --all              # 运行全部场景
 *   node wa-bot/scripts/wa-simulator.js --list             # 查看所有场景
 *   node wa-bot/scripts/wa-simulator.js --clean            # 清除所有模拟数据
 *
 * ─── 自定义参数（覆盖场景默认值）────────────────────────────────────────────
 *   --phone <号码>   手机号（纯数字，不含 @c.us 后缀）
 *   --ic    <IC>     马来西亚 IC 号码
 *
 * ─── 内建场景 ────────────────────────────────────────────────────────────────
 *   happy-path      正常流程：发 IC → 发 1 张收据
 *   multi-receipt   多收据：发 IC → 发 3 张收据
 *   no-ic           跳过 IC 直接发图（ic 字段为 null）
 *   invalid-ic      先发无效 IC → 再发合法 IC → 发收据（验证容错）
 *   duplicate-ic    同一 IC 两次注册（验证去重逻辑）
 *   group-ignored   模拟群组消息（应被静默忽略，不写任何数据）
 *
 * 注意：
 *   - 必须从项目根目录运行（automation-ocr/）
 *   - 模拟记录带 __simulate: true 标记，--clean 仅删带标记的记录
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── 路径修正（必须在 require 业务模块之前）────────────────────────────────────
// receiptStore 默认 DATA_DIR 从 wa-bot/src/services 向上 4 级，本地会解析到
// automation-ocr 的父目录。通过 DATA_DIR 覆盖，统一指向 automation-ocr/data/
const PROJECT_ROOT = path.resolve(__dirname, '../../');
process.env.DATA_DIR = path.join(PROJECT_ROOT, 'data');

const { handleMessage } = require('../src/messageHandler');
const excelService      = require('../src/services/excelService');

// ─── 最小合法 JPEG（1×1 白色像素，base64）────────────────────────────────────
// 用于所有图片消息，避免依赖外部文件；管理后台可正常渲染缩略图
const DUMMY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIRAAAg' +
  'IBBQEAAAAAAAAAAAAAAQIDBAUREiExQf/EABUBAQEAAAAAAAAAAAAAAAAAAAEC/8QAFBEB' +
  'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqGdmMl32RJVI5jqO42Zo3a8AAAA=';

// ─── Message 工厂 ─────────────────────────────────────────────────────────────
//
// 每个工厂函数返回满足 handleMessage 接口的 mock 对象。
// 字段与 whatsapp-web.js Message 对齐：from, type, hasMedia, body, timestamp 等。
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

// 群组消息：getChat 返回 isGroup: true，messageHandler 应静默忽略
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

// ─── 场景定义 ─────────────────────────────────────────────────────────────────
//
// 每个场景是一个对象：
//   name        场景唯一标识
//   desc        说明（--list 展示）
//   phone       模拟手机号
//   steps       async 步骤数组，每步返回 { label, msg } 或直接是一个 async fn(ctx)
//
// ctx 包含 { waId, log } 供步骤函数使用。
//

const SCENES = [
  {
    name:  'happy-path',
    desc:  '正常流程：发 IC → 发 1 张收据',
    phone: '60100010001',
    steps: async ({ waId, log }) => {
      log('发送 IC: 900101-14-5001');
      await handleMessage(makeTextMsg(waId, '900101-14-5001'));

      log('发送收据图片');
      await handleMessage(makeImageMsg(waId));
    },
  },

  {
    name:  'multi-receipt',
    desc:  '多收据流程：发 IC → 发 3 张收据',
    phone: '60100020002',
    steps: async ({ waId, log }) => {
      log('发送 IC: 850615-10-1234');
      await handleMessage(makeTextMsg(waId, '850615-10-1234'));

      for (let i = 1; i <= 3; i++) {
        log(`发送收据图片 ${i}/3`);
        await handleMessage(makeImageMsg(waId));
      }
    },
  },

  {
    name:  'no-ic',
    desc:  '跳过 IC 直接发图（ic 字段将为 null，验证宽松模式）',
    phone: '60100030003',
    steps: async ({ waId, log }) => {
      log('直接发送收据图片（未提交 IC）');
      await handleMessage(makeImageMsg(waId));
    },
  },

  {
    name:  'invalid-ic',
    desc:  '先发无效 IC，再发合法 IC，最后发收据（验证容错与重试）',
    phone: '60100040004',
    steps: async ({ waId, log }) => {
      log('发送无效 IC: 123456789（应被静默忽略）');
      await handleMessage(makeTextMsg(waId, '123456789'));

      log('发送无效 IC: ABCD-EF-GHIJ（应被静默忽略）');
      await handleMessage(makeTextMsg(waId, 'ABCD-EF-GHIJ'));

      log('发送合法 IC: 751230-07-8888');
      await handleMessage(makeTextMsg(waId, '751230-07-8888'));

      log('发送收据图片');
      await handleMessage(makeImageMsg(waId));
    },
  },

  {
    name:  'duplicate-ic',
    desc:  '同一 IC 两次注册（验证 Excel 去重：第二次应记录日志但不报错）',
    phone: '60100050005',
    steps: async ({ waId, log }) => {
      log('第 1 次发送 IC: 920909-08-4321');
      await handleMessage(makeTextMsg(waId, '920909-08-4321'));

      // 同一 session 下再次发相同 IC（模拟用户重发）
      log('第 2 次发送同一 IC: 920909-08-4321（应提示重复但允许继续）');
      await handleMessage(makeTextMsg(waId, '920909-08-4321'));

      log('发送收据图片');
      await handleMessage(makeImageMsg(waId));
    },
  },

  {
    name:  'group-ignored',
    desc:  '群组消息（应被 messageHandler 静默忽略，data/ 无任何新记录）',
    phone: '60100060006',
    steps: async ({ waId, log }) => {
      log('发送群组文字消息（应忽略）');
      await handleMessage(makeGroupMsg(waId, '900101-14-5001'));

      log('发送群组图片消息（应忽略）');
      // 群组图片：isGroup: true，直接构造而不用 makeImageMsg（不需要 downloadMedia）
      await handleMessage({
        ...makeImageMsg(waId),
        getChat: async () => ({ isGroup: true, id: { _serialized: `${waId}-group@g.us` } }),
      });

      log('验证：以上消息均应被忽略，data/ 无新记录');
    },
  },
];

// ─── 执行引擎 ─────────────────────────────────────────────────────────────────

async function runScene(scene, overrides = {}) {
  const phone = overrides.phone || scene.phone;
  const waId  = `${phone}@c.us`;

  console.log(`\n  场景: [${scene.name}] ${scene.desc}`);
  console.log(`  手机: ${phone}`);

  let stepNum = 1;
  const log = (msg) => console.log(`    [${stepNum++}] ${msg}`);

  const before = countRecords();
  await scene.steps({ waId, phone, log });
  const after  = countRecords();

  const delta = after - before;
  const tag   = scene.name === 'group-ignored'
    ? (delta === 0 ? '✓ 正确：群组消息被忽略' : `✗ 异常：写入了 ${delta} 条记录（应为 0）`)
    : `✓ 新增 ${delta} 条收据记录`;

  console.log(`  ${tag}`);
  _markNewAsSim(before);
}

/** 读取 pending_receipts.json 当前记录数 */
function countRecords() {
  const p = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  if (!fs.existsSync(p)) return 0;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')).length; } catch { return 0; }
}

/**
 * 将本次新增的收据记录（索引 0 到 before-1 之后的部分）打上 __simulate 标记
 * receiptStore 按 unshift 写入，最新记录在数组头部
 */
function _markNewAsSim(countBefore) {
  const p = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  if (!fs.existsSync(p)) return;
  const records = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const newCount = records.length - countBefore;
  // 头部 newCount 条是本次新增的（unshift 顺序）
  for (let i = 0; i < newCount; i++) {
    records[i].__simulate = true;
  }
  fs.writeFileSync(p, JSON.stringify(records, null, 2), 'utf-8');
}

// ─── --clean ──────────────────────────────────────────────────────────────────

async function clean() {
  console.log('🧹 清除所有模拟数据（__simulate: true）\n');

  const storePath = path.join(process.env.DATA_DIR, 'pending_receipts.json');
  const imagesDir = path.join(process.env.DATA_DIR, 'images');

  if (!fs.existsSync(storePath)) {
    console.log('  pending_receipts.json 不存在，跳过。');
    return;
  }

  const records  = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  const toDelete = records.filter((r) => r.__simulate);
  const toKeep   = records.filter((r) => !r.__simulate);

  for (const r of toDelete) {
    const imgPath = path.join(imagesDir, r.imageFilename);
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
      console.log(`  ✓ 删除图片: ${r.imageFilename}`);
    }
  }

  fs.writeFileSync(storePath, JSON.stringify(toKeep, null, 2), 'utf-8');
  console.log(`  ✓ 从 pending_receipts.json 删除 ${toDelete.length} 条模拟记录`);
  console.log('\n注意：Excel 注册记录无法自动删除（ExcelJS 不支持删除行）。');
  console.log(`  Excel: ${path.join(process.env.DATA_DIR, 'excel/records.xlsx')}`);
  console.log('\n✅ 清除完成。');
}

// ─── --list ───────────────────────────────────────────────────────────────────

function listScenes() {
  console.log('\n可用场景：\n');
  for (const s of SCENES) {
    console.log(`  ${s.name.padEnd(16)} ${s.desc}`);
  }
  console.log('\n用法：node wa-bot/scripts/wa-simulator.js --scene <名称>');
  console.log('      node wa-bot/scripts/wa-simulator.js --all\n');
}

// ─── 初始化（确保目录和文件存在）───────────────────────────────────────────────

async function ensureDataDirs() {
  await excelService.initExcel();
  const imagesDir = path.join(process.env.DATA_DIR, 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
}

// ─── 命令行入口 ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) { listScenes(); return; }
  if (args.includes('--clean')) { await clean(); return; }

  // 解析可选覆盖参数
  const overrides = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phone' && args[i + 1]) overrides.phone = args[++i];
    if (args[i] === '--ic'    && args[i + 1]) overrides.ic    = args[++i];
  }

  await ensureDataDirs();

  if (args.includes('--all')) {
    console.log('🤖 运行全部场景\n');
    console.log(`  DATA_DIR: ${process.env.DATA_DIR}`);
    for (const scene of SCENES) {
      await runScene(scene, overrides);
    }
    console.log('\n✅ 全部场景完成。访问 /admin 查看结果。');
    return;
  }

  // 指定场景
  const sceneIdx = args.indexOf('--scene');
  const sceneName = sceneIdx !== -1 ? args[sceneIdx + 1] : 'happy-path';
  const scene = SCENES.find((s) => s.name === sceneName);

  if (!scene) {
    console.error(`❌ 未知场景: "${sceneName}"。用 --list 查看可用场景。`);
    process.exit(1);
  }

  console.log('🤖 用户流程模拟\n');
  console.log(`  DATA_DIR: ${process.env.DATA_DIR}`);
  await runScene(scene, overrides);
  console.log('\n✅ 完成。访问 /admin 查看结果。');
}

main().catch((err) => {
  console.error('❌ 模拟失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
