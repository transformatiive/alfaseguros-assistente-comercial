import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { todayLisbon } from "../lib/dates.js";
import { NocrmClient, NocrmErro, OrcamentoEsgotado, NOCRM_PAGINA } from "../nocrm/client.js";
import { eventoDaNota, eventoDoHistorico, linhaDaLead, nomeDoUser, passoDesdeDoHistorico, type EventoParsed } from "../nocrm/parse.js";
import * as repo from "../storage/nocrm-repo.js";

/**
 * Sincronização do espelho do noCRM. Chamada pelo n8n (`POST
 * /api/vida/pipeline/sync`) três vezes por dia útil.
 *
 * Passos, por ordem, cada um com o orçamento que sobra:
 *  1. utilizadores e etiquetas (2 pedidos);
 *  2. leads: na primeira vez, todas as abertas e as alteradas nos últimos
 *     `JANELA_INICIAL_DIAS`; depois, só as alteradas desde o cursor;
 *  3. fotografia da agenda de hoje (sem pedidos: sai da tabela de leads);
 *  4. notas e histórico das leads que mudaram (2 pedidos por lead), abertas
 *     primeiro. O que não couber fica para a corrida seguinte.
 *
 * O orçamento é diário e fica guardado em `nocrm_sync`: três corridas no
 * mesmo dia partilham os mesmos `NOCRM_PEDIDOS_POR_DIA`.
 */

export const JANELA_INICIAL_DIAS = 60;
/** Leads fechadas há mais do que isto não têm as notas lidas. */
export const FECHADAS_DIAS = 60;
/** Margem para trás no cursor, para não perder leads alteradas no mesmo segundo. */
const MARGEM_CURSOR_MS = 5 * 60_000;
/** Páginas máximas por listagem, para um erro do lado do noCRM não esgotar a quota. */
const MAX_PAGINAS = 100;

export interface ResultadoSync {
  ok: boolean;
  motivo?: string;
  dia: string;
  pedidos: number;
  pedidosNoDia: number;
  users: number;
  colaboradoresLigados: number;
  leads: number;
  agendaNova: number;
  leadsComEventos: number;
  eventos: number;
  leadsPorLer: number;
  orcamentoEsgotado: boolean;
  erros: string[];
}

export interface DepsSync {
  cliente: Pick<NocrmClient, "listarUsers" | "listarTags" | "listarLeads" | "listarNotas" | "listarHistorico" | "pedidosUsados" | "pedidosRestantes">;
  repo: Pick<
    typeof repo,
    | "gravarUsers"
    | "ligarColaboradoresPorEmail"
    | "gravarTags"
    | "lerCategorias"
    | "gravarLeads"
    | "fotografarAgenda"
    | "leadsPorLerEventos"
    | "contarLeadsPorLerEventos"
    | "gravarEventosDaLead"
  >;
  cursor: Date | null;
  agora: Date;
}

const DIA_MS = 86_400_000;

/** O trabalho em si, sem estado global: recebe o cliente e o repositório. */
export async function sincronizar(d: DepsSync): Promise<Omit<ResultadoSync, "pedidosNoDia"> & { novoCursor: Date | null }> {
  const { cliente, agora } = d;
  const dia = todayLisbon(agora);
  const erros: string[] = [];
  let orcamentoEsgotado = false;
  let users = 0, colaboradoresLigados = 0, leads = 0, agendaNova = 0, leadsComEventos = 0, eventos = 0;
  let novoCursor = d.cursor;

  const parar = (err: unknown, onde: string): boolean => {
    if (err instanceof OrcamentoEsgotado) {
      orcamentoEsgotado = true;
      erros.push(`${onde}: ${err.message}`);
      return true;
    }
    const msg = err instanceof Error ? err.message : String(err);
    erros.push(`${onde}: ${msg}`);
    // 401/403: a chave está errada ou foi desligada. Continuar só gasta quota.
    return err instanceof NocrmErro && (err.status === 401 || err.status === 403);
  };

  try {
    // 1. Utilizadores e etiquetas.
    const us = await cliente.listarUsers();
    await d.repo.gravarUsers(
      us.map((u) => ({ id: u.id, nome: nomeDoUser(u), email: u.email ?? null, admin: u.is_admin ?? false, ativo: !(u.is_disabled ?? false) })),
    );
    users = us.length;
    colaboradoresLigados = await d.repo.ligarColaboradoresPorEmail();

    const tags = await cliente.listarTags();
    await d.repo.gravarTags(tags.map((t) => ({ nome: t.name, categoria: t.category ?? null })));
    const categorias = await d.repo.lerCategorias();

    // 2. Leads.
    const listar = async (params: { atualizadasDesde?: string; estado?: string }): Promise<void> => {
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const { leads: lote } = await cliente.listarLeads({ ...params, offset: pagina * NOCRM_PAGINA });
        if (lote.length === 0) break;
        const linhas = lote.map((l) => linhaDaLead(l, categorias));
        await d.repo.gravarLeads(linhas);
        leads += linhas.length;
        // Ordenadas por última alteração, das mais antigas para as recentes:
        // o cursor avança página a página e um corte a meio não perde nada.
        if (params.atualizadasDesde !== undefined) {
          const max = linhas.reduce((m, l) => (l.atualizadaEm > m ? l.atualizadaEm : m), novoCursor ?? new Date(0));
          novoCursor = max;
        }
        if (lote.length < NOCRM_PAGINA) break;
      }
    };

    if (!d.cursor) {
      await listar({ estado: "todo" });
      await listar({ estado: "standby" });
      await listar({ atualizadasDesde: new Date(agora.getTime() - JANELA_INICIAL_DIAS * DIA_MS).toISOString() });
    } else {
      await listar({ atualizadasDesde: new Date(d.cursor.getTime() - MARGEM_CURSOR_MS).toISOString() });
    }
  } catch (err) {
    if (parar(err, "leads")) {
      // Sem leads lidas não há agenda fiável para fotografar.
      return { ok: false, motivo: erros[erros.length - 1], dia, pedidos: cliente.pedidosUsados, users, colaboradoresLigados, leads, agendaNova, leadsComEventos, eventos, leadsPorLer: 0, orcamentoEsgotado, erros, novoCursor };
    }
  }

  // 3. Agenda de hoje. Fica antes das notas: é o que define o "previsto".
  agendaNova = await d.repo.fotografarAgenda(dia);

  // 4. Notas e histórico, dentro do orçamento que sobra.
  const fechadasDesde = new Date(agora.getTime() - FECHADAS_DIAS * DIA_MS);
  if (!orcamentoEsgotado) {
    const fila = await d.repo.leadsPorLerEventos(Math.floor(cliente.pedidosRestantes / 2), fechadasDesde);
    for (const l of fila) {
      if (cliente.pedidosRestantes < 2) break;
      try {
        const [notas, historico] = [await cliente.listarNotas(l.id), await cliente.listarHistorico(l.id)];
        const evs: EventoParsed[] = [
          ...notas.map((c) => eventoDaNota(l.id, c)),
          ...historico.map((h) => eventoDoHistorico(l.id, h)).filter((e): e is EventoParsed => e !== null),
        ].filter((e) => !Number.isNaN(e.ocorreuEm.getTime()));
        await d.repo.gravarEventosDaLead(l.id, evs, passoDesdeDoHistorico(historico), l.atualizadaEm);
        leadsComEventos++;
        eventos += evs.length;
      } catch (err) {
        if (err instanceof NocrmErro && err.status === 404) {
          // Lead apagada no noCRM: marca como lida para não voltar à fila.
          await d.repo.gravarEventosDaLead(l.id, [], null, l.atualizadaEm);
          continue;
        }
        if (parar(err, `lead ${l.id}`)) break;
      }
    }
  }

  const leadsPorLer = await d.repo.contarLeadsPorLerEventos(fechadasDesde);
  return {
    ok: erros.length === 0,
    dia,
    pedidos: cliente.pedidosUsados,
    users,
    colaboradoresLigados,
    leads,
    agendaNova,
    leadsComEventos,
    eventos,
    leadsPorLer,
    orcamentoEsgotado,
    erros: erros.slice(0, 20),
    novoCursor,
  };
}

/**
 * Parte do orçamento que sobra no dia para esta corrida. Divide pelo número de
 * corridas que ainda faltam (06:30, 13:00, 18:00), para um dia com muitas
 * alterações não deixar as corridas da tarde sem pedidos.
 */
export function orcamentoDaCorrida(restantesNoDia: number, agora: Date): number {
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", hour12: false }).format(agora));
  const faltam = hora < 12 ? 3 : hora < 17 ? 2 : 1;
  return Math.max(0, Math.floor(restantesNoDia / faltam));
}

let emCurso = false;

/**
 * Ponto de entrada da rota: lê o estado, calcula o orçamento do dia, corre e
 * grava. Nunca lança: devolve sempre um resultado que o n8n pode registar.
 */
export async function runSyncNocrm(agora: Date = new Date()): Promise<ResultadoSync> {
  const cfg = env();
  const dia = todayLisbon(agora);
  const vazio = (motivo: string, pedidosNoDia = 0): ResultadoSync => ({
    ok: false, motivo, dia, pedidos: 0, pedidosNoDia, users: 0, colaboradoresLigados: 0, leads: 0, agendaNova: 0,
    leadsComEventos: 0, eventos: 0, leadsPorLer: 0, orcamentoEsgotado: false, erros: [],
  });

  if (!cfg.NOCRM_API_KEY) return vazio("NOCRM_API_KEY não está configurada");
  if (emCurso) return vazio("Já há uma sincronização a correr");
  emCurso = true;
  try {
    const estado = await repo.lerEstadoSync();
    const usadosHoje = estado.dia === dia ? estado.pedidosNoDia : 0;
    const orcamento = orcamentoDaCorrida(cfg.NOCRM_PEDIDOS_POR_DIA - usadosHoje, agora);
    if (orcamento < 10) return vazio("Orçamento diário de pedidos ao noCRM esgotado", usadosHoje);

    const cliente = new NocrmClient({ apiKey: cfg.NOCRM_API_KEY, subdominio: cfg.NOCRM_SUBDOMAIN, orcamento });
    let r: Awaited<ReturnType<typeof sincronizar>>;
    try {
      r = await sincronizar({ cliente, repo, cursor: estado.cursor, agora });
    } catch (err) {
      // Falha da base de dados a meio. Os pedidos já foram gastos: contam.
      logger.error({ err }, "nocrm: sincronização falhou");
      await repo.gravarEstadoSync({ ...estado, dia, pedidosNoDia: usadosHoje + cliente.pedidosUsados, ultimaCorridaEm: agora, ultimoResultado: { ok: false, erro: err instanceof Error ? err.message : String(err) } });
      return { ...vazio(err instanceof Error ? err.message : String(err), usadosHoje + cliente.pedidosUsados), pedidos: cliente.pedidosUsados };
    }

    const { novoCursor, ...resto } = r;
    const resultado: ResultadoSync = { ...resto, pedidosNoDia: usadosHoje + r.pedidos };
    await repo.gravarEstadoSync({ cursor: novoCursor, ultimaCorridaEm: agora, dia, pedidosNoDia: resultado.pedidosNoDia, ultimoResultado: resultado });
    logger.info({ ...resultado, erros: resultado.erros.length }, "nocrm: sincronização terminada");
    return resultado;
  } catch (err) {
    logger.error({ err }, "nocrm: sincronização falhou antes de começar");
    return vazio(err instanceof Error ? err.message : String(err));
  } finally {
    emCurso = false;
  }
}
