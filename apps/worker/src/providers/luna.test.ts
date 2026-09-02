import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { extractReceipt } from "./luna.js";
import { ReceiptProviderError } from "./errors.js";
import type { WorkerConfig } from "../config.js";

const originalFetch = globalThis.fetch;
const config = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  WORKER_PORT: 8080,
  WORKER_POLL_MS: 1000,
  WORKER_ID: "test-worker",
  META_GRAPH_VERSION: "v23.0",
  OPENAI_API_KEY: "test-openai-key"
} satisfies WorkerConfig;

const image = { bytes: Buffer.from([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" as const };

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("sends an OCR-safe Luna request and parses the four-field contract", async () => {
  let request: { url: string; body: Record<string, any> } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ output_text: JSON.stringify({ amount: 1299.9, brand: "Samsung", summary: "Receipt total and product brand recognized.", confidence: 0.94 }) }), { status: 200 });
  };

  const result = await extractReceipt(image, config);

  assert.deepEqual(result, { amount: 1299.9, brand: "Samsung", summary: "Receipt total and product brand recognized.", confidence: 0.94 });
  const captured = request as unknown as { url: string; body: any };
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.body.model, "gpt-5.6-luna");
  assert.equal(captured.body.store, false);
  assert.deepEqual(captured.body.reasoning, { effort: "none" });
  assert.equal(captured.body.input[0].content[1].detail, "original");
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(captured.body.text.format.strict, true);
});

test("does not retry permanent provider failures", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "unauthorized" } }), { status: 401 });

  await assert.rejects(
    extractReceipt(image, config),
    (error: unknown) => error instanceof ReceiptProviderError && error.retryable === false
  );
});

test("marks rate limits as retryable", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });

  await assert.rejects(
    extractReceipt(image, config),
    (error: unknown) => error instanceof ReceiptProviderError && error.retryable === true
  );
});
