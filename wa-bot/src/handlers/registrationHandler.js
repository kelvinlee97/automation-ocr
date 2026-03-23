const icParser = require("../utils/icParser");
const { addRegistration } = require("../services/excelService");
const logger = require("../utils/logger");

async function handleRegistration(msg, session, sessionManager) {
  // Bot 完全静默：验证通过只保存，不向用户发任何回复
  const text = msg.body.trim();
  const ic = icParser.validateIC(text);

  // IC 格式无效，静默忽略
  if (!ic) {
    return;
  }

  // 调用 Excel 服务记录注册信息
  const result = await addRegistration(msg.from, ic);

  if (result.success) {
    // IC 验证通过，推进会话状态到等待收据
    session.ic = ic;
    session.state = "WAITING_RECEIPT";
    sessionManager.updateSession(msg.from, session);
    logger.info("用户注册成功", { phone: msg.from, ic });
  } else if (result.duplicate) {
    // 重复注册，仍推进状态（允许继续提交收据）
    session.ic = ic;
    session.state = "WAITING_RECEIPT";
    sessionManager.updateSession(msg.from, session);
    logger.info("重复注册，推进至收据状态", { phone: msg.from, ic });
  } else {
    logger.error("注册写入失败", { phone: msg.from, ic });
  }
}

module.exports = { handleRegistration };
