const { processReceipt } = require("../services/aiService");
const { addReceipt } = require("../services/excelService");
const yaml = require("js-yaml");
const fs = require("fs");
const path = require("path");

const messages = yaml.load(fs.readFileSync(path.join(__dirname, "../../../config/messages.yaml"), "utf8"));

async function handleReceipt(msg, session) {
  if (!msg.hasMedia) {
    await msg.reply(messages.receipt.invalid_type);
    return;
  }

  // 给用户初步反馈
  await msg.reply(messages.receipt.processing);

  try {
    const media = await msg.downloadMedia();
    const base64Image = media.data;

    // 调用 Gemini AI 进行识别
    const result = await processReceipt(base64Image);

    if (!result.success) {
      await msg.reply("❌ 识别服务暂时不可用，请稍后再试。");
      return;
    }

    // 记录到 Excel
    await addReceipt({
      phone: msg.from,
      ic: session.ic,
      ...result
    });

    // 根据识别结果回复用户
    if (result.qualified) {
      const responseText = messages.receipt.qualified
        .replace("{receipt_no}", result.receipt_no)
        .replace("{brand}", result.brand)
        .replace("{amount}", result.amount);
      await msg.reply(responseText);
    } else {
      const responseText = messages.receipt.disqualified
        .replace("{reason}", result.disqualify_reason);
      await msg.reply(responseText);
    }

  } catch (error) {
    console.error("Receipt Processing Error:", error);
    await msg.reply("❌ 处理收据时发生错误，请重新提交。");
  }
}

module.exports = { handleReceipt };
