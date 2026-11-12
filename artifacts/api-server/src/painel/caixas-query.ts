import { and, eq, gte, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db, chamadasRingoverTable, ticketCommentsTable, ticketsTable } from "@workspace/db";
import { deOutroDepartamento, telefoneDoTicket, urlDoDesk, ESTADO_APAGADO } from "./tickets-risco.js";
import { estadoDoNegocio } from "./followups-contexto.js";
import {
  montarCaixas,
  RGPD_PENDENTE,
  type Caixas,
  type ChamadaParaCaixa,
  type ConversaParaCaixa,
  type TicketParaCaixa,
} from "./caixas.js";

/**
 * Lê da base o que as caixas precisam, para uma pessoa (pelo id do Desk).
 *
 * Separado de `caixas.ts` pela mesma razão que `evidencia-query` está
 * separado de `evidencia`: as regras testam-se com literais, a leitura não.
 */

/** Chamadas lidas para trás. Chega para uma simulação parada há dois meses. */
const DIAS_DE_CHAMADAS = 90;

function texto(cf: Record<string, unknown>, k: string): string | null {
  const v = cf[k];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function paraCaixa(t: typeof ticketsTable.$inferSelect): TicketParaCaixa {
  const cf = (t.customFieldsJson && typeof t.customFieldsJson === "object"
    ? t.customFieldsJson
    : {}) as Record<string, unknown>;
  return {
    id: t.id,
    ticketNumber: t.ticketNumber,
    subject: t.subject,
    status: t.status,
    statusType: t.statusType,
    createdTime: t.createdTime,
    modifiedTime: t.modifiedTime,
    closedTime: t.closedTime,
    contactName: t.contactName,
    contactPhone: t.contactPhone,
    phoneFingerprint: t.phoneFingerprint,
    telefoneTicket: telefoneDoTicket(t.rawJson),
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeName,
    deskUrl: urlDoDesk(t.id, t.rawJson),
    negocio: texto(cf, "cf_negocio_1"),
    tipoPedido: texto(cf, "cf_negocio"),
    estadoNegocio: estadoDoNegocio(cf),
    rgpd: texto(cf, "cf_rgpd"),
    passoAutomatico: texto(cf, "cf_auto_step"),
  };
}

export async function carregarCaixas(zid: string, now: Date = new Date()): Promise<Caixas> {
  const [abertos, rgpd] = await Promise.all([
    db
      .select()
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.assigneeId, zid),
          or(notInArray(ticketsTable.statusType, ["Closed", ESTADO_APAGADO]), isNull(ticketsTable.statusType)),
        ),
      ),
    db
      .select()
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.assigneeId, zid),
          eq(ticketsTable.statusType, "Closed"),
          sql`lower(${ticketsTable.customFieldsJson}->>'cf_rgpd') = ${RGPD_PENDENTE}`,
        ),
      ),
  ]);

  const tickets = [...abertos, ...rgpd].filter((t) => !deOutroDepartamento(t.rawJson)).map(paraCaixa);
  const idsAbertos = abertos.filter((t) => !deOutroDepartamento(t.rawJson)).map((t) => t.id);

  const conversas: ConversaParaCaixa[] = [];
  for (let i = 0; i < idsAbertos.length; i += 500) {
    const lote = idsAbertos.slice(i, i + 500);
    const linhas = await db
      .select({
        ticketId: ticketCommentsTable.ticketId,
        quando: ticketCommentsTable.commentedTime,
        direcao: ticketCommentsTable.direction,
        autorTipo: ticketCommentsTable.authorType,
        texto: ticketCommentsTable.contentSanitized,
        raw: ticketCommentsTable.rawJson,
      })
      .from(ticketCommentsTable)
      .where(inArray(ticketCommentsTable.ticketId, lote));
    for (const l of linhas) {
      if (!l.quando) continue;
      const raw = (l.raw && typeof l.raw === "object" ? l.raw : {}) as Record<string, unknown>;
      const tipo = raw.tipo === "comment" ? "comment" : raw.tipo === "thread" ? "thread" : l.direcao ? "thread" : "comment";
      conversas.push({
        ticketId: l.ticketId,
        tipo,
        quando: l.quando,
        direcao: l.direcao,
        autorTipo: l.autorTipo,
        temAnexo: typeof raw.temAnexo === "boolean" ? raw.temAnexo : raw.temAnexo === null ? null : undefined,
        texto: l.texto,
      });
    }
  }

  const fingerprints = [
    ...new Set(
      tickets
        .filter((t) => idsAbertos.includes(t.id))
        .flatMap((t) => [t.phoneFingerprint, t.telefoneTicket])
        .filter((x): x is string => !!x && x.length === 9),
    ),
  ];
  const desde = new Date(now.getTime() - DIAS_DE_CHAMADAS * 86_400_000);
  const chamadas: ChamadaParaCaixa[] =
    fingerprints.length === 0
      ? []
      : (
          await db
            .select({
              numero: chamadasRingoverTable.clienteNumero,
              inicio: chamadasRingoverTable.inicio,
              atendida: chamadasRingoverTable.atendida,
              duracaoS: chamadasRingoverTable.duracaoS,
            })
            .from(chamadasRingoverTable)
            .where(
              and(
                gte(chamadasRingoverTable.inicio, desde),
                eq(chamadasRingoverTable.atendida, true),
                inArray(sql<string>`right(${chamadasRingoverTable.clienteNumero}, 9)`, fingerprints),
              ),
            )
        ).map((c) => ({
          fingerprint: (c.numero ?? "").replace(/\D/g, "").slice(-9),
          inicio: c.inicio,
          atendida: c.atendida,
          duracaoS: c.duracaoS,
        }));

  return montarCaixas({ tickets, conversas, chamadas, now });
}
