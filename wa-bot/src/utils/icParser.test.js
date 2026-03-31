const { validateIC } = require('./icParser');

describe('validateIC', () => {
  describe('有效 IC', () => {
    test('标准格式 930101-01-1234', () => {
      const result = validateIC('930101-01-1234');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('930101-01-1234');
      expect(result.reason).toBeNull();
    });

    test('12位纯数字自动补连字符', () => {
      const result = validateIC('930101011234');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('930101-01-1234');
    });

    test('带空格输入', () => {
      const result = validateIC('  930101-01-1234  ');
      expect(result.valid).toBe(true);
    });
  });

  describe('无效 IC - 格式错误', () => {
    test('空输入', () => {
      const result = validateIC('');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('输入为空');
    });

    test('null', () => {
      const result = validateIC(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('输入为空');
    });

    test('undefined', () => {
      const result = validateIC(undefined);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('输入为空');
    });

    test('少于12位数字', () => {
      const result = validateIC('93010101123');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('格式不正确，应为 XXXXXX-XX-XXXX');
    });

    test('超过12位数字', () => {
      const result = validateIC('9301010112345');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('格式不正确，应为 XXXXXX-XX-XXXX');
    });

    test('字母干扰', () => {
      const result = validateIC('930101-0A-1234');
      expect(result.valid).toBe(false);
    });
  });

  describe('无效 IC - 出生日期', () => {
    test('月份 00 无效', () => {
      const result = validateIC('000000-01-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('出生日期无效');
    });

    test('月份 13 无效', () => {
      const result = validateIC('931301-01-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('出生日期无效');
    });

    test('日期 00 无效', () => {
      const result = validateIC('930100-01-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('出生日期无效');
    });

    test('日期 32 无效', () => {
      const result = validateIC('930132-01-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('出生日期无效');
    });
  });

  describe('无效 IC - 州代码', () => {
    test('无效州代码 00', () => {
      const result = validateIC('930101-00-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('州代码无效');
    });

    test('无效州代码 99', () => {
      const result = validateIC('930101-99-1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('州代码无效');
    });
  });

  describe('有效州代码', () => {
    test('州代码 01-16', () => {
      for (let i = 1; i <= 16; i++) {
        const code = String(i).padStart(2, '0');
        const result = validateIC(`930101-${code}-1234`);
        expect(result.valid).toBe(true);
      }
    });

    test('州代码 21-22', () => {
      const result = validateIC('930101-21-1234');
      expect(result.valid).toBe(true);
    });
  });
});