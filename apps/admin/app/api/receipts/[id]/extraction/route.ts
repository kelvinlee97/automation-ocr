import { NextResponse } from "next/server";
import { receiptExtractionSchema } from "@claimflow/domain";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/server";

const correctionSchema = z.object({
  amount: z.number().finite().nonnegative().max(9_999_999_999.99).nullable(),
  brand: z.string().trim().max(120).nullable(),
  summary: z.string().trim().min(1).max(500).optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = correctionSchema.safeParse(json);
  if (!body.success) return NextResponse.json({ error: "Amount and brand are invalid" }, { status: 400 });

  const { id } = await params;
  const { data: current, error: readError } = await admin.supabase.from("receipts").select("id, ai_status, review_status, ai_result").eq("id", id).single();
  if (readError || !current) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (current.review_status !== "pending") return NextResponse.json({ error: "Reviewed receipts cannot be edited" }, { status: 409 });
  if (current.ai_status !== "complete") return NextResponse.json({ error: "AI extraction is not complete" }, { status: 409 });

  const existing = receiptExtractionSchema.safeParse(current.ai_result);
  if (!existing.success) return NextResponse.json({ error: "Receipt extraction is unavailable" }, { status: 409 });

  const extraction = {
    ...existing.data,
    amount: body.data.amount,
    brand: body.data.brand?.trim() || null,
    ...(body.data.summary ? { summary: body.data.summary } : {})
  };
  const { data: receipt, error } = await admin.supabase.rpc("correct_receipt_extraction", {
    p_receipt_id: id,
    p_extraction: extraction
  }).single();
  if (error || !receipt) return NextResponse.json({ error: "Receipt changed; reload and try again" }, { status: 409 });
  return NextResponse.json({ receipt });
}
