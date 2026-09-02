import assert from "node:assert/strict";
import test from "node:test";
import { saveReviewDecision } from "../lib/review-decision.js";

test("returns an audit failure without falling back to non-atomic table writes", async () => {
  const calls: string[] = [];
  const supabase = {
    rpc(name: string) {
      calls.push(name);
      return { single: async () => ({ data: null, error: new Error("audit insert failed") }) };
    },
    from(table: string) {
      calls.push(table);
      throw new Error("non-atomic fallback write");
    }
  };

  const result = await saveReviewDecision(supabase, "receipt-1", "approved");

  assert.equal(result.error?.message, "audit insert failed");
  assert.deepEqual(calls, ["review_receipt"]);
});
