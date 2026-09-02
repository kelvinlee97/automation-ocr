import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { enqueueWebhookMessages, verifyWebhookSignature } from "@/lib/whatsapp/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return NextResponse.json({ error: "Webhook storage is not configured" }, { status: 503 });

  try {
    const count = await enqueueWebhookMessages(createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }), rawBody);
    return NextResponse.json({ ok: true, enqueued: count });
  } catch (error) {
    console.error("WhatsApp webhook processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
