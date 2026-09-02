import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "./config.js";

const baseEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  META_GRAPH_VERSION: "v23.0"
};

test("requires provider credentials in production", () => {
  assert.throws(() => readConfig({ ...baseEnv, NODE_ENV: "production" }), /META_ACCESS_TOKEN|OPENAI_API_KEY/);
  assert.throws(() => readConfig({ ...baseEnv, NODE_ENV: "production", META_ACCESS_TOKEN: "placeholder", OPENAI_API_KEY: "openai-test" }), /META_ACCESS_TOKEN/);
  assert.equal(readConfig({ ...baseEnv, NODE_ENV: "production", META_ACCESS_TOKEN: "meta-test", OPENAI_API_KEY: "openai-test" }).NODE_ENV, "production");
});
