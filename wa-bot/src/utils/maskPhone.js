/**
 * maskPhone.js — Phone number masking tool
 *
 * Specifically handles phone numbers in WhatsApp format (e.g. "60123456789@c.us")
 * Output format: Keep the country code prefix and the last 3 digits, replace the middle with ****
 * Example: 60123456789@c.us → 601****789@c.us
 *
 * Purpose: Desensitization during log output to prevent PII from leaking to log files or CI output
 */

/**
 * @param {string} phone WhatsApp format phone number (including @c.us suffix)
 * @returns {string} Phone number after desensitization
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '[unknown]';

  // Separate number body and @c.us suffix
  const atIndex = phone.indexOf('@');
  const number = atIndex > -1 ? phone.slice(0, atIndex) : phone;
  const suffix = atIndex > -1 ? phone.slice(atIndex) : '';

  // If the number is too short, only the first 2 digits will be retained to avoid complete exposure.
  if (number.length <= 5) return `${number.slice(0, 2)}***${number.slice(-1)}${suffix}`;

  // Keep the first 3 digits (usually the country code, such as 601) and the last 3 digits, and desensitize the middle
  return `${number.slice(0, 3)}****${number.slice(-3)}${suffix}`;
}

module.exports = { maskPhone };
