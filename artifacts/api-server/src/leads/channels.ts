/**
 * Lead channels for the `/leads` dashboard and the daily leads email. Each one
 * is one Desk search (a `channel` value, plus an optional custom-field filter)
 * and a rule that says which of the returned tickets count as leads.
 *
 * A ticket is matched against the channel it was fetched for, never looked up
 * by its Desk value: "Phone" and "Email" carry both Alice tickets and other
 * simulation requests.
 *
 * Alice leads are any ticket whose subject names Alice and a simulation, in any
 * Desk channel (Nuno, 02/11/2026). Those tickets never count in another channel.
 */
export interface ChannelDef {
  key: string;
  /** Raw value of the Desk `channel` field. Empty = any channel. */
  deskValue: string;
  label: string;
  color: string;
  /** When set, only tickets whose subject starts with this prefix count. */
  subjectPrefix?: string;
  /** When set, tickets whose subject starts with this prefix are left out. */
  excludeSubjectPrefix?: string;
  /** Desk custom-field filter for the search, as `cf_name:value`. */
  customField?: string;
  /** Desk subject filter for the search, `*` as wildcard. */
  subjectSearch?: string;
  /** When set, the subject (see `norm`) must match every one of these. */
  subjectMatches?: RegExp[];
  /** Fixed lead type for channels that only carry one kind of insurance. */
  tipoFixo?: string;
}

/**
 * The auto-triage sets "Tipo de Pedido" (`cf_negocio`) to SIMULAÇÃO when a
 * ticket is a simulation request. Agents can set it by hand too.
 */
const SIMULACAO = "cf_negocio:SIMULAÇÃO";

export const CHANNELS: ChannelDef[] = [
  { key: "SITE", deskValue: "SITE", label: "Formulários Site", color: "#762023", subjectPrefix: "SITE:" },
  { key: "BLOG", deskValue: "BLOG", label: "Blog", color: "#E87D1D" },
  { key: "LEAD_CARAVELA", deskValue: "LEAD CARAVELA", label: "Caravela Auto", color: "#2563eb" },
  { key: "LEAD_ASISA", deskValue: "LEAD -  ASISA", label: "ASISA / Simulador", color: "#7c3aed", tipoFixo: "Saúde" },
  { key: "VCVIDA", deskValue: "VCVIDA", label: "VC Vida", color: "#0891b2", tipoFixo: "Vida" },
  { key: "PARCERIAS", deskValue: "PARCERIAS", label: "Parcerias", color: "#059669" },
  // Alice (voice assistant): "Alice: Simulação - <nome>", "Alice — Simulação · …", in any channel.
  { key: "ALICE", deskValue: "", label: "Alice (assistente de voz)", color: "#db2777", subjectSearch: "*Alice*", subjectMatches: [/\bALICE\b/, /SIMULA/] },
  { key: "TELEFONE", deskValue: "Phone", label: "Telefone (simulação)", color: "#475569", customField: SIMULACAO },
  { key: "EMAIL", deskValue: "Email", label: "Email (simulação)", color: "#a16207", customField: SIMULACAO },
  // Shop counter (Rui, 02/11/2026). "Emissão AP Lusitânia" = staff's own insurance, not a lead.
  { key: "PRESENCIAL", deskValue: "PRESENCIAL", label: "Presencial (simulação)", color: "#65a30d", customField: SIMULACAO, excludeSubjectPrefix: "Emissão AP Lusitânia" },
];

/** Case- and accent-insensitive, whitespace-collapsed. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

const ALICE_WORD = /\bALICE\b/;

/**
 * True when a ticket fetched for `def` counts as a lead of that channel.
 * The Desk search already filtered by channel (and custom field); this applies
 * the subject rules, and re-checks the channel in case the search was loose.
 */
export function isLeadOf(def: ChannelDef, channel: string | null | undefined, subject: string | null | undefined): boolean {
  if (def.deskValue && (!channel || norm(channel) !== norm(def.deskValue))) return false;
  const subj = norm(subject ?? "");
  if (def.subjectMatches) return def.subjectMatches.every((re) => re.test(subj));
  if (ALICE_WORD.test(subj)) return false;
  if (def.subjectPrefix && !subj.startsWith(norm(def.subjectPrefix))) return false;
  if (def.excludeSubjectPrefix && subj.startsWith(norm(def.excludeSubjectPrefix))) return false;
  return true;
}

export const CHANNEL_BY_KEY = new Map(CHANNELS.map((c) => [c.key, c]));
