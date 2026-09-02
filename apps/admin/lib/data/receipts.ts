import type { Receipt } from "@claimflow/domain";
import { hasSupabaseEnv, isDemoMode } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const demoReceipts: Receipt[] = [
  {
    id: "demo-001",
    campaign_id: "campaign-demo",
    phone_e164: "+60123456789",
    ic_last4: "4821",
    media_path: null,
    extracted_amount: 1299,
    extracted_brand: "Samsung",
    ai_result: { amount: 1299, brand: "Samsung", summary: "Receipt total and product brand recognized.", confidence: 0.94 },
    media_url: null,
    ai_status: "complete",
    review_status: "pending",
    send_status: "none",
    created_at: "2026-08-25T06:42:00.000Z",
    updated_at: "2026-08-25T06:44:00.000Z",
    campaign: { name: "August Home Refresh", brand: "Samsung" }
  },
  {
    id: "demo-002",
    campaign_id: "campaign-demo",
    phone_e164: "+60198765432",
    ic_last4: "0917",
    media_path: null,
    extracted_amount: 780,
    extracted_brand: "Dyson",
    ai_result: null,
    media_url: null,
    ai_status: "processing",
    review_status: "pending",
    send_status: "none",
    created_at: "2026-08-25T06:18:00.000Z",
    updated_at: "2026-08-25T06:19:00.000Z",
    campaign: { name: "August Home Refresh", brand: "Dyson" }
  },
  {
    id: "demo-004",
    campaign_id: "campaign-demo",
    phone_e164: "+60165554433",
    ic_last4: "2108",
    media_path: null,
    extracted_amount: null,
    extracted_brand: null,
    ai_result: null,
    media_url: null,
    ai_status: "failed",
    review_status: "pending",
    send_status: "none",
    created_at: "2026-08-25T05:32:00.000Z",
    updated_at: "2026-08-25T05:34:00.000Z",
    campaign: { name: "August Home Refresh", brand: "Panasonic" }
  },
  {
    id: "demo-003",
    campaign_id: "campaign-demo",
    phone_e164: "+60112223344",
    ic_last4: "7742",
    media_path: null,
    extracted_amount: 468,
    extracted_brand: "Panasonic",
    ai_result: { amount: 468, brand: "Panasonic", summary: "Receipt total and product brand recognized.", confidence: 0.91 },
    media_url: null,
    ai_status: "complete",
    review_status: "approved",
    send_status: "sent",
    created_at: "2026-08-25T05:50:00.000Z",
    updated_at: "2026-08-25T06:12:00.000Z",
    campaign: { name: "August Home Refresh", brand: "Panasonic" }
  }
];

export async function listReceipts(): Promise<Receipt[]> {
  if (isDemoMode()) return demoReceipts;
  if (!hasSupabaseEnv()) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("*, campaign:campaigns(name, brand), modifications:receipt_modifications(id, modified_at, modified_by, field_name, old_value, new_value)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return Promise.all((data as Receipt[]).map(async (receipt) => {
    if (!receipt.media_path?.startsWith("receipts/")) return { ...receipt, media_url: null };
    const { data: signed, error: signedError } = await supabase.storage.from("receipts").createSignedUrl(receipt.media_path, 300);
    return { ...receipt, media_url: signedError ? null : signed?.signedUrl ?? null };
  }));
}
