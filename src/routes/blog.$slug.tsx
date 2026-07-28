import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { bySlug, POSTS, type Post } from "@/lib/blog-data";
import { BlogHeader, BlogFooter } from "@/components/blog-chrome";

const LINKEDIN = "https://www.linkedin.com/in/jashan-sehgal-b11a19226/";

/**
 * BlogPosting with a named author and both dates. Freshness and a real byline
 * are the two E-E-A-T signals that actually move citation rates, and neither
 * can be inferred from the prose.
 */
function structuredData(p: Post) {
  const url = `https://dhela.in/blog/${p.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    headline: p.title,
    description: p.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: p.published,
    dateModified: p.updated,
    wordCount: p.words,
    inLanguage: "en-IN",
    keywords: p.tags.join(", "),
    isPartOf: { "@id": "https://dhela.in/blog#blog" },
    publisher: { "@id": "https://dhela.in/#organization" },
    author: {
      "@type": "Person",
      "@id": "https://dhela.in/#founder",
      name: "Jashan Sehgal",
      url: LINKEDIN,
      jobTitle: "Founder",
    },
  };
}

export const Route = createFileRoute("/blog/$slug")({
  // Resolved in the loader so a bad slug 404s on the server rather than
  // rendering an empty shell that still returns 200 to a crawler.
  loader: ({ params }) => {
    const post = bySlug(params.slug);
    if (!post) throw notFound();
    return post;
  },
  head: ({ loaderData }) => {
    const p = loaderData;
    if (!p) return {};
    const url = `https://dhela.in/blog/${p.slug}`;
    return {
      meta: [
        { title: `${p.title} · Dhela` },
        { name: "description", content: p.description },
        { name: "author", content: "Jashan Sehgal" },
        { property: "og:title", content: p.title },
        { property: "og:description", content: p.description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "article:published_time", content: p.published },
        { property: "article:modified_time", content: p.updated },
        { property: "article:author", content: "Jashan Sehgal" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: p.title },
        { name: "twitter:description", content: p.description },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{ type: "application/ld+json", children: JSON.stringify(structuredData(p)) }],
    };
  },
  component: Article,
});

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

function Article() {
  const p = Route.useLoaderData();
  const others = POSTS.filter(o => o.slug !== p.slug).slice(0, 2);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BlogHeader />
      <main className="max-w-3xl mx-auto px-6 pt-12">
        <Link to="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← All guides
        </Link>

        <article className="mt-6">
          <h1 className="font-display text-4xl md:text-5xl leading-[1.12]">{p.title}</h1>

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>
              By{" "}
              <a href={LINKEDIN} target="_blank" rel="noreferrer noopener"
                className="font-medium text-foreground hover:text-primary transition-colors">
                Jashan Sehgal
              </a>
            </span>
            <span aria-hidden>·</span>
            <time dateTime={p.published}>{fmt(p.published)}</time>
            {p.updated !== p.published && (
              <>
                <span aria-hidden>·</span>
                <span>Updated <time dateTime={p.updated}>{fmt(p.updated)}</time></span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{p.minutes} min read</span>
          </div>

          {p.toc.length > 2 && (
            <nav aria-label="On this page"
              className="mt-8 rounded-xl border bg-muted/40 p-5 text-sm">
              <p className="font-medium mb-2">On this page</p>
              <ul className="space-y-1.5">
                {p.toc.map(t => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="text-muted-foreground hover:text-primary transition-colors">
                      {t.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {/* Rendered from our own markdown at build time — no user input reaches
              this, and the alternative is shipping a parser to every visitor. */}
          <div className="prose mt-10" dangerouslySetInnerHTML={{ __html: p.html }} />
        </article>

        <aside className="mt-16 rounded-2xl border bg-card p-6">
          <p className="font-display text-2xl">Stop typing supplier bills</p>
          <p className="mt-2 text-muted-foreground">
            Dhela reads them instead — stock and true weighted-average cost update themselves,
            and GST working papers come out the other side. Free plan, no card.
          </p>
          <Link to="/auth"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
            Start free
          </Link>
        </aside>

        {others.length > 0 && (
          <section className="mt-14">
            <h2 className="font-display text-2xl">Read next</h2>
            <ul className="mt-4 space-y-2">
              {others.map(o => (
                <li key={o.slug}>
                  <Link to="/blog/$slug" params={{ slug: o.slug }}
                    className="group block rounded-xl border bg-card p-5 transition-colors hover:border-primary/50">
                    <p className="font-medium group-hover:text-primary transition-colors">{o.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{o.description}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <BlogFooter />
    </div>
  );
}
