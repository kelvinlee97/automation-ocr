/**
 * registrationHandler.js — IC registration handler
 * Bot silent mode: only verifies and saves, does not send any reply to the user
 */

const icParser = require("../utils/icParser");
const { addRegistration } = require("../services/excelService");
const logger = require("../utils/logger");
const { maskPhone } = require("../utils/maskPhone");

/**
 * Processing of user-submitted IC numbers
 * Verify format → Write to Excel → Update session (ic + state)
 * Log silently on failure and do not reply to the user
 *
 * @param {import('whatsapp-web.js').Message} msg
 * @param {Object} session current user session object (from sessionManager)
 * @param {Object} sessionManager
 * @param {string} phone real mobile phone number (parsed from LID)
 */
async function handleRegistration(msg, session, sessionManager, phone) {
  const text = msg.body.trim();
  // validateIC returns { valid, normalized, reason }, which needs to be deconstructed before use
  const { valid, normalized } = icParser.validateIC(text);

  if (!valid) {
    // The IC format is incorrect and will be ignored silently (the user may have just sent ordinary text)
    logger.debug("IC format is invalid, ignore", { phone: maskPhone(phone), text: text.slice(0, 20) });
    return;
  }

  try {
    const result = await addRegistration(phone, normalized);

    if (result.duplicate) {
      // Repeated registration, logging, session still updated to allow continued submission of receipts
      logger.info("Duplicate registration accepted; user may continue submitting receipts", { phone: maskPhone(phone) });
    }

    // Regardless of first or repeated registration, the standardized IC is written to the session, allowing subsequent receipt submissions
    session.ic = normalized;
    session.state = "WAITING_RECEIPT";
    await sessionManager.updateSession(phone, session);
    logger.info("IC registration completed, waiting for receipt", { phone: maskPhone(phone) });

  } catch (err) {
    logger.error("IC registration failed", { phone: maskPhone(phone), error: err.message });
  }
}

module.exports = { handleRegistration };
