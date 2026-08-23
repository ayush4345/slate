import type { ReactNode } from "react";

/**
 * A small markdown renderer for agent answers.
 *
 * Builds React elements rather than HTML, so model output can never inject
 * markup. It covers what the models actually emit here: headings, bullet and
 * numbered lists with one level of nesting, bold, italic, inline code, and
 * links.
 *
 * ponytail: deliberately not a full parser. No tables, block quotes, images, or
 * fenced code. Reach for a real markdown library if answers start using them.
 */

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("__") && part.endsWith("__")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

interface Item {
  text: string;
  depth: number;
  children: Item[];
}

/** Group `- a` / `  - b` lines into one level of nesting. */
function nest(lines: { text: string; depth: number }[]): Item[] {
  const roots: Item[] = [];
  for (const line of lines) {
    const item: Item = { text: line.text, depth: line.depth, children: [] };
    const parent = line.depth > 0 ? roots[roots.length - 1] : undefined;
    if (parent) parent.children.push(item);
    else roots.push(item);
  }
  return roots;
}

function List({ items, ordered, k }: { items: Item[]; ordered: boolean; k: string }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag>
      {items.map((item, i) => (
        <li key={`${k}-${i}`}>
          {inline(item.text, `${k}-${i}`)}
          {item.children.length > 0 && (
            <List items={item.children} ordered={false} k={`${k}-${i}-c`} />
          )}
        </li>
      ))}
    </Tag>
  );
}

export default function Markdown({ children }: { children: string }) {
  const blocks: ReactNode[] = [];
  const lines = children.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1]!.length + 2, 6);
      const Tag = `h${level}` as "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={key++}>{inline(heading[2]!, `h${key}`)}</Tag>);
      i += 1;
      continue;
    }

    const bullet = /^(\s*)[-*]\s+(.*)$/;
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/;
    const isList = bullet.test(line) || numbered.test(line);
    if (isList) {
      const ordered = numbered.test(line);
      const collected: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const match = bullet.exec(lines[i]!) ?? numbered.exec(lines[i]!);
        if (!match) break;
        collected.push({ text: match[2]!, depth: match[1]!.length >= 2 ? 1 : 0 });
        i += 1;
      }
      blocks.push(<List key={key++} items={nest(collected)} ordered={ordered} k={`l${key}`} />);
      continue;
    }

    // Everything else is a paragraph: consecutive plain lines join with a break.
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,4})\s|^\s*[-*]\s|^\s*\d+[.)]\s/.test(lines[i]!)) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    blocks.push(<p key={key++}>{inline(paragraph.join(" "), `p${key}`)}</p>);
  }

  return <div className="md">{blocks}</div>;
}
