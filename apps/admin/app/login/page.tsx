"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseEnv, isDemoMode } from "@/lib/supabase/config";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (isDemoMode()) {
      router.push("/receipts");
      return;
    }
    if (!hasSupabaseEnv()) {
      setError("Supabase is not configured for this environment.");
      return;
    }
    const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    else router.push("/receipts");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to ClaimFlow</CardTitle>
          <CardDescription>Access the receipt review workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <Button type="submit">Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
