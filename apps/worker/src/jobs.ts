import type { JobType } from "@claimflow/domain";
import type { WorkerConfig } from "./config.js";
import { ReceiptProviderError } from "./providers/errors.js";
import { extractReceipt } from "./providers/luna.js";
import { downloadMetaMedia, sendWhatsAppTemplate } from "./providers/meta.js";
import { receiptImageExtension, validateReceiptImage, type ReceiptImage } from "./providers/receipt-image.js";

type SupabaseClient = any;
type Job = { id: string; claim_token?: string; job_type: JobType; payload: Record<string, unknown>; attempts: number };
export const MAX_JOB_ATTEMPTS = 5;

export async function handleJob(supabase: SupabaseClient, job: Job, config: WorkerConfig) {
  if (job.job_type === "message.process") return processInboundMessage(supabase, job);
  if (job.job_type === "receipt.extract") return processReceiptExtraction(supabase, job, config);
  return processTemplateSend(supabase, job, config);
}

async function processInboundMessage(supabase: SupabaseClient, job: Job) {
  const metaMessageId = String(job.payload.meta_message_id ?? "");
  const { data: inbound, error } = await supabase.from("inbound_messages").select("*").eq("meta_message_id", metaMessageId).single();
  if (error) throw error;

  const message = inbound.payload as { type?: string; image?: { id?: string }; text?: { body?: string } };
  const text = message.text?.body?.trim() ?? "";
  let icLast4 = text && /^\d{6}-?\d{2}-?\d{4}$/.test(text) ? text.replace(/\D/g, "").slice(-4) : null;
  if (icLast4 !== null) {
    const { error: sessionError } = await supabase.from("consumer_sessions").upsert({
      campaign_id: inbound.campaign_id,
      phone_e164: inbound.phone_e164,
      ic_last4: icLast4,
      state: "waiting_receipt",
      updated_at: new Date().toISOString()
    }, { onConflict: "campaign_id,phone_e164" });
    if (sessionError) throw sessionError;

    const receiptQuery = supabase.from("receipts").update({ ic_last4: icLast4 });
    const scopedReceipts = inbound.campaign_id === null
      ? receiptQuery.is("campaign_id", null)
      : receiptQuery.eq("campaign_id", inbound.campaign_id);
    const { error: backfillError } = await scopedReceipts.eq("phone_e164", inbound.phone_e164).is("ic_last4", null);
    if (backfillError) throw backfillError;
  }

  const mediaId = message.image?.id;
  if (message.type !== "image" || !mediaId) return;

  if (icLast4 === null) {
    const sessionQuery = supabase.from("consumer_sessions").select("ic_last4");
    const scopedSession = inbound.campaign_id === null
      ? sessionQuery.is("campaign_id", null)
      : sessionQuery.eq("campaign_id", inbound.campaign_id);
    const { data: session, error: sessionError } = await scopedSession.eq("phone_e164", inbound.phone_e164).maybeSingle();
    if (sessionError) throw sessionError;
    icLast4 = session?.ic_last4 ?? null;
  }

  const { data: receipt, error: receiptError } = await supabase.from("receipts").insert({
    campaign_id: inbound.campaign_id,
    inbound_message_id: inbound.id,
    phone_e164: inbound.phone_e164,
    ic_last4: icLast4,
    media_path: mediaId,
    ai_status: "pending",
    review_status: "pending",
    send_status: "none"
  }).select("id").single();
  if (receiptError && receiptError.code !== "23505") throw receiptError;

  const receiptId = receipt?.id ?? (await supabase.from("receipts").select("id").eq("inbound_message_id", inbound.id).single()).data?.id;
  if (!receiptId) throw new Error("Receipt could not be created");
  const { error: jobError } = await supabase.from("jobs").upsert({
    job_type: "receipt.extract",
    dedupe_key: `receipt:${receiptId}`,
    payload: { receipt_id: receiptId, media_id: mediaId },
    status: "queued"
  }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (jobError) throw jobError;
}

async function updateReceiptForClaim(supabase: SupabaseClient, job: Job, receiptId: string, values: Record<string, unknown>) {
  if (!job.claim_token) throw new Error(`Job ${job.id} has no claim token`);
  const { data, error } = await supabase.rpc("update_receipt_extraction_for_claim", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_receipt_id: receiptId,
    p_ai_status: values.ai_status ?? null,
    p_ai_result: values.ai_result ?? null,
    p_extracted_amount: values.extracted_amount ?? null,
    p_extracted_brand: values.extracted_brand ?? null,
    p_media_path: values.media_path ?? null
  });
  if (error) throw error;
  return data === true;
}

async function loadReceiptImage(supabase: SupabaseClient, job: Job, receiptId: string, mediaId: string, mediaPath: string | null, config: WorkerConfig): Promise<ReceiptImage> {
  if (mediaPath?.startsWith("receipts/")) {
    const { data, error } = await supabase.storage.from("receipts").download(mediaPath);
    if (error || !data) throw new ReceiptProviderError("Stored receipt image is unavailable", true);
    return validateReceiptImage(Buffer.from(await data.arrayBuffer()));
  }

  const image = await downloadMetaMedia(mediaId, config);
  const storagePath = `receipts/${receiptId}.${receiptImageExtension(image.mimeType)}`;
  const { error: uploadError } = await supabase.storage.from("receipts").upload(storagePath, image.bytes, {
    contentType: image.mimeType,
    upsert: true
  });
  if (uploadError) throw new ReceiptProviderError("Receipt image storage failed", true);

  if (!await updateReceiptForClaim(supabase, job, receiptId, { media_path: storagePath })) throw new Error(`Job ${job.id} lease was lost`);
  return image;
}

export async function processReceiptExtraction(supabase: SupabaseClient, job: Job, config: WorkerConfig) {
  const receiptId = String(job.payload.receipt_id ?? "");
  const mediaId = String(job.payload.media_id ?? "");
  const { data: receipt, error: receiptError } = await supabase.from("receipts").select("media_path, review_status").eq("id", receiptId).single();
  if (receiptError || !receipt) throw receiptError ?? new Error("Receipt not found");
  if (receipt.review_status !== "pending") return;

  if (!await updateReceiptForClaim(supabase, job, receiptId, { ai_status: "processing", ai_result: null })) return;

  try {
    const image = await loadReceiptImage(supabase, job, receiptId, mediaId, receipt.media_path, config);
    const extraction = await extractReceipt(image, config);
    await updateReceiptForClaim(supabase, job, receiptId, {
      extracted_amount: extraction.amount,
      extracted_brand: extraction.brand,
      ai_result: extraction,
      ai_status: "complete"
    });
  } catch (error) {
    const retryable = error instanceof ReceiptProviderError ? error.retryable : true;
    await updateReceiptForClaim(supabase, job, receiptId, {
      ai_status: retryable && job.attempts < MAX_JOB_ATTEMPTS ? "processing" : "failed",
      ai_result: null
    });
    throw error;
  }
}

async function processTemplateSend(supabase: SupabaseClient, job: Job, config: WorkerConfig) {
  const phoneNumberId = String(job.payload.phone_number_id ?? "");
  const to = String(job.payload.to ?? "");
  const templateName = String(job.payload.template_name ?? "");
  const receiptId = typeof job.payload.receipt_id === "string" ? job.payload.receipt_id : null;
  const deliveryId = String(job.payload.delivery_id ?? "");
  if (!receiptId || !deliveryId) throw new ReceiptProviderError("Delivery attempt is missing", false);

  const { data: delivery, error: deliveryError } = await supabase.from("message_deliveries")
    .update({ status: "sending", error: null })
    .eq("id", deliveryId)
    .eq("receipt_id", receiptId)
    .eq("status", "queued")
    .select("id, attempt_id")
    .maybeSingle();
  if (deliveryError) throw deliveryError;
  if (!delivery) throw new ReceiptProviderError("Delivery attempt is not safe to resend", false);

  let messageId: string | null = null;
  try {
    messageId = await sendWhatsAppTemplate({ phoneNumberId, to, templateName, config });
    const { error: sentError } = await supabase.from("message_deliveries").update({ provider_message_id: messageId, status: "sent" }).eq("id", deliveryId).eq("status", "sending");
    if (sentError) throw sentError;
    const { error: receiptError } = await supabase.from("receipts").update({ send_status: "sent", updated_at: new Date().toISOString() }).eq("id", receiptId);
    if (receiptError) throw receiptError;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown send error";
    const recovery = supabase.from("message_deliveries").update({ ...(messageId ? { provider_message_id: messageId } : {}), status: "unknown", error: message }).eq("id", deliveryId);
    if (messageId) {
      await recovery.in("status", ["sending", "sent"]);
      throw new ReceiptProviderError(`Post-send persistence failed: ${message}`, false);
    }
    await recovery.eq("status", "sending");
    await supabase.from("receipts").update({ send_status: "failed", updated_at: new Date().toISOString() }).eq("id", receiptId);
    throw new ReceiptProviderError(`Delivery outcome is unknown: ${message}`, false);
  }
}
