import { createHmac, timingSafeEqual } from "node:crypto";
import { metaWebhookSchema } from "@claimflow/domain";

export function verifyWebhookSignature(rawBody: string, signature: string | null, appSecret: string | undefined) {
  if (!appSecret || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

type SupabaseServiceClient = {
  from: (table: string) => any;
};

export async function enqueueWebhookMessages(supabase: SupabaseServiceClient, rawBody: string) {
  const parsed = metaWebhookSchema.parse(JSON.parse(rawBody));
  const messages = parsed.entry.flatMap((entry) => entry.changes.flatMap((change) => {
    const value = change.value;
    return (value.messages ?? []).map((message) => ({ message, phoneNumberId: value.metadata?.phone_number_id ?? null }));
  }));

  for (const { message, phoneNumberId } of messages) {
    let campaignId: string | null = null;
    if (phoneNumberId) {
      const { data, error } = await supabase.from("campaigns").select("id").eq("phone_number_id", phoneNumberId).eq("is_active", true).maybeSingle();
      if (error) throw error;
      campaignId = data?.id ?? null;
    }

    const { error: inboundError } = await supabase.from("inbound_messages").upsert({
      campaign_id: campaignId,
      meta_message_id: message.id,
      phone_e164: message.from,
      message_type: message.type,
      payload: message
    }, { onConflict: "meta_message_id", ignoreDuplicates: true });
    if (inboundError) throw inboundError;

    const { error: jobError } = await supabase.from("jobs").upsert({
      job_type: "message.process",
      dedupe_key: `message:${message.id}`,
      payload: { meta_message_id: message.id },
      status: "queued"
    }, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (jobError) throw jobError;
  }

  return messages.length;
}
