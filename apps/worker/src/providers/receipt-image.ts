import { ReceiptProviderError } from "./errors.js";

export const MAX_RECEIPT_IMAGE_BYTES = 10 * 1024 * 1024;

export type ReceiptImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

function detectedMimeType(bytes: Buffer): ReceiptImage["mimeType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function validateReceiptImage(bytes: Buffer): ReceiptImage {
  if (bytes.length === 0) throw new ReceiptProviderError("Receipt image is empty", false);
  if (bytes.length > MAX_RECEIPT_IMAGE_BYTES) throw new ReceiptProviderError("Receipt image exceeds the 10 MB limit", false);
  const mimeType = detectedMimeType(bytes);
  if (!mimeType) throw new ReceiptProviderError("Receipt image format is not supported", false);
  return { bytes, mimeType };
}

export function receiptImageExtension(mimeType: ReceiptImage["mimeType"]) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}
