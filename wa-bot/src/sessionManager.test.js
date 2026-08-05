/**
 * sessionManager unit test
 */

jest.mock('fs');
jest.mock('js-yaml');

jest.mock('./utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// db mock: After Phase 2 migration, sessionManager depends on SQLite and is replaced with memory mock during testing.
jest.mock('./db', () => {
  const sessions = {};
  const stmt = (sql) => ({
    get: jest.fn((...args) => {
      if (sql.includes('SELECT') && sql.includes('sessions')) {
        const phone = args[0];
        return sessions[phone] || undefined;
      }
      return undefined;
    }),
    run: jest.fn((...args) => {
      if (sql.includes('INSERT') || sql.includes('UPDATE')) {
        const phone = args[0];
        sessions[phone] = { phone, name: args[1] || null, ic: args[2], state: args[3], created_at: args[4], updated_at: args[5], receipt_count: args[6] || 0, receipt_count_date: args[7] };
      }
    }),
    all: jest.fn(() => Object.values(sessions)),
  });
  return {
    init: jest.fn(),
    db: { prepare: jest.fn(stmt), exec: jest.fn() },
  };
});

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

    // Initialize mock data
    mockDirs.add(`${PROJECT_ROOT}/data`);
    mockDirs.add(`${PROJECT_ROOT}/config`);
    mockFiles[`${PROJECT_ROOT}/data/sessions.json`] = '{}';
    mockFiles[`${PROJECT_ROOT}/config/config.yaml`] = 'bot:\n  session_timeout_minutes: 30\n  max_receipts_per_day: 5';
  });

  describe('SESSION_STATE', () => {
    test('Status constant exists', () => {
      const { SESSION_STATE } = require('./sessionManager');
      expect(SESSION_STATE.WAITING_IC).toBe('WAITING_IC');
      expect(SESSION_STATE.WAITING_RECEIPT).toBe('WAITING_RECEIPT');
      expect(SESSION_STATE.DONE).toBe('DONE');
    });
  });

  describe('getOrCreateSession', () => {
    test('Creating a new session returns the correct properties', () => {
      const { getOrCreateSession } = require('./sessionManager');
      const session = getOrCreateSession('60123456789');
      expect(session.phone).toBe('60123456789');
      expect(session.state).toBe('WAITING_IC');
    });

    test('Repeated calls return the same session', () => {
      const { getOrCreateSession } = require('./sessionManager');
      const s1 = getOrCreateSession('60123456789');
      const s2 = getOrCreateSession('60123456789');
      // SQLite implements returning a new object every time it is read from DB, as long as the contents are equal (the same reference is not required)
      expect(s1).toStrictEqual(s2);
    });
  });

  describe('updateSession', () => {
    test('Update existing session', () => {
      const { getOrCreateSession, updateSession } = require('./sessionManager');
      getOrCreateSession('60123456789');
      updateSession('60123456789', { ic: '930101-01-1234' });
      const session = getOrCreateSession('60123456789');
      expect(session.ic).toBe('930101-01-1234');
    });

    test('Updating non-existing session throws error', () => {
      const { updateSession } = require('./sessionManager');
      expect(() => updateSession('60199999999', {})).toThrow('Session does not exist');
    });
  });

  describe('checkReceiptLimit', () => {
    test('First request for permission', () => {
      const { getOrCreateSession, checkReceiptLimit } = require('./sessionManager');
      getOrCreateSession('60123456789');
      expect(checkReceiptLimit('60123456789').allowed).toBe(true);
    });

    test('Session does not exist and returns reject', () => {
      const { checkReceiptLimit } = require('./sessionManager');
      expect(checkReceiptLimit('60199999999').allowed).toBe(false);
    });
  });

  describe('incrementReceiptCount', () => {
    test('Count up', () => {
      const { getOrCreateSession, incrementReceiptCount } = require('./sessionManager');
      getOrCreateSession('60123456789');
      incrementReceiptCount('60123456789');
      const session = getOrCreateSession('60123456789');
      expect(session.receiptCount).toBe(1);
    });
  });
});