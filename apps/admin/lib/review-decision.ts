type SupabaseClient = any;

export function saveReviewDecision(supabase: SupabaseClient, receiptId: string, decision: "approved" | "rejected") {
  return supabase.rpc("review_receipt", { p_receipt_id: receiptId, p_decision: decision }).single();
}
