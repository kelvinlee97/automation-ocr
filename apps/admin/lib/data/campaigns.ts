import { campaignSchema, type Campaign } from "@claimflow/domain";
import { hasSupabaseEnv, isDemoMode } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const demoCampaigns: Campaign[] = [
  {
    id: "campaign-demo",
    name: "August Home Refresh",
    brand: "Samsung",
    phone_number_id: "demo-number",
    reject_template_name: "claim_rejected",
    starts_at: "2026-08-01T00:00:00+08:00",
    ends_at: "2026-08-31T23:59:59+08:00",
    min_amount: 500,
    is_active: true,
    created_at: "2026-08-01T00:00:00.000Z"
  }
];

export async function listCampaigns(): Promise<Campaign[]> {
  if (isDemoMode()) return demoCampaigns;
  if (!hasSupabaseEnv()) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id,name,brand,phone_number_id,reject_template_name,starts_at,ends_at,min_amount,is_active,created_at")
    .order("starts_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((campaign) => campaignSchema.parse(campaign));
}
