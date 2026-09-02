import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaSignature(rawBody: string, signature: string | null, appSecret: string): boolean {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;

  const expected = Buffer.from(
    `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`
  );
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
