const { validateIC } = require('./icParser');

describe('validateIC', () => {
  describe('Valid IC', () => {
    test('Standard format 930101-01-1234', () => {
      const result = validateIC('930101-01-1234');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('930101-01-1234');
      expect(result.reason).toBeNull();
    });

    test('12-digit pure numbers automatically add hyphens', () => {
      const result = validateIC('930101011234');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('930101-01-1234');
    });

    test('Enter with spaces', () => {
      const result = validateIC('  930101-01-1234  ');
      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid IC - Bad format', () => {
    test('Empty input', () => {
      const result = validateIC('');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Input is empty');
    });

    test('null', () => {
      const result = validateIC(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Input is empty');
    });

    test('undefined', () => {
      const result = validateIC(undefined);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Input is empty');
    });

    test('Less than 12 digits', () => {
      const result = validateIC('93010101123');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Incorrect format, should be XXXXXX-XX-XXXX');
    });

    test('More than 12 digits', () => {
      const result = validateIC('9301010112345');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Incorrect format, should be XXXXXX-XX-XXXX');
    });

    test('letter interference', () => {
      const result = validateIC('930101-0A-1234');
      expect(result.valid).toBe(false);
    });
  });

  describe('Invalid IC - Date of Birth', () => {
    test('Month 00 is invalid', () => {
      const result = validateIC('000000-01-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid date of birth');
    });

    test('Month 13 is invalid', () => {
      const result = validateIC('931301-01-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid date of birth');
    });

    test('Date 00 is invalid', () => {
      const result = validateIC('930100-01-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid date of birth');
    });

    test('Date 32 is invalid', () => {
      const result = validateIC('930132-01-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid date of birth');
    });
  });

  describe('Invalid IC - State Code', () => {
    test('Invalid state code 00', () => {
      const result = validateIC('930101-00-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid state code');
    });

    test('Invalid state code 99', () => {
      const result = validateIC('930101-99-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid state code');
    });
  });

  describe('Valid state code', () => {
    test('State code 01-16', () => {
      for (let i = 1; i <= 16; i++) {
        const code = String(i).padStart(2, '0');
        const result = validateIC(`930101-${code}-1234`);
        expect(result.valid).toBe(true);
      }
    });

    test('State code 21-22', () => {
      const result = validateIC('930101-21-1234');
      expect(result.valid).toBe(true);
    });
  });
});