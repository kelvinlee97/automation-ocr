const { addPendingReceipt } = require("../services/receiptStore");
const logger = require("../utils/logger");

async function handleReceipt(msg, session) {
  // Bot 完全静默：收到图片只保存，不向用户发任何回复
  if (!msg.hasMedia) {
    // 非图片消息静默忽略
    return;
  }

  try {
    const media = await msg.downloadMedia();

    // 将图片持久化到 data/images/，记录 pending_review 状态
    // AI 识别延后到管理后台由人工触发
    addPendingReceipt(msg.from, media.data, media.mimetype, session.ic ?? null);

    logger.info("收据已保存，等待人工审核", { phone: msg.from });
  } catch (error) {
    logger.error("收据保存失败", { error: error.message, phone: msg.from });
  }
}

module.exports = { handleReceipt };
