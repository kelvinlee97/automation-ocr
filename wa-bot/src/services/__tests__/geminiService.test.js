'use strict';

// mock must be declared before require, Jest will automatically be promoted to the top of the file
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

describe('aiService - Gemini API package', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  test('When the API returns valid data, it is parsed into a standard structure', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          amount: 88.50,
          summary: 'Test supermarket receipt',
          confidence: 0.95,
        }),
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(true);
    expect(result.amount).toBe(88.50);
    expect(result.confidence).toBe(0.95);
  });

  test('When the network times out, return retryable: true', async () => {
    const timeoutError = new Error('Request timeout');
    timeoutError.code = 'ETIMEDOUT';
    mockGenerateContent.mockRejectedValue(timeoutError);

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
  });

  test('When the API returns content that cannot be parsed, return retryable: false', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        // Simulate the situation where Gemini returns non-JSON (pictures cannot be recognized)
        text: () => 'The receipt image is not recognized',
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });

  test('When amount is a string, it is automatically converted to a number.', async () => {
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

  test('When amount is null, keep it null', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          amount: null,
          summary: 'Blurred picture, unable to identify the amount',
          confidence: 0.3,
        }),
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(true);
    expect(result.amount).toBeNull();
  });

  test('When confidence exceeds the range, verification fails', async () => {
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

  test('Verification fails when summary field is missing', async () => {
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

  test('When responding to markdown code blocks, strip them correctly', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '```json\n{"amount": 500, "summary": "Test", "confidence": 0.9}\n```',
      },
    });

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(true);
    expect(result.amount).toBe(500);
  });

  test('In case of 502 error, return retryable: true', async () => {
    const badGatewayError = new Error('Bad Gateway');
    badGatewayError.message = '502 Bad Gateway';
    mockGenerateContent.mockRejectedValue(badGatewayError);

    const result = await processReceipt('base64ImageData');

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
  });
});
