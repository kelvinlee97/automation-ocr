'use strict';

// icParser 是纯函数（无副作用、不写文件），最适合作为第一批测试用例
const { validateIC } = require('../../utils/icParser');

describe('icParser - 身份证格式校验', () => {
  // --- 合法格式 ---
  describe('合法输入', () => {
    test('标准格式带连字符', () => {
      const result = validateIC('900101-14-1234');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('900101-14-1234');
    });

    test('纯数字格式（不含连字符）', () => {
      const result = validateIC('900101141234');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('900101-14-1234');
    });
  });

  // --- 非法格式 ---
  describe('非法输入', () => {
    test('位数不足', () => {
      const result = validateIC('90010114123');
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
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
