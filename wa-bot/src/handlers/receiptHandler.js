/**
 * receiptHandler.js — receipt image processor
 * Bot silent mode: only saves pictures and does not send any reply to the user
 */

const { addPendingReceipt, getActiveCampaign } = require("../services/receiptStore");
const logger = require("../utils/logger");
const { maskPhone } = require("../utils/maskPhone");

/**
 * Process receipt images sent by users
 * Download images → persist to data/images/ → record pending_review status
 * AI recognition is automatically triggered (no need for Admin to click manually)
 *
 * @param {import('whatsapp-web.js').Message} msg
 * @param {Object} session current user session object (from sessionManager, including ic and name fields)
 * @param {string} phone real mobile phone number (parsed from LID)
 * @param {number} [campaignId] Current active Campaign ID (optional, from multi-Client architecture)
 */
async function handleReceipt(msg, session, phone, campaignId = null) {
  if (!msg.hasMedia) {
    logger.debug("Message has no attachments, ignore", { phone: maskPhone(phone) });
    return;
  }

  try {
    const media = await msg.downloadMedia();

    // name comes from session, ic comes from session
    // campaignId comes from parameters (multi-Client architecture), if it is null, query the currently active Campaign
    const effectiveCampaignId = campaignId ?? await getActiveCampaign();
    addPendingReceipt(phone, media.data, media.mimetype, session.ic ?? null, session.name ?? null, effectiveCampaignId);

    logger.info("The receipt has been saved and is awaiting manual review", { phone: maskPhone(phone), campaignId: effectiveCampaignId });
  } catch (err) {
    logger.error("Receipt saving failed", { phone: maskPhone(phone), error: err.message });
  }
}

module.exports = { handleReceipt };
