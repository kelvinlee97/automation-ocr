/**
 * simulation.test.js — End-to-end user process simulation testing
 *
 * Simulate complete WhatsApp user interaction: send mobile phone number → send IC → send screenshot of receipt
 * Mock boundaries: excelService (Excel writing), receiptStore (file persistence), logger
 * Real run: messageHandler → handler logical chain + sessionManager state flow
 *
 * Reusability: Construct message objects for different scenarios through the createMockMessage() factory function.
 * Each describe block represents a user behavior scenario and can be run independently
 */

// ─── mock system boundary: file I/O ───────────────────────────────────────────────

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
  getActiveCampaign: jest.fn().mockReturnValue(null),
}));

// db mock: After Phase 2 migration, sessionManager depends on SQLite and is replaced with memory mock during testing.
jest.mock('./db', () => {
  const sessions = {};
  const stmt = (sql) => ({
    get: jest.fn((...args) => {
      if (sql.includes('SELECT') && sql.includes('sessions')) {
        return sessions[args[0]] || undefined;
      }
      return undefined;
    }),
    run: jest.fn((...args) => {
      if (sql.includes('INSERT') || sql.includes('UPDATE')) {
        sessions[args[0]] = { phone: args[0], name: args[1] || null, ic: args[2], state: args[3], created_at: args[4], updated_at: args[5], receipt_count: args[6] || 0, receipt_count_date: args[7] };
      }
    }),
    all: jest.fn(() => Object.values(sessions)),
  });
  return {
    init: jest.fn(),
    db: { prepare: jest.fn(stmt), exec: jest.fn() },
  };
});

// ─── fs mock: memory simulation file system (reusing sessionManager.test.js mode)────────

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

// ───Factory function ────────────────────────────────────────────────────────────

/**
 * Constructing a simulated WhatsApp text message
 * @param {Object} opts
 * @param {string} opts.from - sender number, default test number
 * @param {string} opts.body - message text
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
 * Constructing a simulated WhatsApp picture message (receipt screenshot)
 * @param {Object} opts
 * @param {string} opts.from - Sender number
 * @param {string} opts.base64 - Image Base64 data (without data: prefix)
 * @param {string} opts.mimeType - MIME type, default image/jpeg
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

// Minimum valid 1x1 pixel JPEG of Base64 (for testing, no real receipt required)
const MOCK_RECEIPT_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB' +
  'AxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEA//EAB4QAAICAgMBAAAAAAAAAAAAAAECAxEEITFB/8QA' +
  'FABAQAAAAAAAAAAAAAAAAAAAAP/EABURAQEAAAAAAAAAAAAAAAAAAAAB/9oADAMBAAIRAxEAPwCwABmS' +
  'lJRXoV5rNj//2Q==';

// Valid Malaysian IC number (for testing)
const VALID_IC = '930101-01-1234';
const TEST_PHONE = '60123456789@c.us';

// ───Test Suite────────────────────────────────────────────────────────────

describe('User flow simulation', () => {

  beforeEach(() => {
    // Reset the module to ensure sessionManager internal state is not polluted across tests
    jest.resetModules();

    // Reset mock file system
    Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
    mockDirs.clear();

    // Initialize the directories and files that sessionManager depends on
    mockDirs.add(`${PROJECT_ROOT}/data`);
    mockFiles[`${PROJECT_ROOT}/data/sessions.json`] = '{}';
    // sessionManager reads configuration from wa-bot/config/config.yaml
    mockDirs.add(`${PROJECT_ROOT}/config`);
    mockFiles[`${PROJECT_ROOT}/config/config.yaml`] = 'bot:\n  session_timeout_minutes: 30\n  max_receipts_per_day: 5';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Scenario 1: Normal complete process ─────────────────────────────────────────────────

  describe('Scenario 1: IC registration → Submit screenshot of receipt', () => {
    test('Send a valid IC and the session status changes to WAITING_RECEIPT', async () => {
      const { handleMessage } = require('./messageHandler');
      const sessionManager    = require('./sessionManager');
      const excelService      = require('./services/excelService');

      const msg = createTextMessage({ body: VALID_IC });
      await handleMessage(msg, TEST_PHONE);

      // The session should log the IC and wait for the receipt
      const session = sessionManager.getOrCreateSession(TEST_PHONE);
      expect(session.ic).toBe(VALID_IC);
      expect(session.state).toBe('WAITING_RECEIPT');

      // Excel write should be called once, passing in the normalized IC string
      expect(excelService.addRegistration).toHaveBeenCalledWith(TEST_PHONE, VALID_IC);
    });

    test('After IC registration, pictures are sent and the receipt is successfully saved.', async () => {
      const { handleMessage } = require('./messageHandler');
      const receiptStore      = require('./services/receiptStore');

      // first-issue IC
      const icMsg = createTextMessage({ body: VALID_IC });
      await handleMessage(icMsg, TEST_PHONE);

      // Reissue receipt picture
      const imgMsg = createImageMessage();
      await handleMessage(imgMsg, TEST_PHONE);

      // Receipt should bring registered IC
      expect(receiptStore.addPendingReceipt).toHaveBeenCalledWith(
        TEST_PHONE,
        MOCK_RECEIPT_BASE64,
        'image/jpeg',
        VALID_IC,   // session.ic should be passed in
        null,       // name
        null,       // campaignId
      );
    });
  });

  // ── Scenario 2: Send pictures first (skip IC registration)───────────────────────────────────────

  describe('Scenario 2: Submit receipt directly without registering IC', () => {
    test('The image should still be saved, the ic field is null', async () => {
      const { handleMessage } = require('./messageHandler');
      const receiptStore      = require('./services/receiptStore');

      const imgMsg = createImageMessage();
      await handleMessage(imgMsg, TEST_PHONE);

      expect(receiptStore.addPendingReceipt).toHaveBeenCalledWith(
        TEST_PHONE,
        MOCK_RECEIPT_BASE64,
        'image/jpeg',
        null,   // IC is not registered, pass null
        null,   // name
        null,   // campaignId
      );
    });
  });

  // ── Scenario 3: Invalid IC format ─────────────────────────────────────────────────

  describe('Scenario 3: Sending invalid IC format', () => {
    test('Invalid ICs are silently ignored and the session remains in WAITING_IC state.', async () => {
      const { handleMessage } = require('./messageHandler');
      const sessionManager    = require('./sessionManager');
      const excelService      = require('./services/excelService');

      const msg = createTextMessage({ body: 'Not an ID number hello' });
      await handleMessage(msg, TEST_PHONE);

      const session = sessionManager.getOrCreateSession(TEST_PHONE);
      expect(session.state).toBe('WAITING_IC');  // Status unchanged
      expect(excelService.addRegistration).not.toHaveBeenCalled();
    });

    test('Inputs that are purely numeric but have the wrong number of digits are ignored.', async () => {
      const { handleMessage } = require('./messageHandler');
      const excelService      = require('./services/excelService');

      const msg = createTextMessage({ body: '12345678' });  // Only 8 bits, not 12 bits
      await handleMessage(msg, TEST_PHONE);

      expect(excelService.addRegistration).not.toHaveBeenCalled();
    });
  });

  // ── Scenario 4: Repeated registration of the same IC ──────────────────────────────────────────────

  describe('Scenario 4: Repeated registration', () => {
    test('Send IC repeatedly and still allow receipt submissions to continue', async () => {
      const { handleMessage } = require('./messageHandler');
      const sessionManager    = require('./sessionManager');
      const excelService      = require('./services/excelService');

      // excelService returns duplicate: true
      excelService.addRegistration.mockResolvedValue({ duplicate: true });

      const msg = createTextMessage({ body: VALID_IC });
      await handleMessage(msg, TEST_PHONE);

      const session = sessionManager.getOrCreateSession(TEST_PHONE);
      // Repeated registrations should also update the session, allowing continued submission of receipts
      expect(session.state).toBe('WAITING_RECEIPT');
    });
  });

  // ── Scenario 5: Group messages and Status broadcasts should be ignored ──────────────────────────────────

  describe('Scenario 5: Non-private message filtering', () => {
    test('Group messages are ignored and no session is created', async () => {
      const { handleMessage } = require('./messageHandler');
      const receiptStore      = require('./services/receiptStore');
      const excelService      = require('./services/excelService');

      // Construct group message (isGroup = true)
      const groupMsg = createTextMessage({ body: VALID_IC });
      groupMsg.getChat = jest.fn().mockResolvedValue({ isGroup: true, id: { _serialized: 'group-id@g.us' } });

      await handleMessage(groupMsg);

      expect(excelService.addRegistration).not.toHaveBeenCalled();
      expect(receiptStore.addPendingReceipt).not.toHaveBeenCalled();
    });

    test('WhatsApp Status broadcast ignored', async () => {
      const { handleMessage } = require('./messageHandler');

      const statusMsg = createTextMessage({ from: 'status@broadcast', body: VALID_IC });
      await handleMessage(statusMsg);

      const excelService = require('./services/excelService');
      expect(excelService.addRegistration).not.toHaveBeenCalled();
    });
  });

  // ── Scenario 6: Concurrent submission by multiple users (each session is isolated) ──────────────────────────────

  describe('Scenario 6: Multi-user sessions are independent and do not interfere with each other', () => {
    test('The two users complete the registration independently, and the sessions do not affect each other.', async () => {
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

      await handleMessage(msgA, PHONE_A);
      await handleMessage(msgB, PHONE_B);

      const sessionA = sessionManager.getOrCreateSession(PHONE_A);
      const sessionB = sessionManager.getOrCreateSession(PHONE_B);

      expect(sessionA.ic).toBe(IC_A);
      expect(sessionB.ic).toBe(IC_B);
      expect(sessionA.ic).not.toBe(sessionB.ic);
    });
  });
});
