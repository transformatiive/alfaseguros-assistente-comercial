/**
 * Lead channels for the `/leads` dashboard and the daily leads email. Each one
 * is one Desk search (a `channel` value, plus an optional custom-field filter)
 * and a rule that says which of the returned tickets count as leads.
 *
 * Two Desk channels feed more than one lead channel: "Phone" carries both the
 * Alice tickets and the phone simulation requests. So a ticket is matched
 * against the channel it was fetched for, never looked up by its Desk value.
 */
export interface ChannelDef {
  key: string;
  /** Raw value of the Desk `channel` field. */
  deskValue: string;
  label: string;
  color: string;
  /** When set, only tickets whose subject starts with this prefix count. */
  subjectPrefix?: string;
  /** When set, tickets whose subject starts with this prefix are left out. */
  excludeSubjectPrefix?: string;
  /** Desk custom-field filter for the search, as `cf_name:value`. */
  customField?: string;
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
  // Alice (voice assistant) tickets: "Alice: <Pedido> - <nome>". Only simulations are leads.
  { key: "ALICE", deskValue: "Phone", label: "Alice (assistente de voz)", color: "#db2777", subjectPrefix: "Alice: Simulação" },
  { key: "TELEFONE", deskValue: "Phone", label: "Telefone (simulação)", color: "#475569", customField: SIMULACAO, excludeSubjectPrefix: "Alice:" },
  { key: "EMAIL", deskValue: "Email", label: "Email (simulação)", color: "#a16207", customField: SIMULACAO },
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

/**
 * True when a ticket fetched for `def` counts as a lead of that channel.
 * The Desk search already filtered by channel (and custom field); this applies
 * the subject rules, and re-checks the channel in case the search was loose.
 */
export function isLeadOf(def: ChannelDef, channel: string | null | undefined, subject: string | null | undefined): boolean {
  if (!channel || norm(channel) !== norm(def.deskValue)) return false;
  const subj = norm(subject ?? "");
  if (def.subjectPrefix && !subj.startsWith(norm(def.subjectPrefix))) return false;
  if (def.excludeSubjectPrefix && subj.startsWith(norm(def.excludeSubjectPrefix))) return false;
  return true;
}

export const CHANNEL_BY_KEY = new Map(CHANNELS.map((c) => [c.key, c]));
