import type { WorkerConfig } from "../config.js";
import { ReceiptProviderError, isRetryableHttpStatus } from "./errors.js";
import { MAX_RECEIPT_IMAGE_BYTES, validateReceiptImage, type ReceiptImage } from "./receipt-image.js";

type MetaMedia = { url: string; mime_type?: string };

async function readLimitedBody(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RECEIPT_IMAGE_BYTES) {
    throw new ReceiptProviderError("Receipt image exceeds the 10 MB limit", false);
  }

  if (!response.body) return Buffer.from(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RECEIPT_IMAGE_BYTES) {
        await reader.cancel();
        throw new ReceiptProviderError("Receipt image exceeds the 10 MB limit", false);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function downloadMetaMedia(mediaId: string, config: WorkerConfig) {
  if (!mediaId) throw new ReceiptProviderError("Meta media id is missing", false);
  if (!config.META_ACCESS_TOKEN) throw new ReceiptProviderError("META_ACCESS_TOKEN is not configured", false);
  const headers = { Authorization: `Bearer ${config.META_ACCESS_TOKEN}` };
  let mediaResponse: Response;
  try {
    mediaResponse = await fetch(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${mediaId}`, { headers, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ReceiptProviderError("Meta media lookup failed", true);
  }
  if (!mediaResponse.ok) throw new ReceiptProviderError(`Meta media lookup failed (${mediaResponse.status})`, isRetryableHttpStatus(mediaResponse.status));
  const media = await mediaResponse.json() as MetaMedia;
  if (!media.url || !media.url.startsWith("https://")) throw new ReceiptProviderError("Meta media URL is invalid", false);

  let fileResponse: Response;
  try {
    fileResponse = await fetch(media.url, { headers, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ReceiptProviderError("Meta media download failed", true);
  }
  if (!fileResponse.ok) throw new ReceiptProviderError(`Meta media download failed (${fileResponse.status})`, isRetryableHttpStatus(fileResponse.status));
  return validateReceiptImage(await readLimitedBody(fileResponse));
}

export async function sendWhatsAppTemplate(input: {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode?: string;
  config: WorkerConfig;
}) {
  if (!input.config.META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN is not configured");
  const response = await fetch(`https://graph.facebook.com/${input.config.META_GRAPH_VERSION}/${input.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "template",
      template: { name: input.templateName, language: { code: input.languageCode ?? "en_US" } }
    })
  });
  const payload = await response.json() as { messages?: Array<{ id: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Meta message send failed with ${response.status}`);
  const messageId = payload.messages?.[0]?.id;
  if (!messageId) throw new ReceiptProviderError("Meta message send returned no message id", false);
  return messageId;
}
