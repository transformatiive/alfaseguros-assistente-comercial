import { converterChamadaPortal, exportPortalSchema } from "../chamadas-sftp/importar-portal.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { guardarDestaques, haDestaques, importarChamadaPortal } from "../storage/chamadas-sftp-repo.js";

export interface ResumoImportacao {
  recebidas: number;
  inseridas: number;
  atualizadas: number;
  mantidas: number;
  invalidas: number;
  destaques: boolean;
}

/**
 * Pull the SFTP portal's analyses into the Supervisor (one-off migration, safe
 * to repeat). Does nothing when PORTAL_SFTP_EXPORT_URL / _TOKEN are not set.
 * Never calls the LLM.
 */
export async function importarDoPortalSftp(fetchImpl: typeof fetch = globalThis.fetch): Promise<ResumoImportacao | null> {
  const cfg = env();
  if (!cfg.PORTAL_SFTP_EXPORT_URL || !cfg.PORTAL_SFTP_EXPORT_TOKEN) return null;

  const res = await fetchImpl(cfg.PORTAL_SFTP_EXPORT_URL, {
    headers: { Accept: "application/json", "X-Export-Token": cfg.PORTAL_SFTP_EXPORT_TOKEN },
  });
  if (!res.ok) throw new Error(`Portal SFTP respondeu ${res.status} ao export`);
  const corpo = exportPortalSchema.parse(await res.json());

  const r: ResumoImportacao = { recebidas: corpo.chamadas.length, inseridas: 0, atualizadas: 0, mantidas: 0, invalidas: 0, destaques: false };
  for (const bruta of corpo.chamadas) {
    const c = converterChamadaPortal(bruta);
    if (!c) {
      r.invalidas++;
      continue;
    }
    const o = await importarChamadaPortal(c);
    if (o === "inserida") r.inseridas++;
    else if (o === "atualizada") r.atualizadas++;
    else r.mantidas++;
  }

  if (corpo.destaques && !(await haDestaques())) {
    const { periodoDe, periodoAte, geradoEm: _g, modelo, ...conteudo } = corpo.destaques;
    await guardarDestaques({ periodoDe, periodoAte, conteudo, modelo: modelo ?? "" });
    r.destaques = true;
  }
  logger.info(r, "chamadas-sftp: análises do portal importadas");
  return r;
}
