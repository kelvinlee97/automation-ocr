import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceShell } from "@/components/workspace-shell";

export default function SettingsPage() {
  return (
    <WorkspaceShell>
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-muted-foreground">Provider credentials stay in deployment secrets, not in this UI.</p>
          <Card className="mt-8 shadow-none"><CardHeader><CardTitle className="text-base">Connected services</CardTitle><CardDescription>Runtime health is checked by the worker.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">Supabase, WhatsApp Cloud API and OpenAI GPT-5.6 Luna are configured through environment variables.</CardContent></Card>
        </div>
      </main>
    </WorkspaceShell>
  );
}
