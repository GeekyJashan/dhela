import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, FileUp, Package, Users, LogOut, Sparkles, Files, Receipt, Store, Tag, ClipboardList, IndianRupee, Undo2, ShieldCheck, Globe, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LANGUAGES, setLanguage } from "@/i18n";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/invoices", label: "Purchases", icon: Files },
  { to: "/upload", label: "Upload invoice", icon: FileUp },
  { to: "/sales", label: "Sales", icon: Receipt },
  { to: "/orders", label: "Orders", icon: ClipboardList },
  { to: "/returns", label: "Returns", icon: Undo2 },
  { to: "/payments", label: "Payments", icon: IndianRupee },
  { to: "/retailers", label: "Retailers", icon: Store },
  { to: "/products", label: "Products", icon: Package },
  { to: "/pricing", label: "Pricing", icon: Tag },
  { to: "/suppliers", label: "Suppliers", icon: Users },
  { to: "/billing", label: "Billing", icon: CreditCard },
] as const;

function AuthedLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = Route.useRouteContext();
  const isAdmin = (user?.app_metadata as { platform_admin?: boolean } | undefined)?.platform_admin === true;
  const nav = isAdmin ? [...NAV, { to: "/admin", label: "Admin", icon: ShieldCheck }] : [...NAV];

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col print:hidden">
        <Link to="/dashboard" className="flex items-center gap-2 px-5 py-5 text-lg font-semibold border-b border-sidebar-border">
          <Sparkles className="h-5 w-5 text-accent" /> Ledgerly
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link key={to} to={to}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition ${
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                }`}>
                <Icon className="h-4 w-4" /> {t(label)}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <Select value={i18n.language} onValueChange={setLanguage}>
            <SelectTrigger className="w-full h-9 bg-transparent border-sidebar-border text-sidebar-foreground/80">
              <span className="inline-flex items-center gap-2"><Globe className="h-4 w-4" /><SelectValue /></span>
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> {t("Sign out")}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto"><Outlet /></main>
    </div>
  );
}
