import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { WorkerConfig } from "./config.js";
import { handleJob, processReceiptExtraction } from "./jobs.js";

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

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("stores a four-field extraction from a private receipt image without sending WhatsApp", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let whatsappCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes("graph.facebook.com")) whatsappCalls += 1;
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        amount: 1299.9,
        brand: "Samsung",
        summary: "Receipt total and product brand recognized.",
        confidence: 0.94
      })
    }), { status: 200 });
  };

  const query = (result: { data: unknown; error: null }) => {
    const chain = {
      eq: () => chain,
      select: () => chain,
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return chain;
  };
  const supabase = {
    from(table: string) {
      if (table === "receipts") {
        return {
          select: () => query({ data: { media_path: "receipts/receipt-1.jpg", review_status: "pending" }, error: null })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from() {
        return {
          download: async () => ({ data: new Blob([Buffer.from([0xff, 0xd8, 0xff])]), error: null })
        };
      }
    },
    rpc: async (_name: string, values: Record<string, unknown>) => {
      updates.push(values);
      return { data: true, error: null };
    }
  };

  await processReceiptExtraction(supabase, { id: "job-1", claim_token: "claim-1", job_type: "receipt.extract", payload: { receipt_id: "receipt-1", media_id: "unused" }, attempts: 1 }, config);

  assert.equal(whatsappCalls, 0);
  assert.equal(updates[0].p_ai_status, "processing");
  assert.equal(updates[1].p_ai_status, "complete");
  assert.equal(updates[1].p_extracted_amount, 1299.9);
  assert.equal(updates[1].p_extracted_brand, "Samsung");
  assert.deepEqual(updates[1].p_ai_result, { amount: 1299.9, brand: "Samsung", summary: "Receipt total and product brand recognized.", confidence: 0.94 });
});

test("backfills the IC last four digits onto earlier receipts for the same campaign and phone", async () => {
  let receiptUpdate: Record<string, unknown> | null = null;
  let sessionUpsert: Record<string, unknown> | null = null;
  const receiptFilters: Array<[string, string, unknown]> = [];
  const inbound = {
    id: "inbound-ic-1",
    campaign_id: "campaign-1",
    phone_e164: "+60123456789",
    payload: { type: "text", text: { body: "900101-14-1234" } }
  };

  const query = (result: { data: unknown; error: null }, trackFilters = false) => {
    const chain = {
      eq: (column: string, value: unknown) => { if (trackFilters) receiptFilters.push(["eq", column, value]); return chain; },
      is: (column: string, value: unknown) => { if (trackFilters) receiptFilters.push(["is", column, value]); return chain; },
      select: () => chain,
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return chain;
  };

  const supabase = {
    from(table: string) {
      if (table === "inbound_messages") return { select: () => query({ data: inbound, error: null }) };
      if (table === "consumer_sessions") return { upsert: async (values: Record<string, unknown>) => {
        sessionUpsert = values;
        return { data: null, error: null };
      } };
      if (table === "receipts") return {
        update: (values: Record<string, unknown>) => { receiptUpdate = values; return query({ data: null, error: null }, true); }
      };
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  await handleJob(supabase, { id: "job-ic-1", job_type: "message.process", payload: { meta_message_id: "meta-ic-1" }, attempts: 1 }, config);

  assert.deepEqual(receiptUpdate, { ic_last4: "1234" });
  assert.equal(Object.hasOwn(sessionUpsert ?? {}, "ic_hash"), false);
  assert.deepEqual(receiptFilters, [
    ["eq", "campaign_id", "campaign-1"],
    ["eq", "phone_e164", "+60123456789"],
    ["is", "ic_last4", null]
  ]);
});

test("retries message processing when the consumer session cannot be saved", async () => {
  const inbound = {
    id: "inbound-ic-error",
    campaign_id: "campaign-1",
    phone_e164: "+60123456789",
    payload: { type: "text", text: { body: "900101-14-1234" } }
  };
  const sessionError = new Error("session write failed");
  const query = (result: { data: unknown; error: Error | null }) => {
    const chain = {
      eq: () => chain,
      select: () => chain,
      single: async () => result
    };
    return chain;
  };
  const supabase = {
    from(table: string) {
      if (table === "inbound_messages") return { select: () => query({ data: inbound, error: null }) };
      if (table === "consumer_sessions") return { upsert: async () => ({ data: null, error: sessionError }) };
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  await assert.rejects(
    handleJob(supabase, { id: "job-ic-error", job_type: "message.process", payload: { meta_message_id: "meta-ic-error" }, attempts: 1 }, config),
    sessionError
  );
});

test("keeps the IC last four digits on a receipt created from a mixed message", async () => {
  let insertedReceipt: Record<string, unknown> | null = null;
  const inbound = {
    id: "inbound-mixed-1",
    campaign_id: "campaign-1",
    phone_e164: "+60123456789",
    payload: { type: "image", image: { id: "media-1" }, text: { body: "900101-14-1234" } }
  };

  const query = (result: { data: unknown; error: null }) => {
    const chain = {
      eq: () => chain,
      is: () => chain,
      select: () => chain,
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return chain;
  };

  const supabase = {
    from(table: string) {
      if (table === "inbound_messages") return { select: () => query({ data: inbound, error: null }) };
      if (table === "consumer_sessions") return { upsert: async () => ({ data: null, error: null }) };
      if (table === "receipts") return {
        update: () => query({ data: null, error: null }),
        insert: (values: Record<string, unknown>) => { insertedReceipt = values; return query({ data: { id: "receipt-mixed-1" }, error: null }); }
      };
      if (table === "jobs") return { upsert: async () => ({ data: null, error: null }) };
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  await handleJob(supabase, { id: "job-mixed-1", job_type: "message.process", payload: { meta_message_id: "meta-mixed-1" }, attempts: 1 }, config);

  assert.equal((insertedReceipt as { ic_last4?: unknown } | null)?.ic_last4, "1234");
});

test("carries the session IC last four digits into a later receipt message", async () => {
  let insertedReceipt: Record<string, unknown> | null = null;
  const inbound = {
    id: "inbound-image-1",
    campaign_id: "campaign-1",
    phone_e164: "+60123456789",
    payload: { type: "image", image: { id: "media-1" } }
  };

  const query = (result: { data: unknown; error: null }) => {
    const chain = {
      eq: () => chain,
      is: () => chain,
      select: () => chain,
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return chain;
  };

  const supabase = {
    from(table: string) {
      if (table === "inbound_messages") return { select: () => query({ data: inbound, error: null }) };
      if (table === "consumer_sessions") return { select: () => query({ data: { ic_last4: "1234" }, error: null }) };
      if (table === "receipts") return {
        insert: (values: Record<string, unknown>) => { insertedReceipt = values; return query({ data: { id: "receipt-image-1" }, error: null }); }
      };
      if (table === "jobs") return { upsert: async () => ({ data: null, error: null }) };
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  await handleJob(supabase, { id: "job-image-1", job_type: "message.process", payload: { meta_message_id: "meta-image-1" }, attempts: 1 }, config);

  assert.equal((insertedReceipt as { ic_last4?: unknown } | null)?.ic_last4, "1234");
});

test("does not change extraction state after its job claim is lost", async () => {
  const receiptUpdates: Record<string, unknown>[] = [];
  const supabase = {
    from(table: string) {
      if (table === "receipts") return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: { media_path: "receipts/receipt-1.jpg", review_status: "pending" }, error: null }) })
        }),
        update(values: Record<string, unknown>) {
          receiptUpdates.push(values);
          throw new Error("stale worker wrote directly to receipt");
        }
      };
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "update_receipt_extraction_for_claim");
      assert.equal(args.p_job_id, "job-1");
      assert.equal(args.p_claim_token, "claim-1");
      return { data: false, error: null };
    }
  };

  await processReceiptExtraction(supabase, {
    id: "job-1",
    claim_token: "claim-1",
    job_type: "receipt.extract",
    payload: { receipt_id: "receipt-1", media_id: "unused" },
    attempts: 1
  } as any, config);

  assert.deepEqual(receiptUpdates, []);
});

test("records an unknown delivery outcome and forbids automatic resend", async () => {
  const deliveryStates: string[] = [];
  globalThis.fetch = async () => { throw new TypeError("connection closed"); };

  const chain = (result: { data: unknown; error: null }) => {
    const query = {
      eq: () => query,
      in: () => query,
      select: () => query,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return query;
  };
  const supabase = {
    from(table: string) {
      if (table === "message_deliveries") return {
        update(values: { status: string }) {
          deliveryStates.push(values.status);
          return chain({ data: values.status === "sending" ? { id: "delivery-1", attempt_id: "attempt-1" } : null, error: null });
        }
      };
      if (table === "receipts") return { update: () => chain({ data: null, error: null }) };
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  await assert.rejects(
    handleJob(supabase, {
      id: "job-send-1",
      job_type: "whatsapp.send_template",
      payload: { receipt_id: "receipt-1", delivery_id: "delivery-1", phone_number_id: "phone-1", to: "+60123456789", template_name: "rejected" },
      attempts: 1
    }, { ...config, META_ACCESS_TOKEN: "test-meta-token" }),
    (error: unknown) => error instanceof Error && error.message.startsWith("Delivery outcome is unknown:") && (error as { retryable?: boolean }).retryable === false
  );
  assert.deepEqual(deliveryStates, ["sending", "unknown"]);
});

test("keeps a provider-accepted receipt closed when persistence fails", async () => {
  const deliveryStates: Array<Record<string, unknown>> = [];
  const receiptStates: Array<Record<string, unknown>> = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [{ id: "wamid.accepted" }] }), { status: 200 });

  const chain = (result: { data: unknown; error: Error | null }) => {
    const query = {
      eq: () => query,
      in: () => query,
      select: () => query,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return query;
  };
  const supabase = {
    from(table: string) {
      if (table === "message_deliveries") return {
        update(values: Record<string, unknown>) {
          deliveryStates.push(values);
          if (values.status === "sending") return chain({ data: { id: "delivery-2", attempt_id: "attempt-2" }, error: null });
          if (values.status === "sent") return chain({ data: null, error: new Error("database unavailable") });
          return chain({ data: null, error: null });
        }
      };
      if (table === "receipts") return {
        update(values: Record<string, unknown>) {
          receiptStates.push(values);
          return chain({ data: null, error: null });
        }
      };
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  await assert.rejects(
    handleJob(supabase, {
      id: "job-send-2",
      job_type: "whatsapp.send_template",
      payload: { receipt_id: "receipt-2", delivery_id: "delivery-2", phone_number_id: "phone-1", to: "+60123456789", template_name: "rejected" },
      attempts: 1
    }, { ...config, META_ACCESS_TOKEN: "test-meta-token" }),
    (error: unknown) => error instanceof Error && (error as { retryable?: boolean }).retryable === false
  );
  assert.deepEqual(deliveryStates.at(-1), { provider_message_id: "wamid.accepted", status: "unknown", error: "database unavailable" });
  assert.deepEqual(receiptStates, []);
});

test("moves a sent delivery to reconciliation when receipt persistence fails", async () => {
  const deliveryStates: Array<Record<string, unknown>> = [];
  let deliveryStatus = "queued";
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [{ id: "wamid.persisted" }] }), { status: 200 });

  const chain = (result: { data: unknown; error: Error | null }) => {
    const query = {
      eq: () => query,
      in: () => query,
      select: () => query,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return query;
  };
  const supabase = {
    from(table: string) {
      if (table === "message_deliveries") return {
        update(values: Record<string, unknown>) {
          deliveryStates.push(values);
          let expectedStatus: unknown;
          const result = () => {
            if (expectedStatus !== undefined && deliveryStatus !== expectedStatus) return { data: null, error: null };
            deliveryStatus = String(values.status);
            return { data: values.status === "sending" ? { id: "delivery-3", attempt_id: "attempt-3" } : null, error: null };
          };
          const query = {
            eq(column: string, value: unknown) { if (column === "status") expectedStatus = value; return query; },
            in(column: string, values: unknown[]) { if (column === "status" && !values.includes(deliveryStatus)) expectedStatus = "not-current"; return query; },
            select: () => query,
            maybeSingle: async () => result(),
            then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve)
          };
          return query;
        }
      };
      if (table === "receipts") return { update: () => chain({ data: null, error: new Error("receipt update failed") }) };
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  await assert.rejects(
    handleJob(supabase, {
      id: "job-send-3",
      job_type: "whatsapp.send_template",
      payload: { receipt_id: "receipt-3", delivery_id: "delivery-3", phone_number_id: "phone-1", to: "+60123456789", template_name: "rejected" },
      attempts: 1
    }, { ...config, META_ACCESS_TOKEN: "test-meta-token" }),
    (error: unknown) => error instanceof Error && error.message === "Post-send persistence failed: receipt update failed" && (error as { retryable?: boolean }).retryable === false
  );
  assert.deepEqual(deliveryStates.at(-1), { provider_message_id: "wamid.persisted", status: "unknown", error: "receipt update failed" });
  assert.equal(deliveryStatus, "unknown");
});
