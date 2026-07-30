import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small markdown renderer for assistant answers.
 *
 * It builds React elements rather than HTML, so nothing the model writes can
 * become markup. That matters more than it looks: answers quote the user's own
 * product, retailer and supplier names straight out of the database, and this
 * codebase has already seen a GSTIN stored as "</DIALOGCONTENT>". Rendering
 * model output through dangerouslySetInnerHTML would make that a live
 * injection path. A full parser plus a sanitiser is also ~30 KB shipped to
 * every authenticated page for bold, bullets and the occasional table.
 *
 * Covers what the assistant actually emits: **bold**, *italic*, `code`,
 * "-"/"*"/"•" bullets, numbered lists, pipe tables and ATX headings.
 */

// Ordered by precedence: bold before italic, so ** never matches as two *.
const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|(?:^|\s)_([^_\n]+)_|`([^`]+)`/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  while ((m = INLINE.exec(text)) !== null) {
    // _italic_ only counts at a word boundary, so the match may start one
    // space early — keep that space as plain text.
    const lead = m[0].startsWith(" ") ? 1 : 0;
    if (m.index + lead > last) out.push(text.slice(last, m.index + lead));
    const k = `${keyPrefix}-${m.index}`;

    if (m[1] ?? m[2]) out.push(<strong key={k} className="font-semibold">{m[1] ?? m[2]}</strong>);
    else if (m[3] ?? m[4]) out.push(<em key={k}>{m[3] ?? m[4]}</em>);
    else out.push(<code key={k} className="rounded bg-background/70 px-1 py-0.5 text-[0.85em]">{m[5]}</code>);

    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());

const isDivider = (row: string) => /^\s*\|?[\s:-]*-[\s|:-]*$/.test(row) && row.includes("-");

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Table: a pipe row followed by a |---|---| divider.
    if (line.includes("|") && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i++;
      }
      blocks.push(
        // Tables get wide fast in a 380px panel — scroll the table, never the
        // conversation.
        <div key={`t${i}`} className="-mx-1 overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                {head.map((h, c) => (
                  <th key={c} className={`py-1 pr-3 font-semibold ${c ? "text-right" : "text-left"}`}>
                    {inline(h, `h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/40 last:border-0">
                  {r.map((cell, c) => (
                    <td key={c} className={`py-1 pr-3 align-top ${c ? "text-right tabular-nums" : "text-left"}`}>
                      {inline(cell, `${ri}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Bullets. "•" is in here because answers stored before this renderer
    // existed were written with it — the prompt used to demand it.
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`u${i}`} className="list-disc pl-4 space-y-0.5">
          {items.map((it, n) => <li key={n}>{inline(it, `u${n}`)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`o${i}`} className="list-decimal pl-4 space-y-0.5">
          {items.map((it, n) => <li key={n}>{inline(it, `o${n}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // Headings render as emphasised lines — an <h2> inside a chat bubble is
    // out of scale with everything around it.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<p key={`h${i}`} className="font-semibold">{inline(h[2], `h${i}`)}</p>);
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(<hr key={`r${i}`} className="border-border/60" />);
      i++;
      continue;
    }

    // Paragraph: consecutive plain lines, single newlines preserved.
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isDivider(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p${i}`}>
        {para.map((l, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(l, `p${n}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="space-y-2">{blocks}</div>;
}
