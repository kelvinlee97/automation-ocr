const { addPendingReceipt } = require("../services/receiptStore");
const yaml = require("js-yaml");
const fs = require("fs");
const path = require("path");

// messages.yaml 为空时 yaml.load 返回 null，用 fallback 兜底避免 TypeError
const messages = yaml.load(fs.readFileSync(path.join(__dirname, "../../../config/messages.yaml"), "utf8")) || {};

// 回复话术 fallback（messages.yaml 为空时使用）
const DEFAULT_MESSAGES = {
  receipt: {
    invalid_type: "❌ 请发送收据图片。",
    // 新流程：不再即时 AI 识别，改为等待人工审核
    received: "✅ 收据已收到，正在等待人工审核，请耐心等待。",
  },
};

async function handleReceipt(msg, session) {
  const r = messages?.receipt ?? DEFAULT_MESSAGES.receipt;

  if (!msg.hasMedia) {
    await msg.reply(r.invalid_type ?? DEFAULT_MESSAGES.receipt.invalid_type);
    return;
  }

  try {
    const media = await msg.downloadMedia();

    // 将图片持久化到 data/images/，记录 pending_review 状态
    // AI 识别延后到管理后台由人工触发，避免 WhatsApp 超时
    addPendingReceipt(msg.from, media.data, media.mimetype);

    await msg.reply(r.received ?? DEFAULT_MESSAGES.receipt.received);

  } catch (error) {
    console.error("Receipt Save Error:", error);
    await msg.reply("❌ 处理收据时发生错误，请重新提交。");
  }
}

module.exports = { handleReceipt };
