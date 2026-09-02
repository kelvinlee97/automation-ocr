import Link from "next/link";
import { FileCheck2, LayoutDashboard, Megaphone, Settings2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const navigation = [
  { href: "/receipts", label: "Receipts", icon: FileCheck2 },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/settings", label: "Settings", icon: Settings2 }
];

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-white lg:flex">
        <div className="flex h-20 items-center px-7">
          <Link href="/receipts" className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">C</span>
            ClaimFlow
          </Link>
        </div>
        <Separator />
        <nav aria-label="Primary navigation" className="flex flex-col gap-1 px-3 py-5">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-3 rounded-md px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-7 py-7 text-xs leading-5 text-muted-foreground">
          <p className="font-medium text-foreground">Operations workspace</p>
          <p className="mt-1">Single campaign · single number</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 items-center justify-between border-b bg-white px-6 lg:px-10">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">C</span>
            <span className="font-semibold tracking-tight">ClaimFlow</span>
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="hidden text-muted-foreground sm:inline">Reviewer</span>
            <span className="grid size-9 place-items-center rounded-full bg-accent text-sm font-medium text-accent-foreground">RV</span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
