'use strict';

// mock 必须在 require 之前声明，Jest 会自动提升到文件顶部
const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: () => ({
        generateContent: mockGenerateContent,
      }),
    })),
  };
});

const { processReceipt } = require('../aiService');

describe('aiService - Gemini API 封装', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  test('API 返回有效数据时，解析为标准结构', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          amount: 88.50,
          summary: '测试超市收据',
          confidence: 0.95,
        }),
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(true);
    expect(result.amount).toBe(88.50);
    expect(result.confidence).toBe(0.95);
  });

  test('网络超时时，返回 retryable: true', async () => {
    const timeoutError = new Error('Request timeout');
    timeoutError.code = 'ETIMEDOUT';
    mockGenerateContent.mockRejectedValue(timeoutError);

    const result = await processReceipt('base64ImageData');

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

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });

  test('amount 为字符串时，自动转换为数字', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          amount: '1269.23',
          summary: 'Shopee order',
          confidence: 0.9,
        }),
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(true);
    expect(result.amount).toBe(1269.23);
    expect(typeof result.amount).toBe('number');
  });

  test('amount 为 null 时，保持 null', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          amount: null,
          summary: '模糊图片，无法识别金额',
          confidence: 0.3,
        }),
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(true);
    expect(result.amount).toBeNull();
  });

  test('confidence 超出范围时，校验失败', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          amount: 100,
          summary: 'Test receipt',
          confidence: 1.5,
        }),
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.message).toContain('Too big');
  });

  test('缺少 summary 字段时，校验失败', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          amount: 100,
          confidence: 0.8,
        }),
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.message).toContain('undefined');
  });

  test('响应含 markdown 代码块时，正确剥离', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '```json\n{"amount": 500, "summary": "Test", "confidence": 0.9}\n```',
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(true);
    expect(result.amount).toBe(500);
  });

  test('502 错误时，返回 retryable: true', async () => {
    const badGatewayError = new Error('Bad Gateway');
    badGatewayError.message = '502 Bad Gateway';
    mockGenerateContent.mockRejectedValue(badGatewayError);

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
  });
});
