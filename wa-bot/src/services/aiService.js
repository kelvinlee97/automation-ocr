const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");

// 初始化 Gemini（通过环境变量获取 API KEY）
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

/**
 * Gemini 响应校验 Schema
 *
 * 为什么需要校验：
 * - Gemini 可能返回非 JSON 内容（图片无法识别时输出自然语言）
 * - amount 有时被返回为字符串（"1269.23" 而非 1269.23）
 * - confidence 可能超出 0-1 范围
 * - 字段可能缺失
 *
 * 校验失败 = 非重试型错误（retryable: false），因为重试不会改变结果
 */
const aiResponseSchema = z.object({
  amount: z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      const parsed = parseFloat(v);
      return Number.isFinite(parsed) ? parsed : null;
    }),
  summary: z.string().min(1, "summary 不能为空字符串"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .default(0.5),
});

/**
 * 判断错误是否值得重试
 *
 * 重试型：网络超时、服务端 5xx、限流 429
 * 非重试型：JSON 解析失败、Schema 校验失败、业务逻辑错误
 */
function isRetryableError(error) {
  if (error.code === "ETIMEDOUT" || error.code === "ECONNRESET" || error.code === "ENOTFOUND") {
    return true;
  }

  const message = error.message || "";

  if (message.includes("429") || message.includes("500") || message.includes("503") || message.includes("502")) {
    return true;
  }

  if (/network|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(message)) {
    return true;
  }

  return false;
}

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

    let raw;
    try {
      raw = JSON.parse(text);
    } catch (parseError) {
      return {
        success: false,
        retryable: false,
        message: `AI 返回内容无法解析为 JSON: ${text.slice(0, 100)}`,
      };
    }

    const validated = aiResponseSchema.safeParse(raw);
    if (!validated.success) {
      // 校验失败 = 字段缺失或类型错误，重试同样不会改变结果
      return {
        success: false,
        retryable: false,
        message: `AI 响应格式异常: ${validated.error.issues.map((e) => e.message).join(", ")}`,
      };
    }

    return { success: true, ...validated.data };
  } catch (error) {
    const retryable = isRetryableError(error);
    return {
      success: false,
      retryable,
      message: retryable ? "AI 识别服务暂时不可用，请稍后重试" : error.message || "AI 识别失败",
    };
  }
}

module.exports = { processReceipt };
