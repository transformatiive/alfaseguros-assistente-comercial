/**
 * Team classification for Alfaseguros operators.
 *
 * - 360  — Equipa Não Vida; integra com Zoho Desk; follow-ups têm desk_url
 * - vida — Equipa Vida/Previdência; sem Zoho Desk; follow-ups sem link
 *
 * Corporate é tratado fora do Replit (n8n ↔ Zoho Desk) — não classificado aqui.
 */

export type TeamId = "360" | "vida";

/** Strip accents, lowercase, collapse internal whitespace. */
export function normalizeOperatorName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const TEAM_360_NORMALIZED = new Set([
  "andreia almeida",
  "andreia coelho",
  "vania rodrigues",
  "marina fernandes",
  "joao martins",
  "joao catalao",
  "tiago paiva",
  "ana inacio",
]);

/**
 * Classify an operator by team.
 * Unknown / null operators default to "vida" (safe fallback).
 */
export function getTeam(operatorName: string | null | undefined): TeamId {
  if (!operatorName) return "vida";
  return TEAM_360_NORMALIZED.has(normalizeOperatorName(operatorName)) ? "360" : "vida";
}
