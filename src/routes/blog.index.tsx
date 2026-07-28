import { createFileRoute, Link } from "@tanstack/react-router";
import { POSTS } from "@/lib/blog-data";
import { BlogHeader, BlogFooter } from "@/components/blog-chrome";

const TITLE = "Guides for Indian distributors — GST, e-way bills and stock";
const DESC =
  "Practical guides on GSTR-1, e-way bills, stock and costing, written for FMCG, "
  + "pharma, hardware and general distributors in India.";

/**
 * Blog schema lists the articles so a crawler landing here learns the whole set
 * from one fetch, rather than having to follow every link to find out.
 */
function structuredData() {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": "https://dhela.in/blog#blog",
    name: TITLE,
    description: DESC,
    url: "https://dhela.in/blog",
    publisher: { "@id": "https://dhela.in/#organization" },
    blogPost: POSTS.map(p => ({
      "@type": "BlogPosting",
      headline: p.title,
      description: p.description,
      url: `https://dhela.in/blog/${p.slug}`,
      datePublished: p.published,
      dateModified: p.updated,
      author: { "@type": "Person", name: "Jashan Sehgal" },
    })),
  };
}

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: `${TITLE} · Dhela` },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://dhela.in/blog" },
    ],
    links: [{ rel: "canonical", href: "https://dhela.in/blog" }],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(structuredData()) }],
  }),
  component: BlogIndex,
});

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

function BlogIndex() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BlogHeader />
      <main className="max-w-3xl mx-auto px-6 pt-14 pb-4">
        <h1 className="font-display text-4xl md:text-5xl leading-tight">
          Guides for Indian distributors
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          GST, e-way bills, stock and costing — the parts that actually catch people out,
          written by the person who builds the software.
        </p>

        <ul className="mt-12 space-y-2">
          {POSTS.map(p => (
            <li key={p.slug}>
              <Link to="/blog/$slug" params={{ slug: p.slug }}
                className="group block rounded-2xl border bg-card p-6 transition-colors hover:border-primary/50">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <time dateTime={p.published}>{fmt(p.published)}</time>
                  <span aria-hidden>·</span>
                  <span>{p.minutes} min read</span>
                </div>
                <h2 className="font-display text-2xl mt-2 group-hover:text-primary transition-colors">
                  {p.title}
                </h2>
                <p className="mt-2 text-muted-foreground">{p.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <BlogFooter />
    </div>
  );
}
