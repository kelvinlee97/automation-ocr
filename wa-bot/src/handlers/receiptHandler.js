/**
 * receiptHandler.js — 收据图片处理器
 * Bot 静默模式：只保存图片，不向用户发送任何回复
 */

const { addPendingReceipt } = require("../services/receiptStore");
const logger = require("../utils/logger");
const { maskPhone } = require("../utils/maskPhone");

/**
 * 处理用户发送的收据图片
 * 下载图片 → 持久化到 data/images/ → 记录 pending_review 状态
 * AI 识别延后到管理后台由人工触发，避免 WhatsApp 超时
 *
 * @param {import('whatsapp-web.js').Message} msg
 * @param {Object} session  当前用户 session 对象（来自 sessionManager，含 ic 字段）
 */
async function handleReceipt(msg, session) {
  if (!msg.hasMedia) {
    logger.debug("消息无附件，忽略", { phone: maskPhone(msg.from) });
    return;
  }

  try {
    const media = await msg.downloadMedia();

    // ic 来自 session，若用户跳过 IC 注册直接发图也能保存，ic 为 null
    addPendingReceipt(msg.from, media.data, media.mimetype, session.ic ?? null);

    logger.info("收据已保存，等待人工审核", { phone: maskPhone(msg.from) });
  } catch (err) {
    logger.error("收据保存失败", { phone: maskPhone(msg.from), error: err.message });
  }
}

module.exports = { handleReceipt };
