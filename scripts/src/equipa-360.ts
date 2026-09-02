/**
 * The equipa-360 roster: who gets an agent panel, and with what role.
 *
 * This list is deliberately explicit and committed to the repository rather
 * than derived. Two reasons:
 *
 *  1. `AGENT_EMAIL_MAP` only knows agents who take calls. Three members of the
 *     team are Zoho Desk users with no Ringover mapping, and deriving the
 *     roster from that variable silently excludes them — which is exactly the
 *     bug that left the panel with nobody to show.
 *  2. Membership decides who sees whose work. That is a decision a person
 *     makes and a reviewer can check in a diff, not something to infer from
 *     whoever happens to appear in an API listing.
 *
 * `email` is the join key against the Zoho Desk agent list, which supplies the
 * `zid` and the display name. `ringoverUserId` comes from `AGENT_EMAIL_MAP`
 * when present; a member with neither is still created, and the panel tells
 * them which half of their identity is missing.
 */

export interface Membro360 {
  email: string;
  papel: "agente" | "supervisor";
  /**
   * Set only when the person is NOT in `AGENT_EMAIL_MAP` and their Ringover
   * user_id is known from elsewhere. The env var wins when both exist, because
   * it is the same value `/api/followups/pending` already runs on.
   */
  ringoverUserId?: string;
}

export const EQUIPA_360: readonly Membro360[] = [
  // Supervisor — sees the team view as well as their own panel.
  { email: "joao.catalao@alfaseguros.pt", papel: "supervisor", ringoverUserId: "23335928" },

  // Agents already carrying a Ringover user_id in AGENT_EMAIL_MAP.
  { email: "vania.rodrigues@alfaseguros.pt", papel: "agente" },
  { email: "tiago.paiva@alfaseguros.pt", papel: "agente" },
  { email: "marina.fernandes@alfaseguros.pt", papel: "agente" },
  { email: "andreia.coelho@alfaseguros.pt", papel: "agente" },
  { email: "joao.martins@alfaseguros.pt", papel: "agente" },
  { email: "ana.inacio@alfaseguros.pt", papel: "agente" },

  // Confirmed as equipa 360, absent from AGENT_EMAIL_MAP. Their Ringover
  // user_ids were supplied directly and are carried here. Note 23275676 is the
  // gap in the 232756xx sequence — it was Andreia Almeida all along.
  { email: "andreia.almeida@alfaseguros.pt", papel: "agente", ringoverUserId: "23275676" },
  { email: "ruben.matos@alfaseguros.pt", papel: "agente", ringoverUserId: "23519511" },
];

/**
 * People who are NOT equipa 360 and must never be seeded. Listed by name so a
 * future reader sees each exclusion was a decision, not an oversight.
 *
 *   Soraia Silva (Ringover 23304348, 351210270878) — takes calls but is not
 *     equipa 360. Confirmed by Nuno, 2026-09-02. She has no Zoho Desk account
 *     either, so she never appeared in the Desk listing; the absence is not
 *     what excludes her, the decision is. Her answered calls therefore
 *     attribute to nobody, which is correct: a panel is for the team it
 *     belongs to.
 *
 *   Carmen Machado, Cláudia Sanches, Ricardo Barge — Desk licences held for
 *     other reasons.
 *
 *   Rui Almeida — CEO, and no Desk account.
 */
