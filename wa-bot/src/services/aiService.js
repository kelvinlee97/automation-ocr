const { GoogleGenerativeAI } = require("@google/generative-ai");

// 初始化 Gemini（通过环境变量获取 API KEY）
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

/**
 * 调用 Gemini 识别收据/订单截图
 * 只提取金额和图片摘要，资格判定由人工审核决定
 *
 * @param {string} base64Image 图片数据（Base64）
 * @param {string} [mimeType]  图片 MIME 类型，默认 image/jpeg
 * @returns {Promise<{ success: boolean, amount: number|null, summary: string, confidence: number }>}
 */
async function processReceipt(base64Image, mimeType = "image/jpeg") {
  const prompt = `
    You are analyzing a receipt or order screenshot for a Malaysia promotion campaign.
    The image may be a physical receipt, an e-commerce order screenshot (Shopee, Lazada, TikTok Shop, etc.),
    or a payment confirmation. Text may be in English, Malay, or Chinese — handle all.

    Extract the following:
    1. amount — the TOTAL order amount in RM.
       - Use "Order Total", "Grand Total", "Total Payment", or equivalent.
       - If multiple orders are visible, sum all order totals.
       - Ignore item prices, shipping fees listed separately, or any amount mentioned only in chat text outside the receipt/order UI.
       - Return as a plain number (e.g. 1269.23). Return null if not found.

    2. summary — a 1-2 sentence natural language description of the image content.
       Examples:
       - "Shopee order screenshot, 3 items purchased, total RM 1269.23, dated 2025-02-10."
       - "Physical receipt from Samsung store, total RM 3500.00, receipt no. SA20250115."
       - "TikTok Shop order for a Dyson vacuum cleaner, total RM 1899.00."
       Write in the same language as the image text, or English if mixed.

    3. confidence — your confidence score from 0.0 to 1.0 that this is a valid purchase receipt or order.

    Respond ONLY with a JSON object, no markdown fences:
    {
      "amount": number or null,
      "summary": string,
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
    const isRetryable = error.message?.includes('429') || 
                          error.message?.includes('500') || 
                          error.message?.includes('503') ||
                          error.message?.includes('network') ||
                          error.message?.includes('ETIMEDOUT') ||
                          error.code === 'ETIMEDOUT';
    return { 
      success: false, 
      retryable: isRetryable,
      message: error.message || "AI 识别服务暂时不可用" 
    };
  }
}

module.exports = { processReceipt };
