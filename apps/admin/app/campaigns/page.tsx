import type { Campaign } from "@claimflow/domain";
import { Badge } from "@/components/ui/badge";
import { CampaignForm } from "@/components/campaign-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceShell } from "@/components/workspace-shell";
import { listCampaigns } from "@/lib/data/campaigns";
import { isDemoMode } from "@/lib/supabase/config";
import { requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CampaignStatus = "Active" | "Upcoming" | "Ended" | "Inactive";

function getCampaignStatus(campaign: Campaign): CampaignStatus {
  const now = Date.now();
  if (now < new Date(campaign.starts_at).getTime()) return "Upcoming";
  if (now > new Date(campaign.ends_at).getTime()) return "Ended";
  return campaign.is_active ? "Active" : "Inactive";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }).format(new Date(value));
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);
}

function statusVariant(status: CampaignStatus) {
  if (status === "Active") return "default" as const;
  if (status === "Upcoming") return "secondary" as const;
  return "outline" as const;
}

export default async function CampaignsPage() {
  const [campaigns, admin] = await Promise.all([
    listCampaigns(),
    isDemoMode() ? Promise.resolve(null) : requireAdmin()
  ]);
  const canManage = admin?.role === "super_admin";

  return (
    <WorkspaceShell>
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
              <p className="mt-2 text-sm text-muted-foreground">Manage promotion windows, minimum spend, and review rules.</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}
            </p>
          </div>

          {canManage ? (
            <details className="mt-8 rounded-xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <summary className="flex min-h-11 cursor-pointer list-none items-center font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                Add campaign
              </summary>
              <div className="border-t pt-5">
                <CampaignForm />
              </div>
            </details>
          ) : null}

          {campaigns.length === 0 ? (
            <Card className="mt-8 shadow-none">
              <CardContent className="py-12 text-center">
                <p className="font-medium">No campaigns configured.</p>
                <p className="mt-2 text-sm text-muted-foreground">Campaign data will appear here once it is added to Supabase.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="mt-8 space-y-4">
              {campaigns.map((campaign) => {
                const status = getCampaignStatus(campaign);

                return (
                  <Card key={campaign.id} className="shadow-none">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <CardTitle className="text-base">{campaign.name}</CardTitle>
                          <CardDescription className="mt-1">{campaign.brand} · WhatsApp campaign</CardDescription>
                        </div>
                        <Badge variant={statusVariant(status)}>{status}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-4 border-t pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Minimum amount</p>
                        <p className="mt-1 font-medium">{formatAmount(campaign.min_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Campaign window</p>
                        <p className="mt-1 font-medium">{formatDate(campaign.starts_at)} — {formatDate(campaign.ends_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">WhatsApp number</p>
                        <p className="mt-1 font-medium">{campaign.phone_number_id ? "Configured" : "Not configured"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Reject template</p>
                        <p className="mt-1 font-medium">{campaign.reject_template_name ?? "Not configured"}</p>
                      </div>
                    </CardContent>
                    {canManage ? (
                      <details className="border-t px-4 py-2.5 sm:px-5">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                          Edit campaign
                        </summary>
                        <div className="border-t py-5">
                          <CampaignForm campaign={campaign} />
                        </div>
                      </details>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </WorkspaceShell>
  );
}
