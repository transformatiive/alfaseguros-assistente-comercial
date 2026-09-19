import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, colaboradoresTable } from "@workspace/db";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { todayLisbon } from "../lib/dates.js";
import { loadColaboradorAtivo } from "../painel/identity.js";
import { buildAgentePainel } from "../painel/agente.js";
import { buildSupervisorPainel } from "../painel/supervisor.js";
import { carregarIntervalos } from "../painel/evolucao-query.js";
import { derivarAgregado, derivarSerie, INICIO_DA_SERIE } from "../painel/evolucao.js";
import { derivarAdopcao, type Granularidade } from "../painel/adopcao.js";
import { carregarAcessos } from "../storage/acessos-repo.js";
import { listarPessoasComAcesso } from "../painel/identity.js";
import { lisbonDayBoundsISO, somarDias } from "../lib/dates.js";

/**
 * Read-only preview of the panel, with no token.
 *
 * Why it exists: the panel can only be opened with a 15-minute token minted by
 * a Zoho widget that is not installed yet. Reviewing a layout and its content
 * is a conversation longer than fifteen minutes, and re-minting mid-sentence is
 * not review, it is administration.
 *
 * Why it is dangerous, stated plainly rather than buried: while enabled, anyone
 * with the URL reads customer phone numbers, call context and ticket subjects,
 * for any agent. It is off unless `PAINEL_PREVIEW_ENABLED=1`, it never writes,
 * and it must be switched off once the extension works — one variable, no
 * deploy.
 *
 * Read-only is enforced by what is mounted, not by convention: this router
 * declares no POST and never imports a write function.
 */

const router: IRouter = Router();

function ligado(): boolean {
  return env().PAINEL_PREVIEW_ENABLED === "1";
}

router.use((req, res, next) => {
  if (!ligado()) {
    // 404 rather than 403: a disabled preview should look like a route that
    // does not exist, not like one worth attacking.
    res.status(404).json({ error: "Pré-visualização desligada" });
    return;
  }
  // Logged on every request, because a door left open should be visible to
  // whoever later asks "was this reachable, and by whom".
  logger.info({ caminho: req.path, ip: req.ip }, "painel: acesso à pré-visualização");
  next();
});

/** Who can be previewed. Name and role only — no identifiers worth stealing. */
router.get("/agente/pre-visualizacao/colaboradores", (_req, res, next) => {
  void (async () => {
    const rows = await db
      .select({
        id: colaboradoresTable.id,
        nome: colaboradoresTable.nome,
        papel: colaboradoresTable.papel,
      })
      .from(colaboradoresTable)
      .where(eq(colaboradoresTable.ativo, true))
      .orderBy(asc(colaboradoresTable.nome));
    res.json({ colaboradores: rows });
  })().catch(next);
});

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function diaPedido(valor: unknown): string {
  return typeof valor === "string" && DATA_RE.test(valor) ? valor : todayLisbon();
}

router.get("/agente/pre-visualizacao/painel", (req, res, next) => {
  void (async () => {
    const id = Number(req.query.colaboradorId);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "colaboradorId inválido" });
      return;
    }
    const data = diaPedido(req.query.data);

    const colaborador = await loadColaboradorAtivo(id);
    if (!colaborador) {
      res.status(404).json({ error: "Colaborador não encontrado" });
      return;
    }

    // Exactly the same builder the real panel uses. A preview built from a
    // second code path would validate a layout that nobody will ever see.
    const { painel, erros } = await buildAgentePainel(colaborador, data);
    for (const erro of erros) {
      logger.error({ err: erro, colaboradorId: id, data }, "pré-visualização: bloco falhou");
    }
    res.json(painel);
  })().catch(next);
});

router.get("/agente/pre-visualizacao/equipa", (req, res, next) => {
  void (async () => {
    res.json(await buildSupervisorPainel(diaPedido(req.query.data)));
  })().catch(next);
});

/*
 * A evolução, atrás da mesma porta.
 *
 * Está aqui por uma razão prática e uma de princípio. A prática: a vista vive
 * no separador do supervisor, o separador vive no widget, e o widget é
 * precisamente o que a equipa ainda não consegue abrir. Construir uma vista
 * que ninguém pode olhar não é entregar nada.
 *
 * A de princípio: de tudo o que esta porta já expõe, isto é o menos sensível.
 * O painel de um agente traz números de telefone e nomes de clientes; esta
 * resposta são contagens e datas, e mais nada. Acrescentá-la não alarga o que
 * está exposto de forma significativa — e sai com a porta, quando a porta
 * fechar.
 */
router.get("/agente/pre-visualizacao/evolucao", (req, res, next) => {
  void (async () => {
    const ate = typeof req.query.ate === "string" && DATA_RE.test(req.query.ate)
      ? req.query.ate
      : todayLisbon();
    const de = typeof req.query.de === "string" && DATA_RE.test(req.query.de)
      ? req.query.de
      : INICIO_DA_SERIE;
    if (de > ate) {
      res.status(400).json({ error: "`de` é posterior a `ate`" });
      return;
    }
    const intervalos = await carregarIntervalos({ de, ate });
    res.json({
      de: de < INICIO_DA_SERIE ? INICIO_DA_SERIE : de,
      ate,
      inicioDaSerie: INICIO_DA_SERIE,
      agregado: derivarAgregado(intervalos),
      serie: derivarSerie(intervalos, de, ate),
    });
  })().catch(next);
});

/**
 * A vista de adopção, sem token — pelas mesmas duas razões que a evolução.
 *
 * E por uma terceira, própria desta: é a vista que diz se o painel está a ser
 * aberto, e enquanto o widget não funcionar a resposta vem quase toda daqui.
 * Não a expor seria ficar sem saber justamente no período em que é mais
 * preciso saber.
 *
 * Destas respostas todas é a menos sensível de longe: nomes de colegas e
 * contagens, nenhum dado de cliente. Sai com a porta, quando a porta fechar.
 */

const JANELA_DE_PRE_VISUALIZACAO: Record<Granularidade, number> = {
  dia: 14,
  semana: 7 * 12,
  mes: 30 * 6,
};

router.get("/agente/pre-visualizacao/adopcao", (req, res, next) => {
  void (async () => {
    const g = req.query.granularidade;
    const granularidade: Granularidade = g === "semana" || g === "mes" ? g : "dia";
    const ate = todayLisbon();
    const de = somarDias(ate, -JANELA_DE_PRE_VISUALIZACAO[granularidade]);

    // Lida pelo período inteiro e não pelos dias pedidos: com a vista mensal
    // `de` cai a meio de um mês, e ler só a partir daí mostraria a primeira
    // coluna cortada — um mês que parece fraco só por ter sido lido a meio.
    const periodos = derivarAdopcao({
      acessos: [],
      pessoas: [],
      de,
      ate,
      granularidade,
    }).periodos;

    const [acessos, pessoas] = await Promise.all([
      carregarAcessos(
        lisbonDayBoundsISO(periodos[0]?.inicio ?? de)[0],
        lisbonDayBoundsISO(periodos.at(-1)?.fim ?? ate)[1],
      ),
      listarPessoasComAcesso(),
    ]);

    res.json(derivarAdopcao({ acessos, pessoas, de, ate, granularidade }));
  })().catch(next);
});

export default router;
