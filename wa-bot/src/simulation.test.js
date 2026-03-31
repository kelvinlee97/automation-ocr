/**
 * simulation.test.js — 端对端用户流程模拟测试
 *
 * 模拟完整的 WhatsApp 用户交互：发手机号 → 发 IC → 发收据截图
 * mock 边界：excelService（Excel 写入）、receiptStore（文件持久化）、logger
 * 真实跑：messageHandler → handler 逻辑链 + sessionManager 状态流转
 *
 * 可复用性：通过 createMockMessage() 工厂函数构造不同场景的消息对象，
 * 每个 describe 块代表一种用户行为场景，可独立运行
 */

// ─── mock 系统边界：文件 I/O ──────────────────────────────────────────────────

jest.mock('./utils/logger', () => ({
  info:  jest.fn(),
  debug: jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

jest.mock('./services/excelService', () => ({
  initExcel:       jest.fn().mockResolvedValue(undefined),
  addRegistration: jest.fn().mockResolvedValue({ duplicate: false }),
}));

jest.mock('./services/receiptStore', () => ({
  addPendingReceipt: jest.fn().mockReturnValue({ id: 'test-id-001', imageFilename: 'test-id-001.jpg' }),
  getAll:            jest.fn().mockReturnValue([]),
  getById:           jest.fn().mockReturnValue(null),
}));

// ─── fs mock：内存模拟文件系统（复用 sessionManager.test.js 的模式）────────

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const mockFiles = {};
const mockDirs  = new Set();

jest.mock('fs', () => ({
  existsSync:    (p) => mockDirs.has(p) || (p in mockFiles),
  readFileSync:  (p) => {
    if (!(p in mockFiles)) throw new Error(`ENOENT: ${p}`);
    return mockFiles[p];
  },
  writeFileSync: (p, d) => { mockFiles[p] = d; },
  mkdirSync:     (p)    => { mockDirs.add(p); },
}));

jest.mock('js-yaml', () => ({
  load: jest.fn(() => ({ bot: { session_timeout_minutes: 30, max_receipts_per_day: 5 } })),
}));

// ─── 工厂函数 ─────────────────────────────────────────────────────────────────

/**
 * 构造模拟 WhatsApp 文字消息
 * @param {Object} opts
 * @param {string} opts.from    - 发送方号码，默认测试号码
 * @param {string} opts.body    - 消息文本
 * @returns {Object} mock message
 */
function createTextMessage({ from = '60123456789@c.us', body } = {}) {
  return {
    from,
    body,
    type:     'chat',
    hasMedia: false,
    fromMe:   false,
    timestamp: Math.floor(Date.now() / 1000),
    getChat: jest.fn().mockResolvedValue({ isGroup: false, id: { _serialized: from } }),
  };
}

/**
 * 构造模拟 WhatsApp 图片消息（收据截图）
 * @param {Object} opts
 * @param {string} opts.from       - 发送方号码
 * @param {string} opts.base64     - 图片 Base64 数据（不含 data: 前缀）
 * @param {string} opts.mimeType   - MIME 类型，默认 image/jpeg
 * @returns {Object} mock message
 */
function createImageMessage({ from = '60123456789@c.us', base64 = MOCK_RECEIPT_BASE64, mimeType = 'image/jpeg' } = {}) {
  return {
    from,
    body:     '',
    type:     'image',
    hasMedia: true,
    fromMe:   false,
    timestamp: Math.floor(Date.now() / 1000),
    getChat:       jest.fn().mockResolvedValue({ isGroup: false, id: { _serialized: from } }),
    downloadMedia: jest.fn().mockResolvedValue({ data: base64, mimetype: mimeType }),
  };
}

// 最小有效 1x1 像素 JPEG 的 Base64（用于测试，不需要真实收据）
const MOCK_RECEIPT_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB' +
  'AxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEA//EAB4QAAICAgMBAAAAAAAAAAAAAAECAxEEITFB/8QA' +
  'FABAQAAAAAAAAAAAAAAAAAAAAP/EABURAQEAAAAAAAAAAAAAAAAAAAAB/9oADAMBAAIRAxEAPwCwABmS' +
  'lJRXoV5rNj//2Q==';

// 有效的马来西亚 IC 号码（测试用）
const VALID_IC = '930101-01-1234';
const TEST_PHONE = '60123456789@c.us';

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('用户流程模拟', () => {

  beforeEach(() => {
    // 重置模块，确保 sessionManager 内部状态不跨测试污染
    jest.resetModules();

    // 重置 mock 文件系统
    Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
    mockDirs.clear();

    // 初始化 sessionManager 依赖的目录和文件
    mockDirs.add(`${PROJECT_ROOT}/data`);
    mockFiles[`${PROJECT_ROOT}/data/sessions.json`] = '{}';
    // sessionManager 从 wa-bot/config/config.yaml 读取配置
    mockDirs.add(`${PROJECT_ROOT}/config`);
    mockFiles[`${PROJECT_ROOT}/config/config.yaml`] = 'bot:\n  session_timeout_minutes: 30\n  max_receipts_per_day: 5';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── 场景一：正常完整流程 ─────────────────────────────────────────────────────

  describe('场景一：IC 注册 → 提交收据截图', () => {
    test('发送有效 IC，session 状态流转为 WAITING_RECEIPT', async () => {
      const { handleMessage } = require('./messageHandler');
      const sessionManager    = require('./sessionManager');
      const excelService      = require('./services/excelService');

      const msg = createTextMessage({ body: VALID_IC });
      await handleMessage(msg);

      // session 应记录 IC 并等待收据
      const session = sessionManager.getOrCreateSession(TEST_PHONE);
      expect(session.ic).toBe(VALID_IC);
      expect(session.state).toBe('WAITING_RECEIPT');

      // Excel 写入应被调用一次，传入标准化后的 IC 字符串
      expect(excelService.addRegistration).toHaveBeenCalledWith(TEST_PHONE, VALID_IC);
    });

    test('IC 注册后发送图片，收据成功保存', async () => {
      const { handleMessage } = require('./messageHandler');
      const receiptStore      = require('./services/receiptStore');

      // 先发 IC
      const icMsg = createTextMessage({ body: VALID_IC });
      await handleMessage(icMsg);

      // 再发收据图片
      const imgMsg = createImageMessage();
      await handleMessage(imgMsg);

      // 收据应带上已注册的 IC
      expect(receiptStore.addPendingReceipt).toHaveBeenCalledWith(
        TEST_PHONE,
        MOCK_RECEIPT_BASE64,
        'image/jpeg',
        VALID_IC,   // session.ic 应传入
      );
    });
  });

  // ── 场景二：先发图片（跳过 IC 注册）────────────────────────────────────────

  describe('场景二：未注册 IC 直接提交收据', () => {
    test('图片仍应保存，ic 字段为 null', async () => {
      const { handleMessage } = require('./messageHandler');
      const receiptStore      = require('./services/receiptStore');

      const imgMsg = createImageMessage();
      await handleMessage(imgMsg);

      expect(receiptStore.addPendingReceipt).toHaveBeenCalledWith(
        TEST_PHONE,
        MOCK_RECEIPT_BASE64,
        'image/jpeg',
        null,   // 未注册 IC，传 null
      );
    });
  });

  // ── 场景三：无效 IC 格式 ────────────────────────────────────────────────────

  describe('场景三：发送无效 IC 格式', () => {
    test('无效 IC 被静默忽略，session 保持 WAITING_IC 状态', async () => {
      const { handleMessage } = require('./messageHandler');
      const sessionManager    = require('./sessionManager');
      const excelService      = require('./services/excelService');

      const msg = createTextMessage({ body: '不是身份证号码 hello' });
      await handleMessage(msg);

      const session = sessionManager.getOrCreateSession(TEST_PHONE);
      expect(session.state).toBe('WAITING_IC');  // 状态不变
      expect(excelService.addRegistration).not.toHaveBeenCalled();
    });

    test('纯数字但位数不对的输入被忽略', async () => {
      const { handleMessage } = require('./messageHandler');
      const excelService      = require('./services/excelService');

      const msg = createTextMessage({ body: '12345678' });  // 只有 8 位，不是 12 位
      await handleMessage(msg);

      expect(excelService.addRegistration).not.toHaveBeenCalled();
    });
  });

  // ── 场景四：重复注册同一 IC ─────────────────────────────────────────────────

  describe('场景四：重复注册', () => {
    test('重复发送 IC，仍允许继续提交收据', async () => {
      const { handleMessage } = require('./messageHandler');
      const sessionManager    = require('./sessionManager');
      const excelService      = require('./services/excelService');

      // excelService 返回 duplicate: true
      excelService.addRegistration.mockResolvedValue({ duplicate: true });

      const msg = createTextMessage({ body: VALID_IC });
      await handleMessage(msg);

      const session = sessionManager.getOrCreateSession(TEST_PHONE);
      // 重复注册也应更新 session，允许继续提交收据
      expect(session.state).toBe('WAITING_RECEIPT');
    });
  });

  // ── 场景五：群组消息和 Status 广播应被忽略 ──────────────────────────────────

  describe('场景五：非私聊消息过滤', () => {
    test('群组消息被忽略，不创建 session', async () => {
      const { handleMessage } = require('./messageHandler');
      const receiptStore      = require('./services/receiptStore');
      const excelService      = require('./services/excelService');

      // 构造群组消息（isGroup = true）
      const groupMsg = createTextMessage({ body: VALID_IC });
      groupMsg.getChat = jest.fn().mockResolvedValue({ isGroup: true, id: { _serialized: 'group-id@g.us' } });

      await handleMessage(groupMsg);

      expect(excelService.addRegistration).not.toHaveBeenCalled();
      expect(receiptStore.addPendingReceipt).not.toHaveBeenCalled();
    });

    test('WhatsApp Status 广播被忽略', async () => {
      const { handleMessage } = require('./messageHandler');

      const statusMsg = createTextMessage({ from: 'status@broadcast', body: VALID_IC });
      await handleMessage(statusMsg);

      const excelService = require('./services/excelService');
      expect(excelService.addRegistration).not.toHaveBeenCalled();
    });
  });

  // ── 场景六：多用户并发提交（各自 session 隔离） ──────────────────────────────

  describe('场景六：多用户 session 独立不干扰', () => {
    test('两个用户各自完成注册，session 互不影响', async () => {
      const { handleMessage } = require('./messageHandler');
      const sessionManager    = require('./sessionManager');

      const PHONE_A = '60111111111@c.us';
      const PHONE_B = '60222222222@c.us';
      const IC_A    = '930101-01-1234';
      const IC_B    = '850606-14-5678';

      const msgA = createTextMessage({ from: PHONE_A, body: IC_A });
      msgA.getChat = jest.fn().mockResolvedValue({ isGroup: false, id: { _serialized: PHONE_A } });

      const msgB = createTextMessage({ from: PHONE_B, body: IC_B });
      msgB.getChat = jest.fn().mockResolvedValue({ isGroup: false, id: { _serialized: PHONE_B } });

      await handleMessage(msgA);
      await handleMessage(msgB);

      const sessionA = sessionManager.getOrCreateSession(PHONE_A);
      const sessionB = sessionManager.getOrCreateSession(PHONE_B);

      expect(sessionA.ic).toBe(IC_A);
      expect(sessionB.ic).toBe(IC_B);
      expect(sessionA.ic).not.toBe(sessionB.ic);
    });
  });
});
