import { Fragment, type ReactNode } from "react";

// A small, dependency-free Markdown renderer. Air-gapped-first: rather than pull
// a CommonMark library, we parse the subset that matters for notebook prose —
// headings, bold / italic / inline-code, links, fenced code blocks, and
// unordered / ordered lists — into React elements. Because every span of text
// becomes a React text node (never dangerouslySetInnerHTML), raw HTML in the
// source is rendered as literal text and cannot inject markup.

// renderInline turns a single line of markdown into React nodes, handling
// `code`, **bold**, *italic*, and [text](href). Tokens are matched in priority
// order; inline code wins so its contents are never re-interpreted.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;
  // Matches the earliest of: `code`, **bold**, *italic*, [text](href).
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/;
  while (rest.length > 0) {
    const m = pattern.exec(rest);
    if (!m) {
      out.push(<Fragment key={`${keyPrefix}-t${i}`}>{rest}</Fragment>);
      break;
    }
    if (m.index > 0) {
      out.push(<Fragment key={`${keyPrefix}-t${i}`}>{rest.slice(0, m.index)}</Fragment>);
      i += 1;
    }
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={`${keyPrefix}-i${i}`}>{tok.slice(1, -1)}</em>);
    } else {
      // [label](href)
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      out.push(
        <a
          key={`${keyPrefix}-a${i}`}
          href={lm[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          {lm[1]}
        </a>,
      );
    }
    i += 1;
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; text: string };

// parseBlocks splits the source into block-level nodes. A blank line separates
// paragraphs; ``` fences a code block (verbatim, no inline parsing); -/* and
// "1." start lists.
function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line.trim())) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // consume closing fence
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: h[2].trim() });
      i += 1;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph — gather consecutive non-blank, non-special lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

const HEADING_CLS: Record<number, string> = {
  1: "mt-1 mb-2 text-xl font-semibold tracking-[-0.01em] text-foreground",
  2: "mt-3 mb-1.5 text-lg font-semibold text-foreground",
  3: "mt-2.5 mb-1 text-base font-semibold text-foreground",
  4: "mt-2 mb-1 text-sm font-semibold text-foreground",
  5: "mt-2 mb-1 text-sm font-semibold text-muted-foreground",
  6: "mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
};

export function Markdown({ source }: { source: string }) {
  if (source.trim() === "") {
    return <p className="text-sm italic text-faint">Empty markdown cell.</p>;
  }
  const blocks = parseBlocks(source);
  return (
    <div className="text-sm leading-relaxed text-foreground">
      {blocks.map((b, bi) => {
        switch (b.kind) {
          case "heading": {
            const cls = HEADING_CLS[b.level] ?? HEADING_CLS[6];
            const inline = renderInline(b.text, `h${bi}`);
            if (b.level === 1) return <h1 key={bi} className={cls}>{inline}</h1>;
            if (b.level === 2) return <h2 key={bi} className={cls}>{inline}</h2>;
            if (b.level === 3) return <h3 key={bi} className={cls}>{inline}</h3>;
            if (b.level === 4) return <h4 key={bi} className={cls}>{inline}</h4>;
            if (b.level === 5) return <h5 key={bi} className={cls}>{inline}</h5>;
            return <h6 key={bi} className={cls}>{inline}</h6>;
          }
          case "code":
            return (
              <pre
                key={bi}
                className="my-2 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed text-foreground"
              >
                <code>{b.text}</code>
              </pre>
            );
          case "ul":
            return (
              <ul key={bi} className="my-2 list-disc space-y-1 pl-5">
                {b.items.map((it, ii) => (
                  <li key={ii}>{renderInline(it, `ul${bi}-${ii}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={bi} className="my-2 list-decimal space-y-1 pl-5">
                {b.items.map((it, ii) => (
                  <li key={ii}>{renderInline(it, `ol${bi}-${ii}`)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={bi} className="my-2 first:mt-0 last:mb-0">
                {renderInline(b.text, `p${bi}`)}
              </p>
            );
        }
      })}
    </div>
  );
}
