/** One lead, from a Zoho Desk ticket or, for the CRM-owned channels, a Zoho CRM lead. */
export interface LeadRow {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  channelKey: string;
  channelLabel: string;
  channelColor: string;
  createdTime: string; // raw ISO from Desk
  day: string; // YYYY-MM-DD in Europe/Lisbon
  /** Line of insurance (see tipo.ts). */
  tipo: string;
  /** Desk agent id of the current owner, or null when nobody has it. */
  assigneeId: string | null;
  /** Display name of the current owner; "Sem responsável" when nobody has it. */
  assigneeName: string;
  /** True while the ticket is not closed (Supervisor Virtual's copy first, Desk second). */
  aberto: boolean;
  /** Link to the record when it is not a Desk ticket (CRM leads). */
  url?: string;
}

/** Resolved period for the dashboard (inclusive, YYYY-MM-DD, Lisbon days). */
export interface Period {
  from: string;
  to: string;
  days: number;
  /** Equivalent immediately-preceding period (same length). */
  prevFrom: string;
  prevTo: string;
  preset: string; // "hoje" | "7d" | "30d" | "90d" | "custom"
}
