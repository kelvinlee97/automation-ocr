import { campaignMutationSchema, campaignSchema } from "@claimflow/domain";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

const campaignFields = "id,name,brand,phone_number_id,reject_template_name,starts_at,ends_at,min_amount,is_active,created_at";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.role !== "super_admin") return NextResponse.json({ error: "Only super admins can manage campaigns" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = campaignMutationSchema.safeParse(json);
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Campaign details are invalid" }, { status: 400 });

  const { id } = await params;
  const { data, error } = await admin.supabase.from("campaigns").update({
    ...body.data,
    reject_template_name: body.data.reject_template_name || null
  }).eq("id", id).select(campaignFields).maybeSingle();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "That WhatsApp number is already assigned to another campaign" }, { status: 409 });
    return NextResponse.json({ error: "Campaign could not be saved" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json({ campaign: campaignSchema.parse(data) });
}
