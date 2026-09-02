"use client";

import type { Campaign } from "@claimflow/domain";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CampaignFormProps = { campaign?: Campaign };

const emptyValues = {
  name: "",
  brand: "",
  phone_number_id: "",
  reject_template_name: "",
  starts_at: "",
  ends_at: "",
  min_amount: "",
  is_active: true
};

function dateInputValue(value: string) {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric"
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function initialValues(campaign?: Campaign) {
  if (!campaign) return emptyValues;
  return {
    name: campaign.name,
    brand: campaign.brand,
    phone_number_id: campaign.phone_number_id,
    reject_template_name: campaign.reject_template_name ?? "",
    starts_at: dateInputValue(campaign.starts_at),
    ends_at: dateInputValue(campaign.ends_at),
    min_amount: String(campaign.min_amount),
    is_active: campaign.is_active
  };
}

function timestampFor(value: string, endOfDay: boolean) {
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`;
}

export function CampaignForm({ campaign }: CampaignFormProps) {
  const router = useRouter();
  const [values, setValues] = useState(() => initialValues(campaign));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const formId = `campaign-${campaign?.id ?? "new"}`;

  function updateValue(name: keyof typeof values, value: string | boolean) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(campaign ? `/api/campaigns/${campaign.id}` : "/api/campaigns", {
        method: campaign ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          brand: values.brand,
          phone_number_id: values.phone_number_id,
          reject_template_name: values.reject_template_name,
          starts_at: values.starts_at ? timestampFor(values.starts_at, false) : "",
          ends_at: values.ends_at ? timestampFor(values.ends_at, true) : "",
          min_amount: values.min_amount,
          is_active: values.is_active
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "Campaign could not be saved.");
        return;
      }

      setMessage(campaign ? "Campaign updated." : "Campaign created.");
      if (!campaign) setValues(emptyValues);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-name`}>Campaign name</Label>
          <Input id={`${formId}-name`} className="min-h-11" value={values.name} onChange={(event) => updateValue("name", event.target.value)} required maxLength={120} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-brand`}>Brand</Label>
          <Input id={`${formId}-brand`} className="min-h-11" value={values.brand} onChange={(event) => updateValue("brand", event.target.value)} required maxLength={120} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-phone`}>WhatsApp phone number ID</Label>
          <Input id={`${formId}-phone`} className="min-h-11" value={values.phone_number_id} onChange={(event) => updateValue("phone_number_id", event.target.value)} required maxLength={255} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-template`}>Reject template name</Label>
          <Input id={`${formId}-template`} className="min-h-11" value={values.reject_template_name} onChange={(event) => updateValue("reject_template_name", event.target.value)} maxLength={120} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-starts`}>Starts</Label>
          <Input id={`${formId}-starts`} className="min-h-11" type="date" value={values.starts_at} onChange={(event) => updateValue("starts_at", event.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-ends`}>Ends</Label>
          <Input id={`${formId}-ends`} className="min-h-11" type="date" value={values.ends_at} onChange={(event) => updateValue("ends_at", event.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-amount`}>Minimum amount (MYR)</Label>
          <Input id={`${formId}-amount`} className="min-h-11" type="number" inputMode="decimal" min="0" step="0.01" value={values.min_amount} onChange={(event) => updateValue("min_amount", event.target.value)} required />
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={values.is_active} onChange={(event) => updateValue("is_active", event.target.checked)} />
        Campaign is active
      </label>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {message ? <p className="text-sm text-foreground" role="status">{message}</p> : null}
      <Button type="submit" className="w-fit" disabled={busy}>{busy ? "Saving…" : campaign ? "Save changes" : "Create campaign"}</Button>
    </form>
  );
}
