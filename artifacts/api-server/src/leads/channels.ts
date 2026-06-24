/**
 * Lead channels for the `/leads` dashboard. Each maps a Zoho Desk `channel`
 * value to a display label + brand colour. The SITE channel has an extra rule:
 * only tickets whose subject starts with "SITE:" count (the others are noise).
 */
export interface ChannelDef {
  key: string;
  /** Raw value of the Desk `channel` field. */
  deskValue: string;
  label: string;
  color: string;
  /** When true, only tickets whose subject starts with "SITE:" are included. */
  subjectPrefix?: string;
}

export const CHANNELS: ChannelDef[] = [
  { key: "SITE", deskValue: "SITE", label: "Formulários Site", color: "#762023", subjectPrefix: "SITE:" },
  { key: "BLOG", deskValue: "BLOG", label: "Blog", color: "#E87D1D" },
  { key: "LEAD_CARAVELA", deskValue: "LEAD CARAVELA", label: "Caravela Auto", color: "#2563eb" },
  { key: "LEAD_ASISA", deskValue: "LEAD -  ASISA", label: "ASISA / Simulador", color: "#7c3aed" },
  { key: "VCVIDA", deskValue: "VCVIDA", label: "VC Vida", color: "#0891b2" },
  { key: "PARCERIAS", deskValue: "PARCERIAS", label: "Parcerias", color: "#059669" },
];

/** Collapse whitespace + uppercase so "LEAD -  ASISA" matches regardless of spacing. */
function norm(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

const BY_NORM_VALUE = new Map(CHANNELS.map((c) => [norm(c.deskValue), c]));

/**
 * Resolve a ticket (by channel + subject) to a lead channel, or null when it is
 * not a lead. Applies the SITE subject-prefix rule.
 */
export function matchChannel(channel: string | null | undefined, subject: string | null | undefined): ChannelDef | null {
  if (!channel) return null;
  const def = BY_NORM_VALUE.get(norm(channel));
  if (!def) return null;
  if (def.subjectPrefix) {
    const subj = (subject ?? "").trim().toUpperCase();
    if (!subj.startsWith(def.subjectPrefix.toUpperCase())) return null;
  }
  return def;
}
