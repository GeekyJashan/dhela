import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";

/**
 * Header and footer for the blog. Deliberately lighter than the landing page's
 * — an article should get out of the way of the article — but it keeps the
 * route back to the product, which is the only reason the blog exists.
 */
export function BlogHeader() {
  return (
    <header className="border-b bg-background/85 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-3xl mx-auto flex items-center justify-between px-6 h-16">
        <Link to="/" aria-label="Dhela home"><Logo size={28} /></Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link to="/blog" className="hover:text-foreground transition-colors">Guides</Link>
          <Link to="/" hash="pricing" className="hover:text-foreground transition-colors">Pricing</Link>
          <Link to="/auth"
            className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:opacity-90 transition-opacity">
            Start free
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function BlogFooter() {
  return (
    <footer className="border-t mt-20 py-12">
      <div className="max-w-3xl mx-auto px-6 text-sm text-muted-foreground space-y-3">
        <p>
          <strong className="font-medium text-foreground">Dhela</strong> is invoice and inventory
          software for Indian distributors. AI reads every supplier bill, updates stock and true
          weighted-average cost, raises GST invoices and prepares e-way bills and GSTR-1 working
          papers. English, हिंदी and ਪੰਜਾਬੀ. Free plan, no card.
        </p>
        <p className="flex flex-wrap gap-x-5 gap-y-1">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <Link to="/blog" className="hover:text-foreground transition-colors">All guides</Link>
          <a href="https://www.linkedin.com/company/dhelaa/" target="_blank" rel="noreferrer noopener"
            className="hover:text-foreground transition-colors">LinkedIn</a>
        </p>
        <p className="text-xs">© 2026 Dhela · Jalandhar, Punjab · dhela.in</p>
      </div>
    </footer>
  );
}
