'use strict';

// icHandler 是纯函数（无副作用、不写文件），最适合作为第一批测试用例
const { validateIC } = require('../icHandler');

describe('icHandler - 身份证格式校验', () => {
  // --- 合法格式 ---
  describe('合法输入', () => {
    test('标准格式带连字符', () => {
      expect(validateIC('900101-14-1234')).toEqual({ valid: true });
    });

    test('纯数字格式（不含连字符）', () => {
      expect(validateIC('900101141234')).toEqual({ valid: true });
    });
  });

  // --- 非法格式 ---
  describe('非法输入', () => {
    test('位数不足', () => {
      const result = validateIC('90010114123');
      expect(result.valid).toBe(false);
      expect(result.message).toBeDefined();
    });

    test('包含字母', () => {
      expect(validateIC('9001011412AB')).toEqual(
        expect.objectContaining({ valid: false })
      );
    });

    test('空字符串', () => {
      expect(validateIC('')).toEqual(
        expect.objectContaining({ valid: false })
      );
    });

    test('null 输入不抛异常', () => {
      expect(() => validateIC(null)).not.toThrow();
      expect(validateIC(null).valid).toBe(false);
    });
  });
});