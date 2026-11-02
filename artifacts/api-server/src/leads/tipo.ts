/**
 * Lead type = the line of insurance asked for. Rule-based on purpose: cheap,
 * deterministic, and easy to explain to the client. Anything we cannot place
 * falls into "Outros", and the dashboard shows how many did.
 */
import { norm, type ChannelDef } from "./channels.js";

export const TIPOS = ["Auto", "Habitação", "Saúde", "Vida", "Empresas", "Outros"] as const;
export type Tipo = (typeof TIPOS)[number];

// Order matters: the first rule that matches wins. "Empresas" comes before
// "Habitação" so that "Multirriscos Empresarial" is not read as a home policy.
// The regexes run on accent-free, upper-case text (see `norm`).
const RULES: Array<[Tipo, RegExp]> = [
  ["Vida", /\bVIDA\b|CREDITO (A )?HABITACAO/],
  ["Saúde", /SAUDE|DENTAL|ASISA|MEDIS|MULTICARE/],
  ["Empresas", /EMPRES|ACIDENTES DE TRABALHO|RECIBOS VERDES|RESPONSABILIDADE CIVIL|\bRC\b|OBRAS|MONTAGENS|FROTA|\bAT\b|SEGURO DE TRABALHO/],
  ["Auto", /\bAUTO|VIATURA|\bCARRO|\bMOTA\b|MOTOCICLO|TVDE|MATRICULA/],
  ["Habitação", /HABITACAO|MULTI ?RRISCO|MULTI RISCO|\bCASA\b|CONDOMINIO|RECHEIO|\bMRH?\b/],
];

export function classifyTipo(def: ChannelDef, subject: string | null | undefined, productName?: string | null): Tipo {
  if (def.tipoFixo && (TIPOS as readonly string[]).includes(def.tipoFixo)) return def.tipoFixo as Tipo;
  const text = norm(`${subject ?? ""} ${productName ?? ""}`);
  for (const [tipo, re] of RULES) if (re.test(text)) return tipo;
  return "Outros";
}
