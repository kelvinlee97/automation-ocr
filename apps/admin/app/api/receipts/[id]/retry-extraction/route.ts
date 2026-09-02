import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data: receipt, error: readError } = await admin.supabase.from("receipts").select("id, media_path, ai_status, review_status").eq("id", id).single();
  if (readError || !receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (receipt.review_status !== "pending") return NextResponse.json({ error: "Reviewed receipts cannot be retried" }, { status: 409 });
  if (receipt.ai_status !== "failed") return NextResponse.json({ error: "Only failed extractions can be retried" }, { status: 409 });

  const service = createSupabaseServiceClient();
  const { data: processingReceipt, error: receiptError } = await service.from("receipts").update({ ai_status: "processing", ai_result: null, updated_at: new Date().toISOString() }).eq("id", id).eq("ai_status", "failed").eq("review_status", "pending").select("id").maybeSingle();
  if (receiptError) return NextResponse.json({ error: "Could not update receipt status" }, { status: 500 });
  if (!processingReceipt) return NextResponse.json({ error: "Receipt changed; reload and try again" }, { status: 409 });

  const { error: jobError } = await service.from("jobs").upsert({
    job_type: "receipt.extract",
    dedupe_key: `receipt:${id}`,
    payload: { receipt_id: id, media_id: receipt.media_path ?? "" },
    status: "queued",
    attempts: 0,
    locked_at: null,
    locked_by: null,
    claim_token: null,
    last_error: null,
    available_at: new Date().toISOString()
  }, { onConflict: "dedupe_key" });
  if (jobError) {
    await service.from("receipts").update({ ai_status: "failed", updated_at: new Date().toISOString() }).eq("id", id).eq("ai_status", "processing");
    return NextResponse.json({ error: "Could not queue extraction retry" }, { status: 500 });
  }
  const { error: eventError } = await service.from("receipt_events").insert({ receipt_id: id, actor_id: admin.user.id, event_type: "extraction_retried" });
  if (eventError) return NextResponse.json({ error: "Retry queued but audit event failed" }, { status: 500 });
  return NextResponse.json({ queued: true });
}
