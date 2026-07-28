import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { Reveal, CountUp, useInView } from "@/components/reveal";
import { PLANS, type PlanId } from "@/lib/plans";
import { whatsappLink, supportPhoneDisplay, supportPhoneDigits, FOUNDER_EMAIL } from "@/lib/support";
import { cn } from "@/lib/utils";
import { LANG_SAMPLES } from "@/lib/lang-samples";
import {
  FileUp, ArrowRight, CheckCircle2, Check, Moon, PhoneCall, TrendingDown, Truck,
  Package, Receipt, Store, Users, IndianRupee, ClipboardList, Undo2, FileText,
  ScanLine, Languages, ShieldCheck, MessageCircle, Sparkles, Boxes, Percent, X, RotateCw, Menu, ChevronDown, Linkedin,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify(structuredData()),
    }],
  }),
  component: Landing,
});

/**
 * JSON-LD for the landing page. FAQPage is only legitimate because the answers
 * are now in the server-rendered DOM — schema has to match visible content.
 * Prices come from PLANS so the markup can't drift from what we charge.
 */
function structuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://dhela.in/#organization",
        name: "Dhela",
        url: "https://dhela.in/",
        logo: "https://dhela.in/dhela.svg",
        image: "https://dhela.in/og-image.png",
        description: "Invoice and inventory software for Indian distributors.",
        areaServed: { "@type": "Country", name: "India" },
        // City and state only — enough for Google to place the business in the
        // Jalandhar distributor belt it actually sells into, without putting a
        // street address on a one-person company's public page.
        address: {
          "@type": "PostalAddress",
          addressLocality: "Jalandhar",
          addressRegion: "Punjab",
          addressCountry: "IN",
        },
        founder: { "@id": "https://dhela.in/#founder" },
        // The company page is the entity signal; the founder profile is the
        // E-E-A-T one. Both were flagged empty in the last two audits.
        sameAs: [LINKEDIN_COMPANY, LINKEDIN],
        contactPoint: [{
          "@type": "ContactPoint",
          contactType: "sales",
          telephone: `+${supportPhoneDigits()}`,
          email: FOUNDER_EMAIL,
          availableLanguage: ["English", "Hindi", "Punjabi"],
        }],
      },
      {
        "@type": "Person",
        "@id": "https://dhela.in/#founder",
        name: "Jashan Sehgal",
        jobTitle: "Founder",
        description:
          "Founder of Dhela. NIT alumnus; builds invoice and inventory software for "
          + "Indian distributors.",
        alumniOf: { "@type": "CollegeOrUniversity", name: "National Institute of Technology" },
        worksFor: { "@id": "https://dhela.in/#organization" },
        url: LINKEDIN,
        sameAs: [LINKEDIN],
      },
      {
        "@type": "WebPage",
        "@id": "https://dhela.in/#webpage",
        url: "https://dhela.in/",
        name: "Dhela — Invoice & Inventory Software for Indian Distributors",
        isPartOf: { "@id": "https://dhela.in/#organization" },
        about: { "@id": "https://dhela.in/#software" },
        author: { "@id": "https://dhela.in/#founder" },
        primaryImageOfPage: "https://dhela.in/og-image.png",
        datePublished: PUBLISHED,
        dateModified: UPDATED,
        inLanguage: "en-IN",
      },
      {
        "@type": "SoftwareApplication",
        "@id": "https://dhela.in/#software",
        name: "Dhela",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: "https://dhela.in/",
        publisher: { "@id": "https://dhela.in/#organization" },
        inLanguage: ["en", "hi", "pa"],
        description:
          "Dhela is invoice and inventory software for Indian distributors. It reads supplier "
          + "bills with AI, updates stock and true weighted-average cost, raises GST invoices, "
          + "prepares e-way bills and GSTR-1 working papers, and answers questions about the "
          + "business in English, Hindi or Punjabi.",
        offers: (["free", "standard", "pro"] as PlanId[]).map(id => ({
          "@type": "Offer",
          name: `${PLANS[id].name} plan`,
          price: String(PLANS[id].priceYearly),
          priceCurrency: "INR",
          category: PLANS[id].priceYearly === 0 ? "free" : "subscription",
          url: "https://dhela.in/#pricing",
        })),
      },
      {
        "@type": "FAQPage",
        "@id": "https://dhela.in/#faq",
        mainEntity: FAQS.map(([q, a]) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const LINKEDIN = "https://www.linkedin.com/in/jashan-sehgal-b11a19226/";
/**
 * The vanity URL, not the /company/142985997 form. The numeric one redirects a
 * logged-out visitor to a login wall, so a crawler following it from sameAs
 * learns nothing; the vanity URL serves the page publicly. Two a's because
 * /company/dhela belongs to an unrelated fashion label.
 */
const LINKEDIN_COMPANY = "https://www.linkedin.com/company/dhelaa/";
// Freshness is a real citation signal, so these are stated rather than implied.
// Bump UPDATED when the page's substance changes, not on every deploy.
const PUBLISHED = "2026-07-13";
const UPDATED = "2026-07-28";
const DEMO_WA = whatsappLink("Hi Jashan! I saw Dhela and want to know more for my distribution business.");

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <SiteHeader />
      <Hero />
      <FormatMarquee />
      <Pain />
      <ProductTour />
      <HowItWorks />
      <Features />
      <AssistantSpotlight />
      <Multilingual />
      <Comparison />
      <Pricing />
      <Faq />
      <FounderCta />
      <SiteFooter />
    </div>
  );
}

/* ------------------------------- header ------------------------------- */

function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    ["#how", "How it works"],
    ["#features", "Everything you get"],
    ["#pricing", "Pricing"],
    ["#faq", "FAQ"],
  ] as const;

  return (
    <header className={cn(
      "sticky top-0 z-30 border-b transition-all duration-300",
      scrolled ? "bg-background/85 backdrop-blur-md border-border shadow-sm" : "bg-transparent border-transparent",
    )}>
      <div className={cn(
        "max-w-6xl mx-auto flex items-center justify-between px-6 transition-all duration-300",
        scrolled ? "h-14" : "h-18",
      )}>
        <Logo size={30} />
        <nav className="hidden lg:flex items-center gap-7 text-sm text-muted-foreground">
          {links.map(([href, label]) => (
            <a key={href} href={href} className="hover:text-foreground transition-colors">{label}</a>
          ))}
          {/* A route, not a hash, so it needs Link. Without a crawlable path
              from here the blog is an orphan the sitemap alone has to carry. */}
          <Link to="/blog" className="hover:text-foreground transition-colors">Guides</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/auth" className="hidden sm:block"><Button variant="ghost">Sign in</Button></Link>
          <Link to="/auth"><Button>Start free <ArrowRight className="h-4 w-4 ml-1.5" /></Button></Link>
          <button onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="lg:hidden -mr-1 p-2 rounded-md text-foreground/70 hover:bg-muted hover:text-foreground">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="lg:hidden border-t bg-background/95 backdrop-blur-md px-6 py-3 space-y-1">
          <Link to="/blog" onClick={() => setMenuOpen(false)}
            className="block rounded-md px-3 py-2.5 text-sm hover:bg-muted transition-colors">
            Guides
          </Link>
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)}
              className="block rounded-md px-3 py-2.5 text-sm hover:bg-muted transition-colors">
              {label}
            </a>
          ))}
          <Link to="/auth" onClick={() => setMenuOpen(false)}
            className="block rounded-md px-3 py-2.5 text-sm hover:bg-muted transition-colors sm:hidden">
            Sign in
          </Link>
        </nav>
      )}
    </header>
  );
}

/* -------------------------------- hero -------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-40" />
      <div className="blob h-80 w-80 -top-24 -left-16 bg-primary/25" />
      <div className="blob h-96 w-96 -top-32 right-0 bg-accent/30" style={{ animationDelay: "-6s" }} />

      <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-20 text-center">
        <div className="flex justify-center">
          <Logo size={78} ambient />
        </div>
        <p className="mt-5 font-display text-3xl md:text-4xl text-primary">हर ढेला, हिसाब में</p>
        <p className="mt-2 text-xs uppercase tracking-[0.25em] text-muted-foreground">Har dhela, hisaab mein</p>

        <div className="mt-8 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          For FMCG, Pharma, Hardware, Grocery & General distributors
        </div>

        {/* Names the three things it does before it names the benefit. The old
            "Your entire back office, run by AI" shared no keyword at all with
            the title tag or the meta description, and told a distributor
            scanning the page nothing about what the software is. */}
        <h1 className="font-display text-5xl md:text-6xl leading-[1.05] mt-6">
          Invoices, stock and GST<br />
          for Indian distributors,<br />
          <span className="text-primary">run by AI.</span>
        </h1>

        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          <strong className="font-medium text-foreground">Dhela is invoice and inventory software
          for Indian distributors.</strong>{" "}
          It reads every supplier bill with AI, updates your stock and true weighted-average cost,
          raises GST invoices, prepares e-way bills and GSTR-1 working papers, and answers questions
          about your business in English, हिंदी or ਪੰਜਾਬੀ.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/auth"><Button size="lg" className="h-12 px-6">
            <FileUp className="h-4 w-4 mr-2" /> Start free — no card
          </Button></Link>
          <a href={DEMO_WA} target="_blank" rel="noreferrer">
            <Button variant="outline" size="lg" className="h-12 px-6">
              <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp the founder
            </Button>
          </a>
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {["Free plan, forever", "Set up in an evening", "Keep using Tally alongside", "Your workspace is yours alone"].map(s => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {s}
            </span>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          <HeroStat value={<><CountUp to={45} />→<CountUp to={2} /> min</>} label="Per purchase bill, start to stock" />
          <HeroStat value={<>{PLANS.free.aiExtractionsPerMonth}</>} label="Free AI bill reads every month" />
          <HeroStat value={<>{inr(333)}<span className="text-base font-normal">/mo</span></>} label="Less than a day of a clerk's pay" />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <Reveal className="rounded-xl border bg-card/70 backdrop-blur px-4 py-5 card-lift">
      <div className="font-display text-3xl text-primary">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Reveal>
  );
}

/* ------------------------------ marquee ------------------------------ */

const FORMATS = [
  "Supplier PDF", "Scanned bill", "WhatsApp photo", "Tally print-out", "Thermal print",
  "Multi-page invoice", "Handwritten order", "Excel order sheet", "Purchase order",
];

function FormatMarquee() {
  return (
    <section className="border-y bg-muted/40 py-4 marquee overflow-hidden">
      <p className="text-center text-xs uppercase tracking-widest text-muted-foreground mb-3">
        Throw anything at it
      </p>
      <div className="marquee-track gap-3">
        {[...FORMATS, ...FORMATS].map((f, i) => (
          <span key={i} className="shrink-0 rounded-full border bg-card px-4 py-1.5 text-sm text-muted-foreground">
            {f}
          </span>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------- pain -------------------------------- */

const PAINS = [
  {
    icon: Moon,
    pain: "It's 10 at night and you're still keying in today's purchase bills.",
    fix: "Drop the whole pile in at once. Dhela reads supplier, GSTIN, every line item, HSN, batch, expiry and discount — with a confidence score on each field.",
  },
  {
    icon: PhoneCall,
    pain: "\"Bhaiya, mera hisaab bhej do.\" — and you go digging through a register.",
    fix: "Open the retailer, tap Statement. A running debit-credit ledger for any date range, ready to print or send.",
  },
  {
    icon: TrendingDown,
    pain: "You know your turnover. You don't actually know your profit.",
    fix: "Every sale carries the weighted-average cost of what you actually paid, locked at the moment you issue. Real margin, product by product.",
  },
  {
    icon: Truck,
    pain: "A ₹50,000 invoice is going out and the e-way bill is a scramble.",
    fix: "Dhela flags every invoice that crosses the threshold, fills Part A from the invoice itself, and hands you the NIC upload file — free.",
  },
];

function Pain() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      <Reveal className="text-center max-w-2xl mx-auto">
        <h2 className="font-display text-4xl md:text-5xl">Sound familiar?</h2>
        <p className="mt-3 text-muted-foreground">
          Four evenings every distributor knows. Here's what each one turns into.
        </p>
      </Reveal>

      <div className="mt-12 grid md:grid-cols-2 gap-5">
        {PAINS.map(({ icon: Icon, pain, fix }, i) => (
          <Reveal key={pain} delay={i * 80}>
            <div className="group h-full rounded-2xl border bg-card p-6 card-lift">
              <div className="flex items-start gap-4">
                <div className="h-11 w-11 shrink-0 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-display text-xl leading-snug">{pain}</p>
                  <div className="mt-3 flex gap-2 text-sm text-muted-foreground">
                    <ArrowRight className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                    <span>{fix}</span>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}


/* ------------------------------ product tour ------------------------------ */

const TOUR: { id: string; label: string; caption: string; img: string; alt: string }[] = [
  { id: "upload", label: "Drop the whole pile", img: "/shots/bulk.webp",
    caption: "Throw the whole pile in at once — up to 100 a batch. Each one queues with a thumbnail so you can spot a blurred photo before it's read, and the batch processes in the background while you carry on.",
    alt: "Dhela bulk upload screen with fourteen supplier bills queued as thumbnails, each marked Ready, and an Upload and extract button showing 14 files" },
  { id: "review", label: "Read a bill", img: "/shots/review.webp",
    caption: "Supplier, GSTIN, HSN, quantities, rates and GST — pulled off the bill with a confidence score. You check the flagged fields and approve.",
    alt: "Dhela purchase review screen showing a supplier invoice extracted into editable fields with line items, HSN codes and a 92% extraction accuracy score" },
  { id: "insights", label: "See the money", img: "/shots/insights.webp",
    caption: "Net sales, real margin, what's collected, what's still outstanding, and how long your money sits with retailers.",
    alt: "Dhela insights dashboard showing business health score, net sales, profit margin, collections and outstanding receivables" },
  { id: "gst", label: "File your GST", img: "/shots/gst.webp",
    caption: "GSTR-1 working papers — B2B, B2CS, credit notes, HSN summary — and a GSTR-3B summary, each downloadable for your accountant.",
    alt: "Dhela GST returns screen showing GSTR-1 working papers and a GSTR-3B summary for a selected month" },
  { id: "payments", label: "Chase what's owed", img: "/shots/payments.webp",
    caption: "Receivables ageing by retailer, every payment in and out, and a printable statement for anyone who asks.",
    alt: "Dhela payments screen showing receivables ageing by retailer and full payment history" },
];

const TOUR_MS = 6500;
const PHONE_STAGES = ["Scanning bill…", "Uploading…", "Extracting line items…", "Ready to review"];

function ProductTour() {
  const [active, setActive] = useState(0);
  const [stage, setStage] = useState(0);
  const { ref, inView } = useInView(0.2);
  const paused = useRef(false);
  const frame = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [wire, setWire] = useState({ x: 0, y: 0, w: 0 });

  // Bumped whenever someone picks a slide themselves, which restarts the timer
  // below. Without it the interval kept its own schedule, so a tab you clicked
  // could be replaced a fraction of a second later — you get a full TOUR_MS on
  // the slide you asked for, which is also what stopped the e2e connector
  // assertion measuring a tab that had already moved on.
  const [pick, setPick] = useState(0);
  const select = (i: number) => { setActive(i); setPick(p => p + 1); };
  // Functional form: the arrow-key listener is registered once, so reading
  // `active` from its closure would always step from whichever slide was
  // showing when the tour first scrolled into view.
  const step = (d: number) => {
    setActive(a => (a + d + TOUR.length) % TOUR.length);
    setPick(p => p + 1);
  };

  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => {
      if (!paused.current) setActive(a => (a + 1) % TOUR.length);
    }, TOUR_MS);
    return () => clearInterval(id);
  }, [inView, pick]);

  // Phone status cycles on its own clock, matched to the scan sweep.
  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setStage(s => (s + 1) % PHONE_STAGES.length), 3200);
    return () => clearInterval(id);
  }, [inView]);

  // Slide the golden connector under whichever tab is live. It tracks y as
  // well as x because the row wraps to three lines on a phone, where anchoring
  // to the bottom of the block would leave it under the wrong tab.
  useEffect(() => {
    const measure = () => {
      const row = tabsRef.current;
      const el = row?.children[active] as HTMLElement | undefined;
      if (!row || !el) return;
      setWire({ x: el.offsetLeft, y: el.offsetTop + el.offsetHeight + 5, w: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  useEffect(() => {
    if (!inView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inView]);

  // Small angles only — past a few degrees a screenshot stops reading as a
  // screen and starts reading as a gimmick.
  const tilt = (e: React.MouseEvent) => {
    const el = frame.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform =
      `perspective(1400px) rotateY(${px * 5}deg) rotateX(${-py * 3.5}deg) scale(1.015)`;
  };
  const untilt = () => {
    if (frame.current) frame.current.style.transform = "perspective(1400px)";
  };

  const shot = TOUR[active];

  return (
    <section id="tour" className="relative overflow-hidden border-y bg-muted/30 py-24 scroll-mt-16">
      <div className="blob h-80 w-80 -top-20 left-1/4 bg-primary/15" />
      <div className="blob h-72 w-72 bottom-0 right-10 bg-accent/20" style={{ animationDelay: "-9s" }} />

      <div ref={ref} className="relative max-w-6xl mx-auto px-6">
        <Reveal className="text-center max-w-2xl mx-auto">
          <h2 className="font-display text-4xl md:text-5xl">Look inside the software</h2>
          <p className="mt-3 text-muted-foreground">
            Real screens, real numbers — not mock-ups. This is the actual app.
          </p>
        </Reveal>

        <div className="relative mt-10"
          onMouseEnter={() => { paused.current = true; }}
          onMouseLeave={() => { paused.current = false; }}>
          <div ref={tabsRef} className="relative flex flex-wrap justify-center gap-2">
            {TOUR.map((t, i) => (
              <button key={t.id} onClick={() => select(i)} aria-current={i === active}
                data-tour-tab
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-all duration-300",
                  i === active
                    ? "border-accent/60 bg-primary text-primary-foreground shadow-md scale-105"
                    : "hover:bg-muted hover:border-accent/40 text-muted-foreground",
                )}>
                {t.label}
              </button>
            ))}
            {/* Golden filament tracking the live tab. */}
            {/* left-0 matters: an absolute element with no left resolves to its
                static position, which here is after the last flex item — the
                connector then floats off past the final tab. */}
            <span aria-hidden className="tab-wire pointer-events-none absolute left-0 top-0 h-[2px] rounded-full"
              style={{
                transform: `translate(${wire.x}px, ${wire.y}px)`, width: wire.w,
                background: "linear-gradient(90deg, transparent, oklch(0.82 0.145 68), transparent)",
                boxShadow: "0 0 10px 1px oklch(0.82 0.145 68 / 0.6)",
              }} />
          </div>
        </div>

        <div className="mt-10 grid lg:grid-cols-[1.55fr_1fr] gap-8 items-start"
          onMouseEnter={() => { paused.current = true; }}
          onMouseLeave={() => { paused.current = false; }}>
          <Reveal>
            <div ref={frame} onMouseMove={tilt} onMouseLeave={untilt}
              className="tour-frame relative rounded-xl border bg-card shadow-2xl overflow-hidden">
              <div className="flex items-center gap-1.5 border-b bg-muted/60 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
                <span className="ml-3 rounded bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                  dhela.in/{shot.id}
                </span>
              </div>
              <div className="tour-screen relative">
                {/* The entry animation and the hover zoom live on different
                    elements: shot-in fills forwards with transform:none, which
                    would otherwise beat the :hover scale. */}
                <div key={shot.id} className="shot-in">
                  <img src={shot.img} alt={shot.alt}
                    width={1600} height={1003} loading="lazy" decoding="async"
                    className="tour-img block w-full" />
                </div>
                <GoldenWires key={`w${active}`} />
              </div>
            </div>
            <div className="mt-5 flex justify-center gap-1.5 lg:hidden">
              {TOUR.map((t, i) => (
                <button key={t.id} onClick={() => select(i)}
                  aria-label={`Go to ${t.label}`} data-tour-dot
                  className={cn("h-1.5 rounded-full transition-all",
                    i === active ? "w-6 bg-primary" : "w-1.5 bg-border")} />
              ))}
            </div>
          </Reveal>

          <div className="space-y-6">
            <div key={`c${active}`} className="shot-in">
              <p className="font-display text-2xl">{shot.label}</p>
              <p className="mt-2 text-muted-foreground">{shot.caption}</p>
            </div>

            <Reveal delay={80} className="hidden lg:block">
              <div className="phone-float relative mx-auto w-[214px] rounded-[2rem] border-[7px] border-foreground/90 bg-foreground/90 shadow-2xl">
                <div className="relative overflow-hidden rounded-[1.4rem]">
                  <img src="/shots/mobile-upload.webp" width={380} height={780} loading="lazy" decoding="async"
                    alt="Dhela upload screen on a phone, showing a Take photo button that opens the camera to capture supplier bills"
                    className="block w-full" />
                  {/* scan sweep, matched to the status line below */}
                  <span aria-hidden className="phone-scan pointer-events-none absolute inset-x-0 top-0 h-10" />
                </div>
                {/* Dynamic Island */}
                <div aria-hidden
                  className="absolute left-1/2 top-1.5 h-[18px] w-[62px] -translate-x-1/2 rounded-full bg-foreground" />
              </div>

              <div className="mt-4 flex items-center justify-center gap-2 text-xs">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                <span key={stage} className="status-swap font-medium text-muted-foreground">
                  {PHONE_STAGES[stage]}
                </span>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Golden filaments that draw across the screen as it changes — the visual
 * equivalent of the change being carried through rather than cut to. Purely
 * decorative, so it's aria-hidden and vanishes under reduced motion.
 */
function GoldenWires() {
  const paths = [
    "M -50 240 C 320 120, 700 360, 1150 180",
    "M -50 520 C 380 400, 760 640, 1150 460",
    "M -50 760 C 300 700, 820 880, 1150 720",
  ];
  return (
    <svg aria-hidden viewBox="0 0 1100 1003" preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full">
      {paths.map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke="oklch(0.82 0.145 68)" strokeWidth="2"
            className="wire" style={{ animationDelay: `${i * 110}ms`,
              filter: "drop-shadow(0 0 4px oklch(0.82 0.145 68 / 0.8))" }} />
          <circle r="3.5" fill="oklch(0.93 0.09 90)" className="wire-spark"
            style={{ offsetPath: `path("${d}")`, animationDelay: `${i * 110}ms`,
                     filter: "drop-shadow(0 0 6px oklch(0.82 0.145 68))" }} />
        </g>
      ))}
    </svg>
  );
}

/* ---------------------------- how it works ---------------------------- */

const STEPS = [
  {
    title: "Upload",
    blurb: "Drag in a PDF, a scan, or a photo you got on WhatsApp. One bill or fifty.",
    detail: "One file opens straight away for review. A batch processes in the background while you carry on.",
    icon: FileUp,
    lines: ["invoice_1042.pdf", "sharma_traders.jpg", "hindustan_apr.pdf"],
  },
  {
    title: "AI reads it",
    blurb: "Supplier, GSTIN, every line item, HSN, batch, expiry, discounts — pulled in seconds.",
    detail: "Or use the free OCR engine, unlimited on every plan, when the bill is a clean digital print.",
    icon: ScanLine,
    lines: ["Supplier · Hindustan Traders", "GSTIN · 03AABCH1234K1Z9", "12 line items · HSN filled"],
  },
  {
    title: "You approve",
    blurb: "Only the fields the AI wasn't sure about are flagged. Everything else is already right.",
    detail: "Approving posts the items into stock and updates each product's weighted-average cost.",
    icon: CheckCircle2,
    lines: ["9 fields confident", "1 field to check", "Approve → stock updated"],
  },
  {
    title: "You sell",
    blurb: "Pick a retailer, rates auto-fill from your pricing rules, issue a GST invoice.",
    detail: "Print or save a PDF with your bank details and signature. Stock deducts, cost locks, margin is real.",
    icon: Receipt,
    lines: ["Retailer · Gupta Kirana", "Rate from pricing rule", "Issue → stock deducted"],
  },
  {
    title: "You get paid",
    blurb: "Receivables ageing, payments, statements and reminders — all in one place.",
    detail: "See exactly who is 30, 60 and 90 days late before it becomes a problem.",
    icon: IndianRupee,
    lines: ["₹4,20,000 outstanding", "3 retailers past 30 days", "Statement ready to print"],
  },
];

const STEP_MS = 5200;

function HowItWorks() {
  const [active, setActive] = useState(0);
  const { ref, inView } = useInView(0.3);
  const paused = useRef(false);

  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => {
      if (!paused.current) setActive(a => (a + 1) % STEPS.length);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [inView]);

  const step = STEPS[active];

  return (
    <section id="how" className="bg-sidebar text-sidebar-foreground py-24 scroll-mt-16">
      <div ref={ref} className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="font-display text-4xl md:text-5xl">From a pile of bills to money in the bank</h2>
          <p className="mt-3 text-sidebar-foreground/70">Five steps. The first four take about two minutes.</p>
        </div>

        <div className="mt-12 grid lg:grid-cols-[1fr_1.1fr] gap-8 items-start">
          <div
            className="space-y-2"
            onMouseEnter={() => { paused.current = true; }}
            onMouseLeave={() => { paused.current = false; }}
          >
            {STEPS.map((s, i) => {
              const on = i === active;
              return (
                <button
                  key={s.title}
                  onClick={() => setActive(i)}
                  className={cn(
                    "w-full text-left rounded-xl border p-4 transition-all duration-300",
                    on
                      ? "bg-sidebar-accent border-accent/40"
                      : "bg-transparent border-sidebar-border hover:bg-sidebar-accent/50",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                      on ? "bg-accent text-accent-foreground" : "bg-sidebar-accent text-sidebar-foreground/70",
                    )}>{i + 1}</div>
                    <span className="font-semibold">{s.title}</span>
                  </div>
                  <div className={cn(
                    "grid transition-all duration-300",
                    on ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0",
                  )}>
                    <div className="overflow-hidden">
                      <p className="text-sm text-sidebar-foreground/75 pl-11">{s.blurb}</p>
                    </div>
                  </div>
                  {on && (
                    <div className="mt-3 h-0.5 rounded-full bg-sidebar-foreground/15 overflow-hidden">
                      <div key={active} className="step-timer h-full bg-accent"
                        style={{ animationDuration: `${STEP_MS}ms` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div key={active} className="chat-in rounded-2xl border border-sidebar-border bg-sidebar-accent/40 p-6 lg:sticky lg:top-24">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center">
                <step.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-sidebar-foreground/50">
                  Step {active + 1} of {STEPS.length}
                </p>
                <p className="font-display text-2xl leading-tight">{step.title}</p>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {step.lines.map((l, i) => (
                <div key={l} className="chat-in flex items-center gap-3 rounded-lg bg-sidebar/60 px-4 py-3 text-sm font-mono"
                  style={{ animationDelay: `${i * 110}ms` }}>
                  <Check className="h-4 w-4 shrink-0 text-success" />
                  {l}
                </div>
              ))}
            </div>

            <p className="mt-5 text-sm text-sidebar-foreground/70">{step.detail}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ features ------------------------------ */

const FEATURE_GROUPS: { group: string; blurb: string; items: { icon: typeof Package; title: string; body: string }[] }[] = [
  {
    group: "Buying",
    blurb: "Everything that comes in from your suppliers.",
    items: [
      { icon: ScanLine, title: "AI invoice reading", body: "Supplier, GSTIN, line items, HSN, batch, expiry, discounts — with per-field confidence. Free unlimited OCR engine too." },
      { icon: Users, title: "Supplier master", body: "Type the GSTIN and name, address, city, state and PIN fill themselves from the government registry. Duplicates blocked." },
      { icon: Boxes, title: "Smart product matching", body: "\"MAGGI 70G\" finds \"MAGGI NOODLES 70 GM\". Aliases and learned mappings absorb every supplier's naming quirks." },
      { icon: FileText, title: "Stock & true cost", body: "Approving a purchase posts it into stock and recalculates the product's weighted-average cost. That's what makes profit real." },
      { icon: RotateCw, title: "Re-read anything", body: "If a bill came out wrong, re-extract it in one click and edit any field by hand. Nothing is committed until you approve it." },
    ],
  },
  {
    group: "Selling",
    blurb: "Everything that goes out to your retailers.",
    items: [
      { icon: Receipt, title: "GST sales invoices", body: "Draft it, issue it, print it or save a PDF — with your bank details and authorised signature on the page." },
      { icon: ClipboardList, title: "Customer orders", body: "Upload a retailer's order file and let AI read it, or key one in. Convert to an invoice with the line items already filled." },
      { icon: Truck, title: "E-way bills", body: "Every invoice over ₹50,000 is flagged. Part A fills from the invoice, you add the vehicle, and download the NIC file — no GSP fee." },
      { icon: Undo2, title: "Returns & credit notes", body: "Pick the retailer, the invoice, the quantities coming back. Stock and ledger both correct themselves." },
      { icon: Store, title: "Retailer master", body: "Default discount, credit limit and category per retailer. GSTIN optional — plenty of your buyers are unregistered." },
    ],
  },
  {
    group: "Catalog & pricing",
    blurb: "Set it once, and every invoice gets it right.",
    items: [
      { icon: Package, title: "Product master", body: "Name, SKU, unit, GST rate, MRP, purchase rate, live stock — and HSN that auto-fills from the product name." },
      { icon: Percent, title: "Pricing rules", body: "Discounts at the stock-group level, plus per-product per-retailer overrides that take priority. No more rate arguments." },
    ],
  },
  {
    group: "Money & intelligence",
    blurb: "Know where you stand without opening a single register.",
    items: [
      { icon: IndianRupee, title: "Payments & ageing", body: "Record what came in and went out, and see receivables ageing so you chase the right retailer at the right time." },
      { icon: FileText, title: "Account statements", body: "A printable running ledger for any retailer or supplier, over any date range." },
      { icon: Sparkles, title: "Built-in AI analyst", body: "Ask your business anything in plain language and get an answer off your real data — not a guess." },
      { icon: Languages, title: "English, हिंदी, ਪੰਜਾਬੀ", body: "Your staff use the app in the language they think in. One switch at the bottom of the sidebar." },
      { icon: ShieldCheck, title: "Your team, your workspace", body: "Invite your operators with a link. Your invoices, rates and margins stay inside your workspace — no other business on Dhela can see them." },
    ],
  },
];

function Features() {
  return (
    <section id="features" className="max-w-6xl mx-auto px-6 py-24 scroll-mt-16">
      <Reveal className="text-center max-w-2xl mx-auto">
        <h2 className="font-display text-4xl md:text-5xl">Everything you get</h2>
        <p className="mt-3 text-muted-foreground">
          Not a bolt-on. The whole distribution back office, in one place, on every plan.
        </p>
      </Reveal>

      <div className="mt-14 space-y-14">
        {FEATURE_GROUPS.map(({ group, blurb, items }) => (
          <div key={group}>
            <Reveal className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b pb-3">
              <h3 className="font-display text-2xl">{group}</h3>
              <p className="text-sm text-muted-foreground">{blurb}</p>
            </Reveal>
            <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={i * 60}>
                  <div className="h-full rounded-xl border bg-card p-5 card-lift">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h4 className="mt-4 font-semibold">{title}</h4>
                    <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------- assistant spotlight ------------------------- */

const CHATS: { q: string; a: string }[] = [
  { q: "Profit on Maggi 70g last month?", a: "₹18,420 on 1,240 packets — 11.4% margin. Down from 13.1% in May because your last two purchases came in ₹1.10 dearer." },
  { q: "Who owes me more than 30 days?", a: "Four retailers, ₹2,86,500 in total. Gupta Kirana is the worst at ₹1,12,000, 47 days out." },
  { q: "मुझे e-way bill कैसे बनाना है?", a: "Sales invoice खोलिए → \"E-way bill\" दबाइए → गाड़ी नंबर भरिए → \"Download NIC JSON\"। वो file ewaybillgst.gov.in पर upload कीजिए।" },
  { q: "ਪਿਛਲੇ ਹਫ਼ਤੇ ਸਭ ਤੋਂ ਵੱਧ ਕੀ ਵਿਕਿਆ?", a: "Tata Salt 1kg — 840 packets, ₹21,000 ਦੀ ਵਿਕਰੀ। ਦੂਜੇ ਨੰਬਰ 'ਤੇ Parle-G 800g।" },
];

function AssistantSpotlight() {
  const { ref, inView } = useInView(0.25);
  const [i, setI] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  useEffect(() => {
    if (!inView) return;
    setShowAnswer(false);
    const t1 = setTimeout(() => setShowAnswer(true), 1100);
    const t2 = setTimeout(() => setI(n => (n + 1) % CHATS.length), 5600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [i, inView]);

  const chat = CHATS[i];

  return (
    <section className="relative overflow-hidden border-y bg-muted/30 py-24">
      <div className="blob h-72 w-72 top-10 -right-16 bg-accent/25" />
      <div ref={ref} className="relative max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> Included on every plan
          </div>
          <h2 className="font-display text-4xl md:text-5xl mt-5">
            An analyst who has<br />read every one of your bills.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Ask in English, Hindi or Punjabi. Every number comes off your own data — the assistant
            queries your invoices, stock, retailers and payments before it answers, and tells you
            plainly when something doesn't add up.
          </p>
          <p className="mt-4 text-muted-foreground">
            It also knows the app itself. "Where do I record a return?" gets you the page and the
            exact steps, so a new operator can find their way without calling you.
          </p>
          <ul className="mt-6 space-y-2 text-sm">
            {[
              "Answers off your real data — never an estimate",
              "Flags totals and balances that look wrong",
              "Doubles as a help desk for your staff",
            ].map(s => (
              <li key={s} className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />{s}</li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={100}>
          <div className="rounded-2xl border bg-background shadow-xl overflow-hidden">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Logo size={18} withWordmark={false} />
              <span className="text-sm font-semibold">Dhela Assistant</span>
              <span className="ml-auto text-[11px] text-muted-foreground">reading your data…</span>
            </div>
            <div className="p-4 space-y-3 min-h-[230px]">
              <div key={`q${i}`} className="chat-in flex justify-end">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3.5 py-2 text-sm max-w-[85%]">
                  {chat.q}
                </div>
              </div>
              {showAnswer ? (
                <div key={`a${i}`} className="chat-in flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm max-w-[90%]">
                    {chat.a}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-2">
                  {[0, 1, 2].map(d => (
                    <span key={d} className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground"
                      style={{ animationDelay: `${d * 160}ms` }} />
                  ))}
                </div>
              )}
            </div>
            <div className="border-t px-4 py-3 flex gap-2">
              {CHATS.map((_, n) => (
                <button key={n} onClick={() => setI(n)} aria-label={`Question ${n + 1}`}
                  className={cn("h-1.5 rounded-full transition-all",
                    n === i ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground")} />
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------- multilingual ----------------------------- */


function Multilingual() {
  const [lang, setLang] = useState(1);
  const sample = LANG_SAMPLES[lang];
  return (
    <section className="max-w-6xl mx-auto px-6 py-24 grid lg:grid-cols-2 gap-12 items-center">
      <Reveal>
        <h2 className="font-display text-4xl md:text-5xl">
          Your operator shouldn't<br />need English to do their job.
        </h2>
        <p className="mt-4 text-muted-foreground">
          The whole app — every screen, every button, every error message — runs in English, हिंदी
          or ਪੰਜਾਬੀ. One switch at the bottom of the sidebar, and it sticks for that person.
        </p>
        <p className="mt-4 text-muted-foreground">
          It's the difference between software your team tolerates and software they actually use.
        </p>
        <p className="mt-6 text-sm text-muted-foreground">Try it — tap a language:</p>
        <div className="mt-3 flex gap-2">
          {LANG_SAMPLES.map((l, i) => (
            <button key={l.code} onClick={() => setLang(i)}
              className={cn("rounded-full border px-4 py-1.5 text-sm transition-all",
                i === lang ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
              {l.label}
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal delay={100}>
        <div className="rounded-2xl bg-sidebar text-sidebar-foreground p-5 shadow-xl">
          <div className="flex items-center border-b border-sidebar-border pb-4 mb-3">
            <Logo size={26} wordmarkClassName="dhela-word-gold" />
          </div>
          {sample.rows.map((r, i) => (
            <div key={`${sample.code}-${r}`} className={cn(
              "chat-in rounded-md px-3 py-2.5 text-sm",
              i === 0 ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/80",
            )} style={{ animationDelay: `${i * 60}ms` }}>
              {r}
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* ----------------------------- comparison ----------------------------- */

const COMPARE: { label: string; dhela: boolean | string; legacy: boolean | string; manual: boolean | string }[] = [
  { label: "Reads a supplier bill for you", dhela: true, legacy: false, manual: false },
  { label: "Keeps stock and true cost", dhela: true, legacy: true, manual: false },
  { label: "GST invoices, print & PDF", dhela: true, legacy: true, manual: "By hand" },
  { label: "E-way bill file, no GSP fee", dhela: true, legacy: "Usually an add-on", manual: false },
  { label: "Receivables ageing", dhela: true, legacy: true, manual: false },
  { label: "Ask your own data a question", dhela: true, legacy: false, manual: false },
  { label: "Opens on a phone browser", dhela: true, legacy: "Varies", manual: false },
  { label: "What it costs", dhela: `${inr(3999)}–${inr(7999)} / year`, legacy: "Licence + yearly AMC", manual: "A salary" },
];

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <Check className="h-4 w-4 text-success mx-auto" />;
  if (v === false) return <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />;
  return <span className="text-xs text-muted-foreground">{v}</span>;
}

function Comparison() {
  return (
    <section className="max-w-4xl mx-auto px-6 py-24">
      <Reveal className="text-center">
        <h2 className="font-display text-4xl md:text-5xl">Why not just carry on?</h2>
        <p className="mt-3 text-muted-foreground">
          Your accounting software was never built to read a bill. A register was never built to tell you your margin.
        </p>
      </Reveal>

      <Reveal delay={80} className="mt-10">
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left font-medium px-5 py-4">&nbsp;</th>
                <th className="px-4 py-4 font-semibold text-primary">Dhela</th>
                <th className="px-4 py-4 font-medium text-muted-foreground">Accounting software</th>
                <th className="px-4 py-4 font-medium text-muted-foreground">Register / Excel</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(row => (
                <tr key={row.label} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3.5">{row.label}</td>
                  <td className="px-4 py-3.5 text-center bg-primary/[0.04]"><Cell v={row.dhela} /></td>
                  <td className="px-4 py-3.5 text-center"><Cell v={row.legacy} /></td>
                  <td className="px-4 py-3.5 text-center"><Cell v={row.manual} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
      <Reveal delay={120}>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Keep your existing books if you want to. Most distributors run Dhela for the entry and the day-to-day,
          and hand their accountant a clean set of numbers at the end of the month.
        </p>
      </Reveal>
    </section>
  );
}

/* ------------------------------- pricing ------------------------------- */

const PLAN_ORDER: PlanId[] = ["free", "standard", "pro"];

const PLAN_PITCH: Record<PlanId, { for: string; extras: string[] }> = {
  free: { for: "To see if it fits, with no conversation about money.", extras: [] },
  standard: { for: "A working distributor doing a few bills a day.", extras: ["Priority support"] },
  pro: {
    for: "Higher volume, or you want the GST checks on your parties.",
    extras: ["Priority support", "Live GSTIN lookup — auto-fill business name plus GST filer/defaulter rating"],
  },
};

function Pricing() {
  return (
    <section id="pricing" className="bg-muted/30 border-y py-24 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-6">
        <Reveal className="text-center max-w-2xl mx-auto">
          <h2 className="font-display text-4xl md:text-5xl">Priced for a distributor, not an enterprise</h2>
          <p className="mt-3 text-muted-foreground">
            AI bill reading is the only thing we meter — it's the only cost we carry. Invoices, stock,
            payments, statements, e-way bills and the free OCR engine are unlimited on every plan,
            including the free one.
          </p>
        </Reveal>

        {/* Stretch, not items-start: Pro carries an extra feature that wraps to
            two lines, so natural heights left it hanging below the others. */}
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {PLAN_ORDER.map((id, i) => {
            const p = PLANS[id];
            const pitch = PLAN_PITCH[id];
            const featured = id === "standard";
            return (
              <Reveal key={id} delay={i * 80} className="h-full">
                <div className={cn(
                  "relative flex h-full flex-col rounded-2xl border bg-card p-6 card-lift",
                  featured && "border-primary shadow-lg md:-mt-3",
                )}>
                  {featured && (
                    <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground">
                      Recommended
                    </span>
                  )}
                  <h3 className="font-display text-2xl">{p.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1 min-h-10">{pitch.for}</p>
                  <div className="mt-5">
                    <span className="font-display text-4xl">
                      {p.priceYearly ? inr(Math.round(p.priceYearly / 12)) : "₹0"}
                    </span>
                    <span className="text-sm text-muted-foreground"> / month</span>
                    <div className="text-xs text-muted-foreground mt-1">
                      {p.priceYearly ? `${inr(p.priceYearly)} billed yearly, incl. GST` : "Free forever"}
                    </div>
                  </div>
                  <ul className="mt-5 space-y-2 text-sm">
                    <li className="flex gap-2">
                      <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                      <strong>{p.aiExtractionsPerMonth} AI bill reads / month</strong>
                    </li>
                    {[
                      "Unlimited free OCR extraction",
                      "Unlimited invoices, orders & payments",
                      "E-way bills, statements & ageing",
                      "Built-in AI assistant",
                      "English, हिंदी & ਪੰਜਾਬੀ",
                      ...pitch.extras,
                    ].map(f => (
                      <li key={f} className="flex gap-2">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/auth" className="mt-auto block pt-6">
                    <Button className="w-full" variant={featured ? "default" : "outline"}>
                      {id === "free" ? "Start free" : `Start free, upgrade later`}
                    </Button>
                  </Link>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={200}>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Upgrades are a WhatsApp message and a UPI transfer — activated the same day.
            An AI bill read is one invoice, one AI-read order, or one question to the assistant.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------- faq --------------------------------- */

const FAQS: [string, string][] = [
  ["Do I have to stop using Tally?",
   "No, and most people don't. Dhela takes over the painful part — reading supplier bills, keeping stock and true cost, raising GST invoices, tracking receivables and preparing e-way bills — while your accountant carries on with the books in whatever they already use. The two run side by side: Dhela handles the day-to-day entry your staff does, and at month end you hand your CA a clean set of figures instead of a shoebox. Nothing is locked in, and nothing about your existing setup has to change on day one. Most distributors start by putting a single week of purchase bills through Dhela while everything else stays exactly where it is, then widen from there once they trust the numbers."],
  ["What if the AI reads something wrong?",
   "You review before anything is committed. Every field carries a confidence score and only the uncertain ones are flagged, so you check a handful of numbers rather than re-reading the whole bill. Dhela also cross-checks the arithmetic: if subtotal plus tax doesn't equal the grand total, or the line items don't add up to the subtotal, it says so plainly at the top of the review screen instead of letting the figures through. Nothing touches your stock or your cost until you press Approve, and you can re-extract a bill or correct any field by hand at any point. This matters most with photos of paper bills, where a crease or a shadow can lose a digit — which is exactly why the check exists."],
  ["Will it read a photo from WhatsApp?",
   "Yes — PDFs, scans and phone photos all work. Clean digital prints also work on the free OCR engine, which never counts against your AI quota. Genuinely bad handwriting is the one thing that still needs a careful review."],
  ["Is my data private?",
   "Every distributor gets an isolated workspace. Your invoices, retailers, purchase rates and margins are visible only to the people you invite into your own workspace — no other business using Dhela can see them, and there is no shared pool of pricing or supplier data between accounts. Your rates are the most commercially sensitive thing you have, and they stay yours. Access is per-person, so an operator you invite to do data entry sees the same workspace you do, and removing them removes their access immediately. Data lives in a managed Postgres database with row-level security enforced per organisation, not merely filtered in the application."],
  ["Do I need to pay to try it?",
   "No card, no call. The free plan gives you 15 AI bill reads a month plus unlimited free OCR, and every other feature is fully open on it."],
  ["Can my staff use it in Hindi or Punjabi?",
   "Yes. The entire interface switches from the bottom of the sidebar, per person, and the AI assistant answers in whichever language you ask it in."],
  ["How much does the e-way bill cost?",
   "Nothing extra. Dhela prepares the NIC bulk-upload file and you generate the EBN yourself on the government portal for free, then paste the number back in. No GSP subscription needed."],
];

function Faq() {
  return (
    <section id="faq" className="max-w-3xl mx-auto px-6 py-24 scroll-mt-16">
      <Reveal className="text-center">
        <h2 className="font-display text-4xl md:text-5xl">The questions everyone asks</h2>
      </Reveal>
      {/* <details> rather than a JS accordion: Radix unmounts collapsed content,
          so the answers never reached the server-rendered HTML and no crawler
          — or AI answer engine, none of which run JS — could see them. This is
          native, keyboard-accessible, and every answer ships in the markup. */}
      <Reveal delay={80} className="mt-10 divide-y border-t border-b">
        {FAQS.map(([q, a]) => (
          <details key={q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium marker:content-none">
              {q}
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-muted-foreground">{a}</p>
          </details>
        ))}
      </Reveal>
    </section>
  );
}

/* ------------------------------ founder CTA ----------------------------- */

function FounderCta() {
  return (
    <section className="relative overflow-hidden bg-sidebar text-sidebar-foreground py-24">
      <div className="blob h-80 w-80 -bottom-24 -left-10 bg-accent/20" />
      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <Reveal>
          <div className="flex justify-center">
            <Logo size={64} ambient withWordmark={false} />
          </div>
          <h2 className="font-display text-4xl md:text-5xl mt-6">
            Put tonight's pile of bills through it.
          </h2>
          <p className="mt-4 text-sidebar-foreground/75">
            Start on the free plan and read a real invoice in the next ten minutes.
            If it doesn't save you an evening, you've lost nothing.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/auth"><Button size="lg" className="h-12 px-8 bg-accent text-accent-foreground hover:bg-accent/90">
              Start free <ArrowRight className="h-4 w-4 ml-2" />
            </Button></Link>
            <a href={DEMO_WA} target="_blank" rel="noreferrer">
              <Button size="lg" variant="outline" className="h-12 px-6 bg-transparent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent">
                <MessageCircle className="h-4 w-4 mr-2" /> {supportPhoneDisplay()}
              </Button>
            </a>
          </div>
          <div className="mt-10 mx-auto max-w-lg rounded-2xl border border-sidebar-border bg-sidebar-accent/30 p-5 text-left">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent font-display text-xl text-accent-foreground">
                JS
              </div>
              <div className="min-w-0">
                <p className="font-medium">Jashan Sehgal</p>
                <p className="text-sm text-sidebar-foreground/60">Founder · NIT alumnus</p>
                <p className="mt-2 text-sm text-sidebar-foreground/75">
                  I built Dhela after watching distributors lose entire evenings to typing
                  purchase bills. Message me directly — you get the person who wrote the
                  software, not a ticket number.
                </p>
                <a href={LINKEDIN} target="_blank" rel="noreferrer noopener"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
                  <Linkedin className="h-4 w-4" /> Connect on LinkedIn
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------- footer -------------------------------- */

function SiteFooter() {
  return (
    <footer className="border-t py-12">
      <div className="max-w-6xl mx-auto px-6 flex flex-col items-center gap-4 text-sm text-muted-foreground">
        <Logo size={22} />
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <a href="#how" className="hover:text-foreground transition-colors">How it works</a>
          <a href="#features" className="hover:text-foreground transition-colors">Everything you get</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
          <Link to="/blog" className="hover:text-foreground transition-colors">Guides</Link>
          <Link to="/auth" className="hover:text-foreground transition-colors">Sign in</Link>
          {/* A crawlable link, not just a sameAs entry — it is what ties the
              site and the company page together as one entity. */}
          <a href={LINKEDIN_COMPANY} target="_blank" rel="noreferrer noopener"
            className="hover:text-foreground transition-colors">LinkedIn</a>
        </div>
        <p className="flex items-center gap-1.5 text-xs">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          Isolated workspace per distributor · GST-aware · full audit trail
        </p>
        <p className="text-xs">© 2026 Dhela · Jalandhar, Punjab · Built for distributors.</p>
        <p className="text-xs">
          Written by{" "}
          <a href={LINKEDIN} target="_blank" rel="noreferrer noopener"
            className="font-medium hover:text-foreground transition-colors">Jashan Sehgal</a>
          {" · "}Last updated{" "}
          <time dateTime={UPDATED}>
            {new Date(UPDATED).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
          </time>
        </p>
      </div>
    </footer>
  );
}
