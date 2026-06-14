"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/utils/cn";

/** Normalize common model / copy-paste variants to ASCII markdown. */
function normalizeMarkdownSource(text: string): string {
  return (
    text
      .replace(/\uFF0A/g, "*")
      .replace(/\u2217/g, "*")
      .replace(/\uFE61/g, "*")
      .replace(/\\([*_`])/g, "$1")
      // ****bold**** or ***bold*** → **bold**
      .replace(/\*{3,4}([^*]+?)\*{3,4}/g, "**$1**")
  );
}

type InlinePattern = {
  re: RegExp;
  render: (match: RegExpExecArray, key: string) => ReactNode;
};

const INLINE_PATTERNS: InlinePattern[] = [
  {
    re: /\*\*(.+?)\*\*/g,
    render: (m, key) => (
      <strong key={key} className="font-semibold text-slate-900">
        {m[1]}
      </strong>
    ),
  },
  {
    re: /__(.+?)__/g,
    render: (m, key) => (
      <strong key={key} className="font-semibold text-slate-900">
        {m[1]}
      </strong>
    ),
  },
  {
    re: /`([^`\n]+)`/g,
    render: (m, key) => (
      <code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] font-mono text-slate-800">
        {m[1]}
      </code>
    ),
  },
  {
    re: /(?<!\*)\*([^*\n]+?)\*(?!\*)/g,
    render: (m, key) => (
      <em key={key} className="italic text-slate-800">
        {m[1]}
      </em>
    ),
  },
];

function inlineFormat(text: string, keyPrefix: string): ReactNode[] {
  const source = normalizeMarkdownSource(text);
  const nodes: ReactNode[] = [];
  let remaining = source;
  let i = 0;

  while (remaining.length > 0) {
    let best: { index: number; length: number; node: ReactNode } | null = null;

    for (const pattern of INLINE_PATTERNS) {
      pattern.re.lastIndex = 0;
      const m = pattern.re.exec(remaining);
      if (!m || m.index === undefined) continue;
      if (!best || m.index < best.index) {
        best = {
          index: m.index,
          length: m[0].length,
          node: pattern.render(m, `${keyPrefix}-${i}`),
        };
      }
    }

    if (!best) {
      nodes.push(remaining);
      break;
    }

    if (best.index > 0) nodes.push(remaining.slice(0, best.index));
    nodes.push(best.node);
    remaining = remaining.slice(best.index + best.length);
    i += 1;
  }

  return nodes.length ? nodes : [text];
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "h"; level: 1 | 2 | 3; text: string };

function parseBlocks(source: string): Block[] {
  const lines = normalizeMarkdownSource(source).replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "h",
        level: Math.min(heading[1].length, 3) as 1 | 2 | 3,
        text: heading[2],
      });
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = (lines[i] ?? "").trim();
      if (!next || /^(#{1,3})\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next)) break;
      para.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ kind: "p", lines: para });
  }

  return blocks;
}

export function ChatMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!text.trim()) return null;

  const blocks = parseBlocks(text);

  return (
    <div className={cn("space-y-2.5 text-sm leading-relaxed text-slate-800", className)}>
      {blocks.map((block, bi) => {
        if (block.kind === "h") {
          const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
          return (
            <Tag
              key={bi}
              className={cn(
                "font-semibold text-slate-900",
                block.level === 1 && "text-base mt-1",
                block.level === 2 && "text-sm mt-0.5",
                block.level === 3 && "text-sm",
              )}
            >
              {inlineFormat(block.text, `h-${bi}`)}
            </Tag>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={bi} className="list-disc pl-5 space-y-1 marker:text-slate-400">
              {block.items.map((item, ii) => (
                <li key={ii}>{inlineFormat(item, `ul-${bi}-${ii}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={bi} className="list-decimal pl-5 space-y-1 marker:text-slate-500">
              {block.items.map((item, ii) => (
                <li key={ii}>{inlineFormat(item, `ol-${bi}-${ii}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {block.lines.map((ln, li) => (
              <Fragment key={li}>
                {li > 0 ? <br /> : null}
                {inlineFormat(ln, `p-${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
