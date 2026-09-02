"use client";

import { useMemo, useState } from "react";
import type { Receipt } from "@claimflow/domain";
import { Check, Clock3, FileImage, FileSearch, RefreshCw, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Filter = "all" | "pending" | "approved" | "rejected";
type BusyAction = "approve" | "reject" | "send" | "save" | "retry" | null;
type Feedback = { kind: "error" | "success"; message: string } | null;
type Draft = { receiptId: string | null; amount: string; brand: string };

function draftFor(receipt: Receipt | null): Draft {
  return {
    receiptId: receipt?.id ?? null,
    amount: receipt?.extracted_amount == null ? "" : String(receipt.extracted_amount),
    brand: receipt?.extracted_brand ?? ""
  };
}

function statusLabel(receipt: Receipt) {
  if (receipt.review_status === "approved") return "Approved";
  if (receipt.review_status === "rejected") return "Rejected";
  if (receipt.ai_status === "processing") return "Extracting";
  if (receipt.ai_status === "failed") return "Needs review";
  return "Pending review";
}

function statusIcon(receipt: Receipt) {
  if (receipt.review_status === "approved") return Check;
  if (receipt.review_status === "rejected") return X;
  if (receipt.ai_status === "processing") return Clock3;
  return FileSearch;
}

function statusVariant(receipt: Receipt) {
  if (receipt.review_status === "approved") return "default" as const;
  if (receipt.review_status === "rejected") return "destructive" as const;
  return "secondary" as const;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? "Something went wrong. Try again.";
}

export function ReceiptQueue({ receipts }: { receipts: Receipt[] }) {
  const [items, setItems] = useState(receipts);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(receipts[0]?.id ?? null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFor(receipts[0] ?? null));

  const filteredReceipts = useMemo(() => items.filter((receipt) => {
    const filterMatches = filter === "all" || (filter === "pending" ? receipt.review_status === "pending" : receipt.review_status === filter);
    const queryMatches = !query || `${receipt.phone_e164} ${receipt.extracted_brand ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return filterMatches && queryMatches;
  }), [filter, query, items]);

  const selected = filteredReceipts.find((receipt) => receipt.id === selectedId) ?? filteredReceipts[0] ?? null;
  const canEdit = selected?.review_status === "pending" && selected.ai_status === "complete";
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const selectedDraft = draft.receiptId === selected?.id ? draft : draftFor(selected);

  function updateSelected(patch: Partial<Receipt>) {
    if (!selected) return;
    setItems((current) => current.map((receipt) => receipt.id === selected.id ? { ...receipt, ...patch } : receipt));
  }

  function selectReceipt(id: string) {
    setSelectedId(id);
    setFeedback(null);
  }

  async function review(decision: "approved" | "rejected") {
    if (!selected || busyAction) return;
    setBusyAction(decision === "approved" ? "approve" : "reject");
    setFeedback(null);
    try {
      if (!isDemo) {
        const response = await fetch(`/api/receipts/${selected.id}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision })
        });
        if (!response.ok) throw new Error(await responseError(response));
      }
      updateSelected({ review_status: decision });
      setFeedback({ kind: "success", message: decision === "approved" ? "Receipt approved." : "Receipt rejected." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Review could not be saved." });
    } finally {
      setBusyAction(null);
    }
  }

  async function saveCorrections() {
    if (!selected || !canEdit || busyAction) return;
    const amountText = selectedDraft.amount.trim();
    const amount = amountText === "" ? null : Number(amountText);
    const brand = selectedDraft.brand.trim() || null;
    if ((amount !== null && (!Number.isFinite(amount) || amount < 0)) || (brand !== null && brand.length > 120)) {
      setFeedback({ kind: "error", message: "Enter a valid non-negative amount and a brand up to 120 characters." });
      return;
    }

    setBusyAction("save");
    setFeedback(null);
    try {
      if (isDemo) {
        updateSelected({
          extracted_amount: amount,
          extracted_brand: brand,
          ai_result: selected.ai_result ? { ...selected.ai_result, amount, brand } : null
        });
      } else {
        const response = await fetch(`/api/receipts/${selected.id}/extraction`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount, brand, summary: selected.ai_result?.summary })
        });
        if (!response.ok) throw new Error(await responseError(response));
        const body = await response.json() as { receipt?: Receipt };
        updateSelected(body.receipt ?? {
          extracted_amount: amount,
          extracted_brand: brand,
          ai_result: selected.ai_result ? { ...selected.ai_result, amount, brand } : null
        });
      }
      setFeedback({ kind: "success", message: "Amount and brand corrections saved." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Corrections could not be saved." });
    } finally {
      setBusyAction(null);
    }
  }

  async function retryExtraction() {
    if (!selected || selected.review_status !== "pending" || selected.ai_status !== "failed" || busyAction) return;
    setBusyAction("retry");
    setFeedback(null);
    try {
      if (!isDemo) {
        const response = await fetch(`/api/receipts/${selected.id}/retry-extraction`, { method: "POST" });
        if (!response.ok) throw new Error(await responseError(response));
      }
      updateSelected({ ai_status: "processing", ai_result: null });
      setFeedback({ kind: "success", message: "Extraction retry queued." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Retry could not be queued." });
    } finally {
      setBusyAction(null);
    }
  }

  async function sendResult() {
    if (!selected || busyAction || selected.review_status !== "rejected") return;
    if (!window.confirm("Send this review result to the participant?")) return;
    setBusyAction("send");
    setFeedback(null);
    try {
      if (!isDemo) {
        const response = await fetch(`/api/receipts/${selected.id}/send`, { method: "POST" });
        if (!response.ok) throw new Error(await responseError(response));
      }
      updateSelected({ send_status: isDemo ? "sent" : "queued" });
      setFeedback({ kind: "success", message: isDemo ? "Result marked as sent in demo mode." : "Result queued for delivery." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Result could not be queued." });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="min-w-0 shadow-none">
        <CardHeader className="gap-5 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Receipts</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{filteredReceipts.length} submission{filteredReceipts.length === 1 ? "" : "s"}</p>
          </div>
          <Input aria-label="Search receipts" className="min-h-11 w-full sm:max-w-56" placeholder="Search phone or brand" value={query} onChange={(event) => setQuery(event.target.value)} />
        </CardHeader>
        <div className="flex gap-1 overflow-x-auto border-b px-5 py-3" role="group" aria-label="Filter receipts">
          {["all", "pending", "approved", "rejected"].map((value) => (
            <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => { setFilter(value as Filter); setFeedback(null); }}>
              {value[0].toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
        {feedback ? <div role={feedback.kind === "error" ? "alert" : "status"} className={feedback.kind === "error" ? "mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" : "mx-5 mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"}>{feedback.message}</div> : null}
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[520px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[42%] pl-5">Submission</TableHead>
                  <TableHead className="w-[20%]">Amount</TableHead>
                  <TableHead className="w-[22%]">Status</TableHead>
                  <TableHead className="hidden w-[16%] pr-5 text-right md:table-cell">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReceipts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">No receipts match this view.</TableCell>
                  </TableRow>
                ) : filteredReceipts.map((receipt) => {
                  const Icon = statusIcon(receipt);
                  return (
                    <TableRow key={receipt.id} data-selected={receipt.id === selected?.id}>
                      <TableCell className="pl-5">
                        <button type="button" className="flex min-h-11 min-w-0 flex-col items-start justify-center gap-1 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-current={receipt.id === selected?.id ? "true" : undefined} onClick={() => selectReceipt(receipt.id)}>
                          <span className="font-medium">{receipt.phone_e164}</span>
                          <span className="text-xs text-muted-foreground">IC ending {receipt.ic_last4 ?? "—"}</span>
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{receipt.extracted_amount == null ? "—" : `RM ${receipt.extracted_amount.toFixed(2)}`}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(receipt)} className="gap-1 font-normal">
                          <Icon aria-hidden="true" className="size-3" />
                          <span className="sm:hidden">{statusLabel(receipt) === "Pending review" ? "Pending" : statusLabel(receipt)}</span>
                          <span className="hidden sm:inline">{statusLabel(receipt)}</span>
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden pr-5 text-right text-xs text-muted-foreground md:table-cell">{formatDate(receipt.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit shadow-none">
        {selected ? (
          <>
            <CardHeader className="flex-row items-start justify-between space-y-0 px-5 py-5">
              <div>
                <CardTitle className="text-base">Receipt details</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{selected.phone_e164}</p>
              </div>
              <Badge variant={statusVariant(selected)}>{statusLabel(selected)}</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 px-5 pb-5">
              <div className="overflow-hidden rounded-md border bg-muted/40">
                {selected.media_url ? (
                  <a href={selected.media_url} target="_blank" rel="noreferrer" className="block focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={selected.media_url} alt="Original receipt image" className="aspect-[4/3] w-full object-contain" />
                    <span className="block border-t px-3 py-2 text-center text-xs text-muted-foreground">Open original image</span>
                  </a>
                ) : (
                  <div className="grid aspect-[4/3] place-items-center gap-2 px-6 text-center text-sm text-muted-foreground">
                    <FileImage aria-hidden="true" className="size-6" />
                    <p>Original receipt image is unavailable.</p>
                    <p className="text-xs">Verify the fields manually before making a decision.</p>
                  </div>
                )}
              </div>

              {selected.ai_result ? (
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">AI extraction</p>
                    <span className="text-xs text-muted-foreground">Confidence {Math.round(selected.ai_result.confidence * 100)}%</span>
                  </div>
                  <p className="mt-2 text-muted-foreground">{selected.ai_result.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Confidence is advisory. Verify amount and brand against the original receipt.</p>
                </div>
              ) : selected.ai_status === "processing" ? (
                <div role="status" className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">Extraction is processing. Review will be enabled when it completes.</div>
              ) : selected.ai_status === "failed" ? (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">Extraction failed. Check the image and retry before approving.</div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="receipt-brand">Brand</Label>
                  <Input id="receipt-brand" className="min-h-11" value={selectedDraft.brand} disabled={!canEdit || busyAction !== null} onChange={(event) => setDraft({ receiptId: selected?.id ?? null, amount: selectedDraft.amount, brand: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receipt-amount">Amount (MYR)</Label>
                  <Input id="receipt-amount" className="min-h-11" type="number" inputMode="decimal" min="0" step="0.01" value={selectedDraft.amount} disabled={!canEdit || busyAction !== null} onChange={(event) => setDraft({ receiptId: selected?.id ?? null, amount: event.target.value, brand: selectedDraft.brand })} />
                </div>
              </div>
              <Button className="min-h-11" variant="outline" disabled={!canEdit || busyAction !== null} aria-busy={busyAction === "save"} onClick={saveCorrections}>
                {busyAction === "save" ? "Saving…" : "Save corrections"}
              </Button>

              {selected.modifications?.length ? (
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">Correction history</p>
                  <div className="mt-3 space-y-2">
                    {selected.modifications.map((modification) => (
                      <div key={modification.id} className="flex items-start justify-between gap-3 text-xs">
                        <span className="text-muted-foreground">
                          {modification.field_name === "amount" ? "Amount" : "Brand"}: {modification.old_value ?? "—"} → {modification.new_value ?? "—"}
                        </span>
                        <time dateTime={modification.modified_at} className="shrink-0 text-muted-foreground">{formatDate(modification.modified_at)}</time>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {selected.review_status === "pending" && selected.ai_status === "failed" ? (
                <Button className="min-h-11" variant="outline" disabled={busyAction !== null} aria-busy={busyAction === "retry"} onClick={retryExtraction}>
                  <RefreshCw data-icon="inline-start" />{busyAction === "retry" ? "Queueing retry…" : "Retry extraction"}
                </Button>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <Button className="min-h-11" disabled={selected.review_status !== "pending" || selected.ai_status !== "complete" || busyAction !== null} aria-busy={busyAction === "approve"} onClick={() => review("approved")}>
                  <Check data-icon="inline-start" />{busyAction === "approve" ? "Approving…" : "Approve"}
                </Button>
                <Button className="min-h-11" variant="outline" disabled={selected.review_status !== "pending" || busyAction !== null} aria-busy={busyAction === "reject"} onClick={() => review("rejected")}>
                  <X data-icon="inline-start" />{busyAction === "reject" ? "Rejecting…" : "Reject"}
                </Button>
              </div>
              <Button className="min-h-11" variant="secondary" disabled={busyAction !== null || selected.review_status !== "rejected" || !["none", "failed"].includes(selected.send_status)} aria-busy={busyAction === "send"} onClick={sendResult}>
                <Send data-icon="inline-start" />{busyAction === "send" ? "Queueing…" : "Send rejection result"}
              </Button>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-muted-foreground">Campaign</p><p className="mt-1 font-medium">{selected.campaign?.name ?? "Unassigned"}</p></div>
                <div><p className="text-xs text-muted-foreground">Received</p><p className="mt-1 font-medium">{formatDate(selected.created_at)}</p></div>
              </div>
            </CardContent>
          </>
        ) : (
          <CardContent className="grid min-h-80 place-items-center text-center text-sm text-muted-foreground">Select a receipt to review.</CardContent>
        )}
      </Card>
    </div>
  );
}
