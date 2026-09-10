/**
 * Minimal, safe Markdown renderer for discussion posts.
 * Supports: **bold**, *italic*, `code`, fenced ```code```, > quotes,
 * - / 1. lists, and paragraphs. No raw HTML is ever injected.
 */
import { Fragment } from 'react';

function renderInline(text, keyBase) {
  // Split on inline code first so markup inside code is preserved verbatim.
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code
          key={key}
          className="rounded bg-paper-sunk px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const withMarks = [];
    let rest = part;
    let idx = 0;
    const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/;
    let m;
    while ((m = re.exec(rest))) {
      if (m.index > 0) withMarks.push(<Fragment key={`${key}-t${idx++}`}>{rest.slice(0, m.index)}</Fragment>);
      if (m[2] != null) withMarks.push(<strong key={`${key}-b${idx++}`}>{m[2]}</strong>);
      else withMarks.push(<em key={`${key}-i${idx++}`}>{m[3]}</em>);
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) withMarks.push(<Fragment key={`${key}-t${idx++}`}>{rest}</Fragment>);
    return <Fragment key={key}>{withMarks}</Fragment>;
  });
}

export default function Markdown({ source = '', className = '' }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++;
      blocks.push(
        <pre
          key={`pre-${blocks.length}`}
          dir="ltr"
          className="overflow-x-auto rounded-lg bg-paper-sunk p-3 font-mono text-xs leading-relaxed dark:bg-white/5"
        >
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (line.trim().startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={`q-${blocks.length}`}
          className="border-s-2 border-moss ps-3 text-ink-soft dark:text-paper/70"
        >
          {renderInline(buf.join(' '), `q${blocks.length}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag
          key={`l-${blocks.length}`}
          className={`space-y-1 ps-5 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-moss`}
        >
          {items.map((it, k) => (
            <li key={k}>{renderInline(it, `l${blocks.length}-${k}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*([-*>]|\d+\.|```)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="leading-relaxed">
        {renderInline(buf.join(' '), `p${blocks.length}`)}
      </p>,
    );
  }

  return <div className={`space-y-2 text-sm ${className}`}>{blocks}</div>;
}
