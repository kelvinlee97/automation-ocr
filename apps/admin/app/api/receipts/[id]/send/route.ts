import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data: receipt, error } = await admin.supabase.from("receipts").select("id, campaign_id, phone_e164, review_status, send_status, campaign:campaigns(phone_number_id, reject_template_name)").eq("id", id).single();
  if (error || !receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (receipt.review_status !== "rejected") return NextResponse.json({ error: "Only rejected results can be sent in v1" }, { status: 409 });
  if (!["none", "failed"].includes(receipt.send_status)) return NextResponse.json({ error: "Receipt is already queued or sent" }, { status: 409 });

  const campaign = Array.isArray(receipt.campaign) ? receipt.campaign[0] : receipt.campaign;
  if (!campaign?.phone_number_id) return NextResponse.json({ error: "Campaign phone number is not configured" }, { status: 409 });
  if (!campaign.reject_template_name) return NextResponse.json({ error: "Campaign reject template is not configured" }, { status: 503 });
  const templateName = campaign.reject_template_name;

  const service = createSupabaseServiceClient();
  const { data: queuedReceipt, error: queueStateError } = await service.from("receipts").update({ send_status: "queued", updated_at: new Date().toISOString() }).eq("id", id).in("send_status", ["none", "failed"]).select("id").maybeSingle();
  if (queueStateError) return NextResponse.json({ error: "Could not queue result" }, { status: 500 });
  if (!queuedReceipt) return NextResponse.json({ error: "Receipt is already queued or sent" }, { status: 409 });

  const { data: delivery, error: deliveryError } = await service.from("message_deliveries").insert({ receipt_id: id, template_name: templateName, status: "queued" }).select("id").single();
  if (deliveryError || !delivery) {
    await service.from("receipts").update({ send_status: "failed", updated_at: new Date().toISOString() }).eq("id", id).eq("send_status", "queued");
    return NextResponse.json({ error: "Could not create delivery record" }, { status: 500 });
  }

  const { error: jobError } = await service.from("jobs").upsert({
    job_type: "whatsapp.send_template",
    dedupe_key: `send:${id}`,
    payload: { receipt_id: id, delivery_id: delivery.id, phone_number_id: campaign.phone_number_id, to: receipt.phone_e164, template_name: templateName },
    status: "queued",
    attempts: 0,
    locked_at: null,
    locked_by: null,
    claim_token: null,
    last_error: null,
    available_at: new Date().toISOString()
  }, { onConflict: "dedupe_key" });
  if (jobError) {
    await service.from("message_deliveries").update({ status: "failed", error: "Could not queue delivery" }).eq("id", delivery.id).eq("status", "queued");
    await service.from("receipts").update({ send_status: "failed", updated_at: new Date().toISOString() }).eq("id", id).eq("send_status", "queued");
    return NextResponse.json({ error: "Could not queue result" }, { status: 500 });
  }
  return NextResponse.json({ queued: true });
}
