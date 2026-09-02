import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNextPath } from "./next-path";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/login?error=missing_code", request.url));

  const cookieStore = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
    }
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
