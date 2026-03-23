/**
 * messageHandler.js — 消息路由分发器
 *
 * Bot 静默模式：收到消息只保存，不向用户发送任何回复
 *
 * 路由逻辑：
 *   文字消息 → registrationHandler（IC 格式验证 + 写 session）
 *   图片消息 → receiptHandler（保存图片，带上 session.ic）
 *   其他类型 → 静默忽略
 *
 * session 在路由入口统一获取，确保 receiptHandler 能拿到含 ic 的完整上下文
 */

const { handleReceipt } = require("./handlers/receiptHandler");
const { handleRegistration } = require("./handlers/registrationHandler");
const sessionManager = require("./sessionManager");
const logger = require("./utils/logger");

/**
 * 主消息处理入口
 * @param {import('whatsapp-web.js').Message} message
 */
async function handleMessage(message) {
  // 忽略群组消息，只处理私聊
  const chat = await message.getChat();
  if (chat.isGroup) return;

  const phone = message.from;

  logger.debug("收到消息", {
    phone,
    type: message.type,
    body: message.body?.slice(0, 50),
  });

  // 路由入口统一获取 session，receiptHandler 从这里取 session.ic
  const session = sessionManager.getOrCreateSession(phone);

  try {
    if (message.type === "chat") {
      // 文字消息 → 尝试解析为 IC 号码，更新 session.ic
      await handleRegistration(message, session, sessionManager);
    } else if (message.hasMedia && message.type === "image") {
      // 图片消息 → 保存收据（session.ic 已在上一步文字消息中写入）
      await handleReceipt(message, session);
    }
    // 其他类型（语音、贴纸、文件等）→ 静默忽略
  } catch (err) {
    logger.error("消息处理异常", { phone, error: err.message, stack: err.stack });
  }
}

module.exports = { handleMessage };
