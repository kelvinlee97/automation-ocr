/**
 * maskPhone.js — 电话号码脱敏工具
 *
 * 专门处理 WhatsApp 格式的电话号码（如 "60123456789@c.us"）
 * 输出格式：保留国家码前缀和末 3 位，中间替换为 ****
 * 示例：60123456789@c.us → 601****789@c.us
 *
 * 用途：日志输出时脱敏，防止 PII 泄漏到日志文件或 CI 输出
 */

/**
 * @param {string} phone  WhatsApp 格式电话号码（含 @c.us 后缀）
 * @returns {string}      脱敏后的电话号码
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '[unknown]';

  // 分离号码主体和 @c.us 后缀
  const atIndex = phone.indexOf('@');
  const number = atIndex > -1 ? phone.slice(0, atIndex) : phone;
  const suffix = atIndex > -1 ? phone.slice(atIndex) : '';

  // 号码过短时只保留前 2 位，避免完整暴露
  if (number.length <= 5) return `${number.slice(0, 2)}***${number.slice(-1)}${suffix}`;

  // 保留前 3 位（通常是国家码，如 601）和末 3 位，中间脱敏
  return `${number.slice(0, 3)}****${number.slice(-3)}${suffix}`;
}

module.exports = { maskPhone };
