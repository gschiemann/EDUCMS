import React, { ReactNode } from 'react';

// Minimal, safe-enough markdown-to-JSX renderer for our help articles.
// Supports: headings (#..######), paragraphs, unordered/ordered lists,
// inline code `x`, bold **x**, italic *x*, links [label](url), fenced
// code blocks ```lang ... ```, and GFM-style tables (| a | b |).
// We own the content so no user-supplied HTML / XSS surface.

type Token =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lang: string; body: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'hr' };

function tokenize(src: string): Token[] {
  const lines = src.split(/\r?\n/);
  const tokens: Token[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Code fence
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      tokens.push({ kind: 'code', lang, body: body.join('\n') });
      continue;
    }
    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      tokens.push({ kind: 'h', level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }
    // HR
    if (/^-{3,}$/.test(line.trim())) {
      tokens.push({ kind: 'hr' });
      i++;
      continue;
    }
    // Table
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      tokens.push({ kind: 'table', header, rows });
      continue;
    }
    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      tokens.push({ kind: 'ul', items });
      continue;
    }
    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      tokens.push({ kind: 'ol', items });
      continue;
    }
    // Paragraph — slurp consecutive non-empty lines
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    tokens.push({ kind: 'p', text: para.join(' ') });
  }
  return tokens;
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('#') ||
    line.startsWith('```') ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^-{3,}$/.test(line.trim()) ||
    /^\|.*\|$/.test(line)
  );
}

function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((s) => s.trim());
}

// Inline formatting: code, bold, italic, link.
function renderInline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  // Regex handles: `code`, **bold**, *italic*, [label](url)
  const re = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${k++}`;
    if (m[2] != null) {
      out.push(<code key={key} className="rounded bg-slate-100 text-slate-800 px-1.5 py-0.5 text-[0.875em] font-mono">{m[2]}</code>);
    } else if (m[4] != null) {
      out.push(<strong key={key} className="font-semibold text-slate-900">{m[4]}</strong>);
    } else if (m[6] != null) {
      out.push(<em key={key}>{m[6]}</em>);
    } else if (m[8] != null) {
      const href = m[9];
      const isExternal = /^https?:/.test(href);
      out.push(
        <a
          key={key}
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          className="text-indigo-600 hover:text-indigo-500 underline underline-offset-2"
        >
          {m[8]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const tokens = tokenize(source);
  return (
    <div className="space-y-5 text-slate-700 leading-relaxed">
      {tokens.map((tok, idx) => {
        switch (tok.kind) {
          case 'h': {
            const text = renderInline(tok.text, `h-${idx}`);
            // Plain font-semibold instead of font-[family-name:var(--font-fredoka)].
            // Fredoka is only loaded inside the printable guide route via
            // next/font; outside that route the var resolves to nothing and
            // headings rendered with no font-family at all (the symptom
            // Integration Lead saw as "half the text is transparent" inside
            // the in-app help drawer).
            const common = 'font-semibold text-slate-900 tracking-tight';
            if (tok.level === 1) return <h1 key={idx} className={`${common} text-3xl md:text-4xl mt-2`}>{text}</h1>;
            if (tok.level === 2) return <h2 key={idx} className={`${common} text-2xl md:text-3xl mt-10`}>{text}</h2>;
            if (tok.level === 3) return <h3 key={idx} className={`${common} text-xl md:text-2xl mt-8`}>{text}</h3>;
            return <h4 key={idx} className={`${common} text-lg mt-6`}>{text}</h4>;
          }
          case 'p':
            return <p key={idx} className="text-base">{renderInline(tok.text, `p-${idx}`)}</p>;
          case 'ul':
            return (
              <ul key={idx} className="list-disc pl-6 space-y-2">
                {tok.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `ul-${idx}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx} className="list-decimal pl-6 space-y-2">
                {tok.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `ol-${idx}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'code':
            return (
              <pre key={idx} className="rounded-2xl bg-slate-900 text-slate-100 p-5 overflow-x-auto text-xs font-mono leading-relaxed">
                <code>{tok.body}</code>
              </pre>
            );
          case 'hr':
            return <hr key={idx} className="border-slate-200" />;
          case 'table':
            return (
              <div key={idx} className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {tok.header.map((h, j) => (
                        <th key={j} className="px-4 py-3 text-left font-semibold text-slate-700">
                          {renderInline(h, `th-${idx}-${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tok.rows.map((row, j) => (
                      <tr key={j} className="border-t border-slate-200">
                        {row.map((c, k) => (
                          <td key={k} className="px-4 py-3 align-top">
                            {renderInline(c, `td-${idx}-${j}-${k}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
