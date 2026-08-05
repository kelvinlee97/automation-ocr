const { maskPhone } = require('./maskPhone');

describe('maskPhone', () => {
  describe('normal desensitization', () => {
    test('Standard WhatsApp format', () => {
      expect(maskPhone('60123456789@c.us')).toBe('601****789@c.us');
    });

    test('No suffix format', () => {
      expect(maskPhone('60123456789')).toBe('601****789');
    });

    test('long number', () => {
      expect(maskPhone('6011234567890@c.us')).toBe('601****890@c.us');
    });
  });

  describe('boundary case', () => {
    test('empty string', () => {
      expect(maskPhone('')).toBe('[unknown]');
    });

    test('null', () => {
      expect(maskPhone(null)).toBe('[unknown]');
    });

    test('undefined', () => {
      expect(maskPhone(undefined)).toBe('[unknown]');
    });

    test('Short number <= 5 digits', () => {
      expect(maskPhone('60123@c.us')).toBe('60***3@c.us');
    });

    test('6 digit number', () => {
      expect(maskPhone('601234@c.us')).toBe('601****234@c.us');
    });
  });

  describe('Format tolerance', () => {
    test('Only suffix and no number', () => {
      expect(maskPhone('@c.us')).toBe('***@c.us');
    });

    test('non-standard suffix', () => {
      expect(maskPhone('60123456789@g.us')).toBe('601****789@g.us');
    });
  });
});