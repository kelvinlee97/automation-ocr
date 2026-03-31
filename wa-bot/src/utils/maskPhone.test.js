const { maskPhone } = require('./maskPhone');

describe('maskPhone', () => {
  describe('正常脱敏', () => {
    test('标准 WhatsApp 格式', () => {
      expect(maskPhone('60123456789@c.us')).toBe('601****789@c.us');
    });

    test('无后缀格式', () => {
      expect(maskPhone('60123456789')).toBe('601****789');
    });

    test('长号码', () => {
      expect(maskPhone('6011234567890@c.us')).toBe('601****890@c.us');
    });
  });

  describe('边界情况', () => {
    test('空字符串', () => {
      expect(maskPhone('')).toBe('[unknown]');
    });

    test('null', () => {
      expect(maskPhone(null)).toBe('[unknown]');
    });

    test('undefined', () => {
      expect(maskPhone(undefined)).toBe('[unknown]');
    });

    test('短号码 <= 5 位', () => {
      expect(maskPhone('60123@c.us')).toBe('60***3@c.us');
    });

    test('6位号码', () => {
      expect(maskPhone('601234@c.us')).toBe('601****234@c.us');
    });
  });

  describe('格式容错', () => {
    test('只有后缀无号码', () => {
      expect(maskPhone('@c.us')).toBe('***@c.us');
    });

    test('非标准后缀', () => {
      expect(maskPhone('60123456789@g.us')).toBe('601****789@g.us');
    });
  });
});