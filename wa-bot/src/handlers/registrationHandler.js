const icParser = require("../utils/icParser");
const { addRegistration } = require("../services/excelService");
const yaml = require("js-yaml");
const fs = require("fs");
const path = require("path");

const messages = yaml.load(fs.readFileSync(path.join(__dirname, "../../../config/messages.yaml"), "utf8"));

async function handleRegistration(msg, session, sessionManager) {
  const text = msg.body.trim();
  const ic = icParser.validateIC(text);

  if (!ic) {
    await msg.reply(messages.registration.invalid_ic);
    return;
  }

  // 调用 Excel 服务记录注册信息
  const result = await addRegistration(msg.from, ic);

  if (!result.success && result.duplicate) {
    await msg.reply(messages.registration.duplicate);
    return;
  }

  if (result.success) {
    session.ic = ic;
    session.state = "WAITING_RECEIPT";
    sessionManager.updateSession(msg.from, session);
    await msg.reply(messages.registration.success);
  } else {
    await msg.reply("注册服务暂时不可用，请稍后再试。");
  }
}

module.exports = { handleRegistration };
