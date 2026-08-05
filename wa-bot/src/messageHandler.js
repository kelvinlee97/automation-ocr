/**
 * messageHandler.js — message routing dispatcher
 *
 * Bot silent mode: only saves the received message and does not send any reply to the user
 *
 * Routing logic:
 *   Text message → registrationHandler (IC format verification + write session)
 *   Picture message → receiptHandler (save the picture and bring session.ic)
 *   Other types → silently ignore
 *
 * The session is obtained uniformly at the routing entrance to ensure that the two handlers get the same context object.
 */

const { handleReceipt } = require("./handlers/receiptHandler");
const { handleRegistration } = require("./handlers/registrationHandler");
const sessionManager = require("./sessionManager");
const logger = require("./utils/logger");
const { maskPhone } = require("./utils/maskPhone");

/**
 * Main message processing entrance
 * @param {import('whatsapp-web.js').Message} message
 * @param {string} phone - real phone number (parsed from LID)
 */
async function handleMessage(message, phone) {
  // Ignore group messages and WhatsApp Status (status@broadcast), only handle private chats
  if (message.from === 'status@broadcast') return;
  const chat = await message.getChat();
  if (chat.isGroup) return;
  // Prevent contacts from being missed when posting WhatsApp Status updates:
  // In this type of message message.from is the contact's real number, but the chat ID is status@broadcast
  if (chat.id._serialized === 'status@broadcast') return;

  logger.debug("message received", {
    phone: maskPhone(phone),
    type: message.type,
  });

  // Obtain/create sessions uniformly at the routing entrance to ensure that fields such as ic can be correctly passed to each handler
  const session = await sessionManager.getOrCreateSession(phone);

  try {
    if (message.type === "chat") {
      // Text message → try to parse to IC number
      await handleRegistration(message, session, sessionManager, phone);
    } else if (message.hasMedia && message.type === "image") {
      // Image message → Save receipt (carries session.ic)
      await handleReceipt(message, session, phone);
      // Mixed text and graphics: If the message also contains text, try to parse the IC
      if (message.body && message.body.trim()) {
        await handleRegistration(message, session, sessionManager, phone);
      }
    }
    // Other types (voice, stickers, files, etc.) → silently ignore
  } catch (err) {
    logger.error("Message processing exception", { phone: maskPhone(phone), error: err.message, stack: err.stack });
  }
}

module.exports = { handleMessage };
