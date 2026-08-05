'use strict';

// icParser is a pure function (no side effects, no writing files), which is most suitable for the first batch of test cases.
const { validateIC } = require('../../utils/icParser');

describe('icParser - ID card format verification', () => {
  // --- Legal format ---
  describe('Legal input', () => {
    test('Standard format with hyphens', () => {
      const result = validateIC('900101-14-1234');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('900101-14-1234');
    });

    test('Pure numeric format (without hyphens)', () => {
      const result = validateIC('900101141234');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('900101-14-1234');
    });
  });

  // ---Illegal format ---
  describe('Illegal input', () => {
    test('Not enough digits', () => {
      const result = validateIC('90010114123');
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    test('contains letters', () => {
      expect(validateIC('9001011412AB')).toEqual(
        expect.objectContaining({ valid: false })
      );
    });

    test('empty string', () => {
      expect(validateIC('')).toEqual(
        expect.objectContaining({ valid: false })
      );
    });

    test('Null input does not throw an exception', () => {
      expect(() => validateIC(null)).not.toThrow();
      expect(validateIC(null).valid).toBe(false);
    });
  });
});
