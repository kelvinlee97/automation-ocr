/**
 * registrationHandler.js — IC 注册处理器
 * Bot 静默模式：只验证并保存，不向用户发送任何回复
 */

const icParser = require("../utils/icParser");
const { addRegistration } = require("../services/excelService");
const logger = require("../utils/logger");
const { maskPhone } = require("../utils/maskPhone");

/**
 * 处理用户提交的 IC 号码
 * 验证格式 → 写入 Excel → 更新 session（ic + state）
 * 失败时静默记录日志，不回复用户
 *
 * @param {import('whatsapp-web.js').Message} msg
 * @param {Object} session  当前用户 session 对象（来自 sessionManager）
 * @param {Object} sessionManager
 */
async function handleRegistration(msg, session, sessionManager) {
  const text = msg.body.trim();
  const ic = icParser.validateIC(text);

  if (!ic) {
    // IC 格式不对，静默忽略（用户可能只是发了普通文字）
    logger.debug("IC 格式无效，忽略", { phone: maskPhone(msg.from), text: text.slice(0, 20) });
    return;
  }

  try {
    const result = await addRegistration(msg.from, ic);

    if (result.duplicate) {
      // 重复注册，记录日志，session 仍更新以允许继续提交收据
      logger.info("重复注册，已允许继续提交收据", { phone: maskPhone(msg.from) });
    }

    // 无论首次还是重复注册，都将 IC 写入 session，允许后续提交收据
    session.ic = ic;
    session.state = "WAITING_RECEIPT";
    sessionManager.updateSession(msg.from, session);
    logger.info("IC 注册完成，等待收据", { phone: maskPhone(msg.from) });

  } catch (err) {
    logger.error("IC 注册失败", { phone: maskPhone(msg.from), error: err.message });
  }
}

module.exports = { handleRegistration };
