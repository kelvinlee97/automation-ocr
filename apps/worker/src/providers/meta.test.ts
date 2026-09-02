import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sendWhatsAppTemplate } from "./meta.js";
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
  META_ACCESS_TOKEN: "meta-test-token",
  META_GRAPH_VERSION: "v23.0",
  OPENAI_API_KEY: "test-openai-key"
} satisfies WorkerConfig;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("does not mark a WhatsApp send successful without a provider message id", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [] }), { status: 200 });

  await assert.rejects(
    sendWhatsAppTemplate({ phoneNumberId: "123", to: "+60123456789", templateName: "reject_result", config }),
    (error: unknown) => error instanceof ReceiptProviderError && error.retryable === false
  );
});
