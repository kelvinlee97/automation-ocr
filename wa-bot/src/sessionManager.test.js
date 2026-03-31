/**
 * sessionManager 单元测试
 * 使用 Jest module mock 模拟 fs 和 yaml、logger
 */

jest.mock('fs', () => {
  const mockFiles = {};
  const mockDirs = new Set();

  return {
    existsSync: (path) => {
      if (mockDirs.has(path)) return true;
      return path in mockFiles || Object.keys(mockFiles).some((k) => path.startsWith(k));
    },
    readFileSync: (path) => {
      if (!(path in mockFiles)) throw new Error(`ENOENT: ${path}`);
      return mockFiles[path];
    },
    writeFileSync: (path, data) => {
      mockFiles[path] = data;
    },
    mkdirSync: (path) => {
      mockDirs.add(path);
    },
    __reset: () => {
      Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
      mockDirs.clear();
    },
    __setFile: (path, content) => {
      mockFiles[path] = content;
    },
    __setDir: (path) => {
      mockDirs.add(path);
    },
  };
});

jest.mock('js-yaml', () => ({
  load: jest.fn(),
}));

jest.mock('./utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { SESSION_STATE } = require('./sessionManager');

describe('sessionManager', () => {
  const PROJECT_ROOT = '/Users/kelvinlee/Documents/projects/automation-ocr';

  beforeEach(() => {
    jest.resetModules();
    const mockFs = require('fs');
    const mockYaml = require('js-yaml');

    mockFs.__reset();
    mockFs.__setDir(`${PROJECT_ROOT}/data`);
    mockFs.__setFile(`${PROJECT_ROOT}/data/sessions.json`, JSON.stringify({}));
    mockFs.__setFile(
      `${PROJECT_ROOT}/config/config.yaml`,
      'bot:\n  session_timeout_minutes: 30\n  max_receipts_per_day: 5'
    );

    mockYaml.load.mockReturnValue({
      bot: {
        session_timeout_minutes: 30,
        max_receipts_per_day: 5,
      },
    });
  });

  describe('SESSION_STATE', () => {
    test('状态常量定义正确', () => {
      expect(SESSION_STATE.WAITING_IC).toBe('WAITING_IC');
      expect(SESSION_STATE.WAITING_RECEIPT).toBe('WAITING_RECEIPT');
      expect(SESSION_STATE.DONE).toBe('DONE');
    });
  });

  describe('getOrCreateSession', () => {
    test('新建会话', () => {
      const { getOrCreateSession } = require('./sessionManager');
      const session = getOrCreateSession('60123456789');

      expect(session.phone).toBe('60123456789');
      expect(session.state).toBe(SESSION_STATE.WAITING_IC);
      expect(session.ic).toBeNull();
      expect(session.receiptCount).toBe(0);
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    test('获取已有会话', () => {
      const { getOrCreateSession } = require('./sessionManager');
      getOrCreateSession('60123456789');
      const session = getOrCreateSession('60123456789');

      expect(session.state).toBe(SESSION_STATE.WAITING_IC);
    });

    test('不同手机号创建不同会话', () => {
      const { getOrCreateSession } = require('./sessionManager');
      const s1 = getOrCreateSession('60111111111');
      const s2 = getOrCreateSession('60122222222');

      expect(s1.phone).not.toBe(s2.phone);
    });
  });

  describe('updateSession', () => {
    test('更新会话状态', () => {
      const { getOrCreateSession, updateSession } = require('./sessionManager');
      getOrCreateSession('60123456789');
      updateSession('60123456789', { state: SESSION_STATE.WAITING_RECEIPT });
      const session = getOrCreateSession('60123456789');

      expect(session.state).toBe(SESSION_STATE.WAITING_RECEIPT);
    });

    test('更新 IC', () => {
      const { getOrCreateSession, updateSession } = require('./sessionManager');
      getOrCreateSession('60123456789');
      updateSession('60123456789', { ic: '930101-01-1234' });
      const session = getOrCreateSession('60123456789');

      expect(session.ic).toBe('930101-01-1234');
    });

    test('更新不存在的会话抛出错误', () => {
      const { updateSession } = require('./sessionManager');
      expect(() => updateSession('60199999999', { state: 'DONE' })).toThrow('会话不存在');
    });
  });

  describe('checkReceiptLimit', () => {
    test('首次提交允许', () => {
      const { getOrCreateSession, checkReceiptLimit } = require('./sessionManager');
      getOrCreateSession('60123456789');

      const result = checkReceiptLimit('60123456789');
      expect(result.allowed).toBe(true);
    });

    test('超过上限拒绝', () => {
      const { getOrCreateSession, updateSession, checkReceiptLimit } = require('./sessionManager');
      getOrCreateSession('60123456789');
      updateSession('60123456789', { receiptCount: 5 });

      const result = checkReceiptLimit('60123456789');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('今日已达最大提交次数');
    });

    test('新一天重置计数', () => {
      const { getOrCreateSession, updateSession, checkReceiptLimit } = require('./sessionManager');
      getOrCreateSession('60123456789');
      updateSession('60123456789', { receiptCount: 5, receiptCountDate: '2020-01-01' });

      const result = checkReceiptLimit('60123456789');
      expect(result.allowed).toBe(true);
    });

    test('会话不存在返回拒绝', () => {
      const { checkReceiptLimit } = require('./sessionManager');
      const result = checkReceiptLimit('60199999999');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('会话不存在');
    });
  });

  describe('incrementReceiptCount', () => {
    test('递增计数', () => {
      const { getOrCreateSession, incrementReceiptCount, getAllSessions } = require('./sessionManager');
      getOrCreateSession('60123456789');
      const before = getAllSessions()[0].receiptCount;
      incrementReceiptCount('60123456789');
      const after = getAllSessions()[0].receiptCount;

      expect(after).toBe(before + 1);
    });
  });

  describe('getAllSessions', () => {
    test('返回有效会话', () => {
      const { getOrCreateSession, getAllSessions } = require('./sessionManager');
      getOrCreateSession('60111111111');
      getOrCreateSession('60122222222');

      const sessions = getAllSessions();
      expect(sessions.length).toBe(2);
    });

    test('过滤超时会话', () => {
      const { getOrCreateSession, getAllSessions } = require('./sessionManager');
      const session = getOrCreateSession('60111111111');
      // 直接修改 updatedAt 为过去的时间
      session.updatedAt = Date.now() - 31 * 60 * 1000;

      const sessions = getAllSessions();
      expect(sessions.length).toBe(0);
    });
  });

  describe('会话超时', () => {
    test('超时会话被清理', () => {
      const { getOrCreateSession } = require('./sessionManager');
      // 创建会话，然后手动设置过期
      const session = getOrCreateSession('60123456789');
      session.updatedAt = Date.now() - 60 * 60 * 1000;

      // 重新获取应该返回新会话（旧的被清理）
      const result = getOrCreateSession('60123456789');
      expect(result.state).toBe(SESSION_STATE.WAITING_IC);
    });
  });
});