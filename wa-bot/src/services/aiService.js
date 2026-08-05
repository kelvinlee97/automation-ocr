const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");

// Initialize Gemini (obtain API KEY through environment variables)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

/**
 * Gemini response verification Schema
 *
 * Why verification is needed:
 * - Gemini may return non-JSON content (output natural language when the image cannot be recognized)
 * - amount was sometimes returned as a string ("1269.23" instead of 1269.23)
 * - confidence may be outside the 0-1 range
 * - Fields may be missing
 *
 * Validation failure = non-retry error (retryable: false), because retrying will not change the result
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
  summary: z.string().min(1, "summary cannot be an empty string"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .default(0.5),
});

/**
 * Determine whether an error is worth retrying
 *
 * Retry type: network timeout, server 5xx, current limit 429
 * Non-retry type: JSON parsing failure, Schema verification failure, business logic error
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
 * Call Gemini to identify receipt/order screenshots
 * Only the amount and image summary are extracted, and the qualification determination is determined by manual review.
 *
 * @param {string} base64Image image data (Base64)
 * @param {string} [mimeType] Image MIME type, default image/jpeg
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
        message: `The content returned by AI cannot be parsed as JSON: ${text.slice(0, 100)}`,
      };
    }

    const validated = aiResponseSchema.safeParse(raw);
    if (!validated.success) {
      // Validation failed = field is missing or of wrong type. Trying again will not change the result.
      return {
        success: false,
        retryable: false,
        message: `AI response format exception: ${validated.error.issues.map((e) => e.message).join(", ")}`,
      };
    }

    return { success: true, ...validated.data };
  } catch (error) {
    const retryable = isRetryableError(error);
    return {
      success: false,
      retryable,
      message: retryable ? "The AI recognition service is temporarily unavailable, please try again later." : error.message || "AI recognition failed",
    };
  }
}

module.exports = { processReceipt };
