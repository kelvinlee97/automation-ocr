import { ReceiptQueue } from "@/components/receipt-queue";
import { WorkspaceShell } from "@/components/workspace-shell";
import { listReceipts } from "@/lib/data/receipts";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const receipts = await listReceipts();

  return (
    <WorkspaceShell>
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-[1440px]">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
              <p className="mt-2 text-sm text-muted-foreground">Review receipt submissions before a result is sent to the consumer.</p>
            </div>
            <div className="text-sm text-muted-foreground">August Home Refresh · 1 number connected</div>
          </div>
          <ReceiptQueue receipts={receipts} />
        </div>
      </main>
    </WorkspaceShell>
  );
}
