import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/server";
import { saveReviewDecision } from "@/lib/review-decision";

const reviewSchema = z.object({ decision: z.enum(["approved", "rejected"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = reviewSchema.safeParse(json);
  if (!body.success) return NextResponse.json({ error: "Invalid review decision" }, { status: 400 });

  const { data: current, error: readError } = await admin.supabase.from("receipts").select("ai_status, review_status").eq("id", id).single();
  if (readError || !current) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (current.review_status !== "pending") return NextResponse.json({ error: "Receipt was already reviewed" }, { status: 409 });
  if (body.data.decision === "approved" && current.ai_status !== "complete") return NextResponse.json({ error: "AI extraction is not complete" }, { status: 409 });

  const { data: receipt, error } = await saveReviewDecision(admin.supabase, id, body.data.decision);
  if (error || !receipt) return NextResponse.json({ error: "Review could not be saved" }, { status: 409 });
  return NextResponse.json({ receipt });
}
