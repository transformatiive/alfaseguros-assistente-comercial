import { Link } from "wouter";

type Segment =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "conv-link"; id: number; label: string };

/**
 * Converts "conversa(s) N" and "conversas N, M e P" patterns into conv-link segments,
 * preserving surrounding text and separators.
 *
 * Examples matched:
 *   "conversa 60"          → [conv-link(60)]
 *   "conversas 19, 77 e 78" → [text("conversas "), conv-link(19), text(", "), conv-link(77), text(" e "), conv-link(78)]
 *   "conv. 5"              → [conv-link(5)]
 */
const CONV_RE = /\bconversas?\.?\s+(\d+(?:\s*[,e]\s*\d+)*)/gi;

function processConvLinks(text: string): Segment[] {
  const segments: Segment[] = [];
  CONV_RE.lastIndex = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = CONV_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, m.index) });
    }
    // Split the full match by digit groups to get alternating text / number parts.
    // e.g. "conversas 19, 77 e 78".split(/(\d+)/) = ["conversas ", "19", ", ", "77", " e ", "78", ""]
    const parts = m[0].split(/(\d+)/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (i % 2 === 1) {
        segments.push({ type: "conv-link", id: parseInt(part, 10), label: part });
      } else {
        segments.push({ type: "text", content: part });
      }
    }
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments;
}

/**
 * Two-pass parser:
 *  1. Split on **bold** markers.
 *  2. Within each text run, detect conversa links.
 */
export function parseRichText(text: string): Segment[] {
  const segments: Segment[] = [];
  const boldRe = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push(...processConvLinks(text.slice(lastIndex, m.index)));
    }
    segments.push({ type: "bold", content: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push(...processConvLinks(text.slice(lastIndex)));
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
              conversa {seg.id}
            </Link>
          );
        }
        return <span key={i}>{seg.content}</span>;
      })}
    </span>
  );
}
