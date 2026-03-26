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
 * session 在路由入口统一获取，确保两个 handler 拿到同一个上下文对象
 */

const { handleReceipt } = require("./handlers/receiptHandler");
const { handleRegistration } = require("./handlers/registrationHandler");
const sessionManager = require("./sessionManager");
const logger = require("./utils/logger");
const { maskPhone } = require("./utils/maskPhone");

/**
 * 主消息处理入口
 * @param {import('whatsapp-web.js').Message} message
 */
async function handleMessage(message) {
  // 忽略群组消息和 WhatsApp Status（status@broadcast），只处理私聊
  if (message.from === 'status@broadcast') return;
  const chat = await message.getChat();
  if (chat.isGroup) return;
  // 防止联系人发布 WhatsApp Status 动态时漏网：
  // 此类消息 message.from 是联系人真实号码，但 chat ID 为 status@broadcast
  if (chat.id._serialized === 'status@broadcast') return;

  const phone = message.from;

  logger.debug("收到消息", {
    phone: maskPhone(phone),
    type: message.type,
  });

  // 在路由入口统一获取/创建 session，确保 ic 等字段能正确传给各 handler
  const session = sessionManager.getOrCreateSession(phone);

  try {
    if (message.type === "chat") {
      // 文字消息 → 尝试解析为 IC 号码
      await handleRegistration(message, session, sessionManager);
    } else if (message.hasMedia && message.type === "image") {
      // 图片消息 → 保存收据（携带 session.ic）
      await handleReceipt(message, session);
    }
    // 其他类型（语音、贴纸、文件等）→ 静默忽略
  } catch (err) {
    logger.error("消息处理异常", { phone: maskPhone(phone), error: err.message, stack: err.stack });
  }
}

module.exports = { handleMessage };
