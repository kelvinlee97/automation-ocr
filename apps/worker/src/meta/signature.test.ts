import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyMetaSignature } from "./signature.js";

test("accepts a valid Meta HMAC signature and rejects a changed body", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const secret = "test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(verifyMetaSignature(body, signature, secret), true);
  assert.equal(verifyMetaSignature(`${body}.changed`, signature, secret), false);
  assert.equal(verifyMetaSignature(body, null, secret), false);
});
