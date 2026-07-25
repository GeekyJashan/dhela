import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FileUp, Zap, Shield, GitBranch, ArrowRight, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
          <Logo size={26} />
          <div className="flex items-center gap-3">
            <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
            <Link to="/auth"><Button>Get started</Button></Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-20 text-center">
          <div className="flex justify-center">
            <Logo size={92} ambient withWordmark={false} />
          </div>
          <p className="mt-6 font-display text-3xl md:text-4xl text-primary">
            हर ढेला, हिसाब में<span className="text-muted-foreground/50"> · </span>
            <span className="text-foreground">Har dhela, hisaab mein.</span>
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Built for FMCG, Pharma, Hardware & Grocery distributors
          </div>
          <h1 className="font-display text-6xl md:text-7xl leading-[1.02] mt-6">
            Stop typing purchase invoices.<br />
            <span className="text-primary">Start approving them.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Dhela reads every supplier invoice — PDF, scan, photo — extracts products, matches your ERP catalog, validates GST, and posts inventory. Your operator just reviews.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link to="/auth"><Button size="lg" className="h-12 px-6">
              <FileUp className="h-4 w-4 mr-2" /> Upload your first invoice
            </Button></Link>
            <Button variant="outline" size="lg" className="h-12 px-6">See how it works <ArrowRight className="h-4 w-4 ml-2" /></Button>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
            <Stat label="Entry time" from="45 min" to="< 2 min" />
            <Stat label="Manual typing" from="100%" to="< 5%" />
            <Stat label="Match accuracy" from="—" to="98%+" />
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-3 gap-6">
        <Feature icon={<Zap />} title="Any invoice, any format"
          body="PDF, scanned image, WhatsApp photo — Dhela's vision AI reads them all and understands the semantics." />
        <Feature icon={<GitBranch />} title="Smart product matching"
          body="'MAGGI 70G' → 'MAGGI NOODLES 70 GM'. Semantic search, aliases and learned mappings resolve every supplier's naming quirks." />
        <Feature icon={<Shield />} title="Confidence you can trust"
          body="Every field carries a confidence score. Only uncertain ones surface for review. Full audit trail on every change." />
      </section>

      <section className="bg-sidebar text-sidebar-foreground py-20">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="font-display text-4xl">How it works</h2>
          <ol className="mt-10 space-y-6">
            {[
              ["Upload", "Drag in a PDF or snap a photo. Bulk uploads work too."],
              ["AI extracts", "Supplier, GSTIN, every line item, batch, expiry, HSN, discounts — all pulled with per-field confidence."],
              ["Match & validate", "Products auto-match your catalog. GST, HSN and totals are cross-checked."],
              ["Review & approve", "Only low-confidence fields are flagged. One click posts to inventory."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <div className="h-8 w-8 shrink-0 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-semibold">{i + 1}</div>
                <div><p className="font-semibold">{t}</p><p className="text-sidebar-foreground/70 text-sm mt-1">{d}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h2 className="font-display text-4xl">Ready to eliminate purchase entry?</h2>
        <p className="mt-3 text-muted-foreground">Free while in early access. No credit card.</p>
        <Link to="/auth" className="mt-8 inline-block">
          <Button size="lg" className="h-12 px-8">Start free <ArrowRight className="h-4 w-4 ml-2" /></Button>
        </Link>
        <div className="mt-8 flex justify-center gap-6 text-sm text-muted-foreground">
          {["Isolated workspace per distributor", "GST-aware", "Full audit trail"].map(s => (
            <span key={s} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> {s}</span>
          ))}
        </div>
      </section>

      <footer className="border-t py-10 flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <Logo size={22} />
        <p>© 2026 Dhela · dhela.in · Built for distributors.</p>
      </footer>
    </div>
  );
}

function Stat({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="line-through opacity-60">{from}</span>
      <ArrowRight className="h-3 w-3" />
      <span className="font-semibold text-foreground">{to}</span>
      <span className="text-xs">{label}</span>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
      <h3 className="mt-4 font-semibold text-lg">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
