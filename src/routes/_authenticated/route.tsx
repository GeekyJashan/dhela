import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, FileUp, Package, Users, LogOut, Files, Receipt, Store, Tag, ClipboardList, IndianRupee, Undo2, ShieldCheck, Globe, CreditCard, Truck } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LANGUAGES, setLanguage } from "@/i18n";
import { Assistant } from "@/components/assistant";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  ]},
  { label: "Buying", items: [
    { to: "/upload", label: "Upload invoice", icon: FileUp },
    { to: "/invoices", label: "Purchases", icon: Files },
    { to: "/suppliers", label: "Suppliers", icon: Users },
  ]},
  { label: "Selling", items: [
    { to: "/sales", label: "Sales", icon: Receipt },
    { to: "/orders", label: "Orders", icon: ClipboardList },
    { to: "/returns", label: "Returns", icon: Undo2 },
    { to: "/retailers", label: "Retailers", icon: Store },
    { to: "/eway", label: "E-way bills", icon: Truck },
  ]},
  { label: "Catalog", items: [
    { to: "/products", label: "Products", icon: Package },
    { to: "/pricing", label: "Pricing", icon: Tag },
  ]},
  { label: "Finance", items: [
    { to: "/payments", label: "Payments", icon: IndianRupee },
    { to: "/billing", label: "Billing", icon: CreditCard },
  ]},
];

function AuthedLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = Route.useRouteContext();
  const isAdmin = (user?.app_metadata as { platform_admin?: boolean } | undefined)?.platform_admin === true;
  const groups: NavGroup[] = isAdmin
    ? [...NAV_GROUPS, { label: "System", items: [{ to: "/admin", label: "Admin", icon: ShieldCheck }] }]
    : NAV_GROUPS;

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="h-dvh flex bg-background overflow-hidden print:h-auto print:overflow-visible">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col h-full print:hidden">
        <Link to="/dashboard" className="flex items-center px-5 py-5 border-b border-sidebar-border shrink-0">
          <Logo size={26} wordmarkClassName="dhela-word-gold" />
        </Link>
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-4">
          {groups.map((group, gi) => (
            <div key={group.label} className="space-y-0.5 animate-in fade-in slide-in-from-left-2 fill-mode-both"
              style={{ animationDelay: `${gi * 60}ms`, animationDuration: "400ms" }}>
              <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {t(group.label)}
              </p>
              {group.items.map(({ to, label, icon: Icon }) => {
                const active = pathname === to || pathname.startsWith(to + "/");
                return (
                  <Link key={to} to={to}
                    className={cn(
                      "group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-200",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:translate-x-0.5",
                    )}>
                    <span className={cn(
                      "absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-accent transition-all duration-300",
                      active ? "h-5 opacity-100" : "h-0 opacity-0",
                    )} />
                    <Icon className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-200",
                      active ? "text-accent" : "group-hover:scale-110",
                    )} />
                    {t(label)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2 shrink-0">
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
      <Assistant />
    </div>
  );
}
