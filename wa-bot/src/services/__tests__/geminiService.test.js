'use strict';

// mock 必须在 require 之前声明，Jest 会自动提升到文件顶部
jest.mock('@google/generative-ai');

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { analyzeReceipt } = require('../geminiService');

describe('geminiService - Gemini API 封装', () => {
  let mockGenerateContent;

  beforeEach(() => {
    // 构造 mock 调用链：new GoogleGenerativeAI().getGenerativeModel().generateContent()
    mockGenerateContent = jest.fn();
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: () => ({
        generateContent: mockGenerateContent,
      }),
    }));
  });

  test('API 返回有效数据时，解析为标准结构', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          merchantName: '测试超市',
          totalAmount: 88.50,
          receiptDate: '2024-01-15',
          eligible: true,
        }),
      },
    });

    const result = await analyzeReceipt('base64ImageData');

    expect(result.success).toBe(true);
    expect(result.data.merchantName).toBe('测试超市');
    expect(result.data.eligible).toBe(true);
  });

  test('网络超时时，返回 retryable: true', async () => {
    const timeoutError = new Error('Request timeout');
    timeoutError.code = 'ETIMEDOUT';
    mockGenerateContent.mockRejectedValue(timeoutError);

    const result = await analyzeReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
  });

  test('API 返回无法解析的内容时，返回 retryable: false', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        // 模拟 Gemini 返回非 JSON 的情况（图片无法识别）
        text: () => '无法识别该收据图片',
      },
    });

    const result = await analyzeReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });
});