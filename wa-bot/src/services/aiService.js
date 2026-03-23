const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");

// 加载业务规则配置
const config = yaml.load(fs.readFileSync(path.join(__dirname, "../../../config/config.yaml"), "utf8"));

// 初始化 Gemini (通过环境变量获取 API KEY)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * 调用 Gemini 识别收据
 * @param {string} base64Image 图片数据 (Base64)
 * @param {string} [mimeType]  图片 MIME 类型，默认 image/jpeg
 * @returns {Promise<Object>} 识别结果 { success, receipt_no, brand, amount, qualified, disqualify_reason }
 */
async function processReceipt(base64Image, mimeType = "image/jpeg") {
  try {
    // 马来西亚收据可能混用中文、马来文或英文，需明确告知模型
    const prompt = `
      You are a professional auditor for promotional receipts in Malaysia.
      The receipt may contain text in Chinese (Mandarin), Malay, or English — handle all languages.
      Analyze the receipt image and extract the following information:
      1. Receipt Number (receipt_no)
      2. Brand Name (brand) - return the English brand name if recognizable
      3. Total Amount in RM (amount)

      Eligibility Rules:
      - Eligible Brands: ${config.eligibility.eligible_brands.join(", ")}
      - Minimum Amount: RM ${config.eligibility.minimum_amount}

      Respond STRICTLY in JSON format with these fields:
      - receipt_no: (string)
      - brand: (string)
      - amount: (number)
      - qualified: (boolean, true if brand is in eligible list AND amount >= minimum)
      - disqualify_reason: (string, explanation in English if not qualified, otherwise empty string)
      - confidence: (number, 0.0 to 1.0)
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType,           // 使用传入的实际 MIME 类型，不硬编码
        },
      },
    ]);

    const response = await result.response;
    const text = response.text().replace(/```json|```/g, "").trim();
    const data = JSON.parse(text);

    return {
      success: true,
      ...data
    };
  } catch (error) {
    // 透传真实错误信息，方便上层记录和诊断
    console.error("Gemini API Error:", error);
    return { success: false, message: error.message || "AI 识别服务暂时不可用" };
  }
}

module.exports = { processReceipt };
