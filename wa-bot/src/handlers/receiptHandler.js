const { processReceipt } = require("../services/aiService");
const { addReceipt } = require("../services/excelService");
const yaml = require("js-yaml");
const fs = require("fs");
const path = require("path");

// messages.yaml 为空时 yaml.load 返回 null，用 fallback 兜底避免 TypeError
const messages = yaml.load(fs.readFileSync(path.join(__dirname, "../../../config/messages.yaml"), "utf8")) || {};

// 回复话术 fallback（messages.yaml 为空时使用）
const DEFAULT_MESSAGES = {
  receipt: {
    invalid_type: "❌ 请发送收据图片。",
    processing: "⏳ 正在识别收据，请稍候...",
    qualified: "✅ 收据认证成功！\n单据号：{receipt_no}\n品牌：{brand}\n金额：RM {amount}",
    disqualified: "❌ 收据不符合条件。\n原因：{reason}",
  },
};

async function handleReceipt(msg, session) {
  // 使用 messages.yaml 中的话术，不存在则用默认文本
  const r = messages?.receipt ?? DEFAULT_MESSAGES.receipt;

  if (!msg.hasMedia) {
    await msg.reply(r.invalid_type);
    return;
  }

  // 给用户初步反馈
  await msg.reply(r.processing);

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
      const responseText = (r.qualified ?? DEFAULT_MESSAGES.receipt.qualified)
        .replace("{receipt_no}", result.receipt_no)
        .replace("{brand}", result.brand)
        .replace("{amount}", result.amount);
      await msg.reply(responseText);
    } else {
      const responseText = (r.disqualified ?? DEFAULT_MESSAGES.receipt.disqualified)
        .replace("{reason}", result.disqualify_reason);
      await msg.reply(responseText);
    }

  } catch (error) {
    console.error("Receipt Processing Error:", error);
    await msg.reply("❌ 处理收据时发生错误，请重新提交。");
  }
}

module.exports = { handleReceipt };
