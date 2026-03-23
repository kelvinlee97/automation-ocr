const { GoogleGenerativeAI } = require("@google/generative-ai");
const settingsStore = require("./settingsStore");

// 初始化 Gemini（通过环境变量获取 API KEY）
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

/**
 * 调用 Gemini 识别收据/订单截图
 * @param {string} base64Image 图片数据（Base64）
 * @param {string} [mimeType]  图片 MIME 类型，默认 image/jpeg
 * @returns {Promise<Object>} { success, receipt_no, amount, qualified, disqualify_reason, confidence }
 */
async function processReceipt(base64Image, mimeType = "image/jpeg") {
  // 每次提取时实时读取门槛，确保后台改完立即生效
  const minimumAmount = settingsStore.get("minimum_amount");

  const prompt = `
    You are a receipt auditor for a Malaysia promotion campaign.
    The image may be a physical receipt, an e-commerce order screenshot (Shopee, Lazada, TikTok Shop, etc.),
    or a payment confirmation. Text may be in English, Malay, or Chinese — handle all.

    Extract the following:
    1. receipt_no — order number, receipt number, or invoice number visible in the image.
       If multiple exist, pick the most prominent one.
    2. amount — the TOTAL order amount in RM.
       - Use "Order Total", "Grand Total", "Total Payment", or equivalent.
       - If multiple orders are visible, sum all order totals.
       - Ignore item prices, shipping fees listed separately, or any amount mentioned only in chat text outside the receipt/order UI.
       - Return as a plain number (e.g. 1269.23), not a string.

    Eligibility rule:
    - qualified = true if amount >= ${minimumAmount}

    Respond ONLY with a JSON object, no markdown fences:
    {
      "receipt_no": string,
      "amount": number,
      "qualified": boolean,
      "disqualify_reason": string,
      "confidence": number
    }
  `;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType } },
    ]);

    const text = result.response.text().replace(/```json|```/g, "").trim();
    const data = JSON.parse(text);

    return { success: true, ...data };
  } catch (error) {
    console.error("Gemini API Error:", error);
    return { success: false, message: error.message || "AI 识别服务暂时不可用" };
  }
}

module.exports = { processReceipt };
