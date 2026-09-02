'use strict';

const { processReceipt } = require('../aiService');

const originalFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const validImage = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64');

function response(output, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(output),
  };
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

describe('aiService - Luna Responses API', () => {
  test('parses the unified four-field result and sends the required request options', async () => {
    let request;
    global.fetch = jest.fn(async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return response({ output_text: JSON.stringify({
        amount: 88.5,
        brand: 'Samsung',
        summary: 'Receipt total and product brand recognized.',
        confidence: 0.95,
      }) });
    });

    const result = await processReceipt(validImage, 'image/jpeg');

    expect(result).toEqual({
      success: true,
      amount: 88.5,
      brand: 'Samsung',
      summary: 'Receipt total and product brand recognized.',
      confidence: 0.95,
    });
    expect(request.url).toBe('https://api.openai.com/v1/responses');
    expect(request.body.model).toBe('gpt-5.6-luna');
    expect(request.body.store).toBe(false);
    expect(request.body.reasoning).toEqual({ effort: 'none' });
    expect(request.body.input[0].content[1].detail).toBe('original');
    expect(request.body.text.format.type).toBe('json_schema');
    expect(request.body.text.format.strict).toBe(true);
  });

  test('normalizes a numeric amount returned as a string', async () => {
    global.fetch = jest.fn(async () => response({ output_text: JSON.stringify({
      amount: '1269.23',
      brand: 'Dyson',
      summary: 'Shopee order total recognized.',
      confidence: 0.9,
    }) }));

    const result = await processReceipt(validImage);

    expect(result.success).toBe(true);
    expect(result.amount).toBe(1269.23);
    expect(typeof result.amount).toBe('number');
  });

  test('keeps an unknown amount or brand as null', async () => {
    global.fetch = jest.fn(async () => response({ output_text: JSON.stringify({
      amount: null,
      brand: null,
      summary: 'The receipt details are not clear enough to identify.',
      confidence: 0.3,
    }) }));

    const result = await processReceipt(validImage);

    expect(result.success).toBe(true);
    expect(result.amount).toBeNull();
    expect(result.brand).toBeNull();
  });

  test('treats invalid JSON and schema responses as permanent failures', async () => {
    global.fetch = jest.fn(async () => response({ output_text: 'not json' }));
    await expect(processReceipt(validImage)).resolves.toMatchObject({ success: false, retryable: false });

    global.fetch = jest.fn(async () => response({ output_text: JSON.stringify({ amount: 100, brand: 'Test', confidence: 1.5, summary: 'Invalid confidence' }) }));
    await expect(processReceipt(validImage)).resolves.toMatchObject({ success: false, retryable: false });
  });

  test('treats rate limits and network errors as retryable', async () => {
    global.fetch = jest.fn(async () => response({ error: { message: 'rate limited' } }, 429));
    await expect(processReceipt(validImage)).resolves.toMatchObject({ success: false, retryable: true });

    global.fetch = jest.fn(async () => { throw new TypeError('network failure'); });
    await expect(processReceipt(validImage)).resolves.toMatchObject({ success: false, retryable: true });
  });

  test('rejects invalid image bytes before making an API request', async () => {
    global.fetch = jest.fn();

    const result = await processReceipt(Buffer.from('not-an-image').toString('base64'));

    expect(result).toMatchObject({ success: false, retryable: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
