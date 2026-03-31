/**
 * sessionManager 单元测试
 */

jest.mock('fs');
jest.mock('js-yaml');

jest.mock('./utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const mockFiles = {};
const mockDirs = new Set();

jest.mock('fs', () => ({
  existsSync: (p) => mockDirs.has(p) || p in mockFiles || Object.keys(mockFiles).some((k) => p.startsWith(k)),
  readFileSync: (p) => { if (!(p in mockFiles)) throw new Error(`ENOENT: ${p}`); return mockFiles[p]; },
  writeFileSync: (p, d) => { mockFiles[p] = d; },
  mkdirSync: (p) => { mockDirs.add(p); },
}));

jest.mock('js-yaml', () => ({
  load: jest.fn(() => ({ bot: { session_timeout_minutes: 30, max_receipts_per_day: 5 } })),
}));

describe('sessionManager', () => {
  beforeEach(() => {
    jest.resetModules();
    Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
    mockDirs.clear();

    // 初始化 mock 数据
    mockDirs.add(`${PROJECT_ROOT}/data`);
    mockDirs.add(`${PROJECT_ROOT}/config`);
    mockFiles[`${PROJECT_ROOT}/data/sessions.json`] = '{}';
    mockFiles[`${PROJECT_ROOT}/config/config.yaml`] = 'bot:\n  session_timeout_minutes: 30\n  max_receipts_per_day: 5';
  });

  describe('SESSION_STATE', () => {
    test('状态常量存在', () => {
      const { SESSION_STATE } = require('./sessionManager');
      expect(SESSION_STATE.WAITING_IC).toBe('WAITING_IC');
      expect(SESSION_STATE.WAITING_RECEIPT).toBe('WAITING_RECEIPT');
      expect(SESSION_STATE.DONE).toBe('DONE');
    });
  });

  describe('getOrCreateSession', () => {
    test('创建新会话返回正确属性', () => {
      const { getOrCreateSession } = require('./sessionManager');
      const session = getOrCreateSession('60123456789');
      expect(session.phone).toBe('60123456789');
      expect(session.state).toBe('WAITING_IC');
    });

    test('重复调用返回同一会话', () => {
      const { getOrCreateSession } = require('./sessionManager');
      const s1 = getOrCreateSession('60123456789');
      const s2 = getOrCreateSession('60123456789');
      expect(s1).toBe(s2);
    });
  });

  describe('updateSession', () => {
    test('更新已有会话', () => {
      const { getOrCreateSession, updateSession } = require('./sessionManager');
      getOrCreateSession('60123456789');
      updateSession('60123456789', { ic: '930101-01-1234' });
      const session = getOrCreateSession('60123456789');
      expect(session.ic).toBe('930101-01-1234');
    });

    test('更新不存在的会话抛出错误', () => {
      const { updateSession } = require('./sessionManager');
      expect(() => updateSession('60199999999', {})).toThrow('会话不存在');
    });
  });

  describe('checkReceiptLimit', () => {
    test('首次请求允许', () => {
      const { getOrCreateSession, checkReceiptLimit } = require('./sessionManager');
      getOrCreateSession('60123456789');
      expect(checkReceiptLimit('60123456789').allowed).toBe(true);
    });

    test('会话不存在返回拒绝', () => {
      const { checkReceiptLimit } = require('./sessionManager');
      expect(checkReceiptLimit('60199999999').allowed).toBe(false);
    });
  });

  describe('incrementReceiptCount', () => {
    test('递增计数', () => {
      const { getOrCreateSession, incrementReceiptCount } = require('./sessionManager');
      getOrCreateSession('60123456789');
      incrementReceiptCount('60123456789');
      const session = getOrCreateSession('60123456789');
      expect(session.receiptCount).toBe(1);
    });
  });
});