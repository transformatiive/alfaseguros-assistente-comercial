import { Link } from "wouter";

type Segment =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "conv-link"; id: number; label: string };

const RICH_PATTERN = /\*\*(.+?)\*\*|(?:conv(?:ersa)?\.?\s*)(\d+)/gi;

export function parseRichText(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  RICH_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = RICH_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ type: "bold", content: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ type: "conv-link", id: Number(match[2]), label: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments;
}

interface RichTextProps {
  text: string;
  className?: string;
}

export function RichText({ text, className }: RichTextProps) {
  const segments = parseRichText(text);
  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === "bold") {
          return <strong key={i} className="font-semibold">{seg.content}</strong>;
        }
        if (seg.type === "conv-link") {
          return (
            <Link
              key={i}
              href={`/conversas/${seg.id}`}
              className="font-medium underline underline-offset-2 decoration-dotted hover:decoration-solid transition-all"
            >
              {seg.label}
            </Link>
          );
        }
        return <span key={i}>{seg.content}</span>;
      })}
    </span>
  );
}
