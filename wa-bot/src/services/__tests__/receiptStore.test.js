'use strict';

/**
 * receiptStore.test.js — sendMessageToUser 单元测试
 *
 * mock 边界：fs（文件 I/O）
 * 真实跑：receiptStore 全部业务逻辑
 */

// ─── mock fs，使用内存文件系统 ─────────────────────────────────────────────────

const mockFiles = {};
const mockDirs  = new Set();

jest.mock('fs', () => ({
  existsSync:    (p) => mockDirs.has(p) || (p in mockFiles),
  readFileSync:  (p, _enc) => {
    if (!(p in mockFiles)) throw new Error(`ENOENT: ${p}`);
    return mockFiles[p];
  },
  writeFileSync: (p, d) => { mockFiles[p] = d; },
  mkdirSync:     (p)    => { mockDirs.add(p); },
}));

// ─── 测试准备 ─────────────────────────────────────────────────────────────────

const receiptStore = require('../receiptStore');

// 每个测试前重置内存文件系统，保证测试隔离
beforeEach(() => {
  // 清空内存文件
  Object.keys(mockFiles).forEach(k => delete mockFiles[k]);
  mockDirs.clear();
  // 清除模块缓存，让 receiptStore 重新初始化
  jest.resetModules();
});

// 工厂函数：快速创建一条带指定状态的收据
function createReceipt(status = 'pending_review') {
  const store = require('../receiptStore');
  // 直接操作 store 的内部写入来模拟已存在记录
  // 使用 addPendingReceipt 创建 pending_review，再用 store 函数流转
  const { id } = store.addPendingReceipt('6012345678@c.us', 'base64data', 'image/jpeg', 'IC001');

  if (status === 'ai_extracted') {
    store.saveAiResult(id, { amount: 100, summary: '测试', confidence: 0.9, success: true });
  } else if (status === 'confirmed') {
    store.saveAiResult(id, { amount: 100, summary: '测试', confidence: 0.9, success: true });
    store.confirmReceipt(id, '确认');
  } else if (status === 'rejected') {
    store.rejectReceipt(id, '图片不清晰');
  } else if (status === 'waiting_user_reply') {
    store.sendMessageToUser(id, '请重新发送收据');
  }

  return id;
}

// ─── sendMessageToUser 测试 ───────────────────────────────────────────────────

describe('sendMessageToUser', () => {
  // 每个 test 需要重新 require，因为 beforeEach 清了 jest.resetModules()
  let store;
  beforeEach(() => {
    store = require('../receiptStore');
  });

  test('pending_review 状态下可发消息，状态变为 waiting_user_reply', () => {
    const { id } = store.addPendingReceipt('60100000001@c.us', 'b64', 'image/jpeg', null);

    store.sendMessageToUser(id, '请提供清晰收据');

    const record = store.getById(id);
    expect(record.status).toBe('waiting_user_reply');
    expect(record.sentMessage).toBe('请提供清晰收据');
    expect(record.sentAt).toBeDefined();
    // previousStatus 记录来源状态，方便审计
    expect(record.previousStatus).toBe('pending_review');
  });

  test('ai_extracted 状态下可发消息', () => {
    const { id } = store.addPendingReceipt('60100000002@c.us', 'b64', 'image/jpeg', null);
    store.saveAiResult(id, { amount: 50, summary: '餐厅', confidence: 0.8, success: true });

    store.sendMessageToUser(id, '金额有误，请确认');

    const record = store.getById(id);
    expect(record.status).toBe('waiting_user_reply');
    expect(record.previousStatus).toBe('ai_extracted');
  });

  test('confirmed 状态下可再次发消息', () => {
    const { id } = store.addPendingReceipt('60100000003@c.us', 'b64', 'image/jpeg', null);
    store.saveAiResult(id, { amount: 80, summary: '超市', confidence: 0.9, success: true });
    store.confirmReceipt(id);

    store.sendMessageToUser(id, '补充材料通知');

    const record = store.getById(id);
    expect(record.status).toBe('waiting_user_reply');
    expect(record.previousStatus).toBe('confirmed');
    expect(record.sentMessage).toBe('补充材料通知');
  });

  test('rejected 状态下可发消息，通知用户被拒原因', () => {
    const { id } = store.addPendingReceipt('60100000004@c.us', 'b64', 'image/jpeg', null);
    store.rejectReceipt(id, '图片模糊');

    store.sendMessageToUser(id, '您的收据因图片模糊被拒绝，请重拍');

    const record = store.getById(id);
    expect(record.status).toBe('waiting_user_reply');
    expect(record.previousStatus).toBe('rejected');
  });

  test('waiting_user_reply 状态下可重复发消息（覆盖上次）', () => {
    const { id } = store.addPendingReceipt('60100000005@c.us', 'b64', 'image/jpeg', null);
    store.sendMessageToUser(id, '第一次通知');
    store.sendMessageToUser(id, '第二次催促');

    const record = store.getById(id);
    expect(record.status).toBe('waiting_user_reply');
    // previousStatus 为上一次的来源状态
    expect(record.previousStatus).toBe('waiting_user_reply');
    expect(record.sentMessage).toBe('第二次催促');
  });

  test('ID 不存在时抛出错误', () => {
    expect(() => {
      store.sendMessageToUser('non-existent-id', '测试消息');
    }).toThrow('Receipt not found: non-existent-id');
  });

  test('sentAt 字段为合法 ISO 时间字符串', () => {
    const { id } = store.addPendingReceipt('60100000006@c.us', 'b64', 'image/jpeg', null);
    const before = new Date().toISOString();

    store.sendMessageToUser(id, '时间戳测试');

    const after = new Date().toISOString();
    const record = store.getById(id);

    // sentAt 应在调用前后时间之间
    expect(record.sentAt >= before).toBe(true);
    expect(record.sentAt <= after).toBe(true);
  });
});

// ─── sendMessageToUser 导出验证 ───────────────────────────────────────────────

describe('receiptStore 导出', () => {
  test('sendMessageToUser 已导出', () => {
    const store = require('../receiptStore');
    expect(typeof store.sendMessageToUser).toBe('function');
  });

  test('saveSentMessage 仍保持向后兼容导出', () => {
    const store = require('../receiptStore');
    expect(typeof store.saveSentMessage).toBe('function');
  });
});
