/**
 * receiptHandler.js — 收据图片处理器
 * Bot 静默模式：只保存图片，不向用户发送任何回复
 */

const { addPendingReceipt, getActiveCampaign } = require("../services/receiptStore");
const logger = require("../utils/logger");
const { maskPhone } = require("../utils/maskPhone");

/**
 * 处理用户发送的收据图片
 * 下载图片 → 持久化到 data/images/ → 记录 pending_review 状态
 * AI 识别自动触发（不需要 Admin 手动点击）
 *
 * @param {import('whatsapp-web.js').Message} msg
 * @param {Object} session  当前用户 session 对象（来自 sessionManager，含 ic 和 name 字段）
 * @param {string} phone    真实手机号（已从 LID 解析）
 * @param {number} [campaignId]  当前活跃 Campaign ID（可选，来自多 Client 架构）
 */
async function handleReceipt(msg, session, phone, campaignId = null) {
  if (!msg.hasMedia) {
    logger.debug("消息无附件，忽略", { phone: maskPhone(phone) });
    return;
  }

  try {
    const media = await msg.downloadMedia();

    // name 来自 session，ic 来自 session
    // campaignId 来自参数（多 Client 架构），若为 null 则查询当前活跃 Campaign
    const effectiveCampaignId = campaignId ?? await getActiveCampaign();
    addPendingReceipt(phone, media.data, media.mimetype, session.ic ?? null, session.name ?? null, effectiveCampaignId);

    logger.info("收据已保存，等待人工审核", { phone: maskPhone(phone), campaignId: effectiveCampaignId });
  } catch (err) {
    logger.error("收据保存失败", { phone: maskPhone(phone), error: err.message });
  }
}

module.exports = { handleReceipt };
