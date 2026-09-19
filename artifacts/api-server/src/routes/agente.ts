import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { lisbonDayBoundsISO, somarDias, todayLisbon } from "../lib/dates.js";
import { mintAgentToken } from "../painel/token.js";
import {
  resolveColaborador,
  loadColaboradorAtivo,
  listarColaboradoresAtivos,
  listarPessoasComAcesso,
} from "../painel/identity.js";
import { requireAgent, requireSupervisor, agenteDe } from "../middleware/require-agent.js";
import {
  listDevolucoesPendentes,
  concluirDevolucao,
} from "../storage/devolucoes-repo.js";

import { buildAgentePainel } from "../painel/agente.js";
import { buildSupervisorPainel } from "../painel/supervisor.js";
import { carregarIntervalos } from "../painel/evolucao-query.js";
import { derivarAgregado, derivarSerie, INICIO_DA_SERIE } from "../painel/evolucao.js";
import { carregarAcessos, registarAcesso } from "../storage/acessos-repo.js";
import { derivarAdopcao, type Granularidade } from "../painel/adopcao.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/agente/sessao — exchange a Zoho identity for a 15-minute token
// ---------------------------------------------------------------------------

/**
 * Rate limit for the mint endpoint: 30 requests per minute per IP.
 * In-memory and per-process on purpose — this is a brake on a widget looping
 * or someone probing identities, not a security boundary. The widget-token
 * guard is the boundary.
 */
const MINT_WINDOW_MS = 60_000;
const MINT_MAX = 30;
const mintHits = new Map<string, number[]>();

function rateLimited(ip: string, now = Date.now()): boolean {
  const hits = (mintHits.get(ip) ?? []).filter((t) => now - t < MINT_WINDOW_MS);
  hits.push(now);
  mintHits.set(ip, hits);
  if (mintHits.size > 5_000) mintHits.clear(); // crude guard against unbounded growth
  return hits.length > MINT_MAX;
}

const sessaoBodySchema = z.object({
  deskUserId: z.string().optional(),
  crmUserId: z.string().optional(),
  email: z.string().optional(),
  portalId: z.string().optional(),
  orgId: z.string().optional(),
  source: z.enum(["desk", "crm"]).optional(),
});

router.post("/agente/sessao", (req, res, next) => {
  void (async () => {
    const cfg = env();

    const widgetToken = cfg.PAINEL_WIDGET_TOKEN;
    if (!widgetToken || !cfg.AGENT_TOKEN_SECRET) {
      res.status(503).json({ error: "Painel do agente não está configurado no servidor" });
      return;
    }
    if (req.headers["x-painel-widget-token"] !== widgetToken) {
      res.status(401).json({ error: "Widget não autorizado" });
      return;
    }

    const ip = req.ip ?? "desconhecido";
    if (rateLimited(ip)) {
      res.status(429).json({ error: "Demasiados pedidos" });
      return;
    }

    const parsed = sessaoBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Pedido inválido" });
      return;
    }
    const body = parsed.data;

    // The widget reports which Zoho org it is running in. If that is not the
    // Alfaseguros org, the caller is not our widget however valid its token.
    const orgEsperada = cfg.ZOHO_DESK_ORG_ID;
    const orgRecebida = body.portalId ?? body.orgId;
    if (orgEsperada && orgRecebida && orgRecebida !== orgEsperada) {
      logger.warn(
        { orgRecebida, source: body.source },
        "painel: pedido de sessão de uma organização Zoho inesperada",
      );
      res.status(403).json({ error: "Organização não autorizada" });
      return;
    }

    const colaborador = await resolveColaborador({
      deskUserId: body.deskUserId,
      crmUserId: body.crmUserId,
      email: body.email,
    });

    if (!colaborador) {
      // Logged with the *requested* identity so a missing zid is diagnosable
      // without having to ask the agent what they saw.
      logger.warn(
        { deskUserId: body.deskUserId, crmUserId: body.crmUserId, email: body.email },
        "painel: identidade Zoho sem colaborador ativo correspondente",
      );
      res.status(403).json({ error: "Colaborador não reconhecido" });
      return;
    }
    if (colaborador.papel === "nenhum") {
      res.status(403).json({ error: "Sem acesso ao painel" });
      return;
    }

    const { token, expiresAt } = mintAgentToken(colaborador, cfg.AGENT_TOKEN_SECRET);
    logger.info(
      {
        pedido: { deskUserId: body.deskUserId, crmUserId: body.crmUserId, email: body.email },
        resolvido: { id: colaborador.id, nome: colaborador.nome, papel: colaborador.papel },
        source: body.source,
      },
      "painel: token emitido",
    );

    res.json({
      token,
      expiraEm: expiresAt.toISOString(),
      colaborador: {
        id: colaborador.id,
        nome: colaborador.nome,
        papel: colaborador.papel,
        equipa: colaborador.equipa,
      },
    });
  })().catch(next);
});

// ---------------------------------------------------------------------------
// Chamadas por devolver
// ---------------------------------------------------------------------------

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

const resolveData: RequestHandler = (req, res, next) => {
  const raw = req.query.data;
  if (raw !== undefined && (typeof raw !== "string" || !DATA_RE.test(raw))) {
    res.status(400).json({ error: "Parâmetro `data` inválido (use YYYY-MM-DD)" });
    return;
  }
  next();
};

router.get("/agente/devolucoes", requireAgent, resolveData, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const data = typeof req.query.data === "string" ? req.query.data : todayLisbon();
    const rows = await listDevolucoesPendentes(Number(claims.sub), data);
    res.json({
      data,
      devolucoes: rows.map((r) => ({
        id: r.id,
        numeroCliente: r.numeroCliente,
        horaChamada: r.horaChamada.toISOString(),
        contexto: r.contexto,
      })),
    });
  })().catch(next);
});

const concluirBodySchema = z.object({
  estado: z.enum(["devolvida", "dispensada"]),
});

router.post("/agente/devolucoes/:id/concluir", requireAgent, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const parsed = concluirBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Estado inválido" });
      return;
    }

    const resultado = await concluirDevolucao({
      id,
      colaboradorId: Number(claims.sub),
      estado: parsed.data.estado,
    });

    switch (resultado.estado) {
      case "de-outro-agente":
        logger.warn(
          { devolucaoId: id, colaboradorId: claims.sub },
          "painel: tentativa de resolver uma devolução de outro colaborador",
        );
        res.status(403).json({ error: "Esta devolução pertence a outro colaborador" });
        return;
      case "inexistente":
        res.status(404).json({ error: "Devolução não encontrada" });
        return;
      case "ja-resolvida":
        res.status(409).json({ error: "Devolução já resolvida" });
        return;
      case "ok":
        res.json({
          id: resultado.row.id,
          estado: resultado.row.estado,
          // Other attempts from the same number, closed by the same click.
          tambemResolvidas: resultado.tambemResolvidas,
        });
        return;
    }
  })().catch(next);
});

// ---------------------------------------------------------------------------
// GET /api/agente/painel — the four blocks
// ---------------------------------------------------------------------------

router.get("/agente/painel", requireAgent, resolveData, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const data = typeof req.query.data === "string" ? req.query.data : todayLisbon();

    // Re-read the colaborador rather than trusting the token: a 15-minute token
    // must not outlive a deactivation, and the panel needs fields the token
    // does not carry.
    const colaborador = await loadColaboradorAtivo(Number(claims.sub));
    if (!colaborador || colaborador.papel === "nenhum") {
      res.status(403).json({ error: "Sem acesso ao painel" });
      return;
    }

    registarAcesso(colaborador.id, "meu-dia");

    const { painel, erros } = await buildAgentePainel(colaborador, data);
    for (const erro of erros) {
      logger.error({ err: erro, colaboradorId: colaborador.id, data }, "painel: bloco falhou");
    }
    res.json(painel);
  })().catch(next);
});

// ---------------------------------------------------------------------------
// GET /api/supervisor/painel — the team view
// ---------------------------------------------------------------------------

router.get("/supervisor/painel", requireSupervisor, resolveData, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const data = typeof req.query.data === "string" ? req.query.data : todayLisbon();

    // Re-read rather than trust the token, exactly as the agent panel does:
    // demoting a supervisor must take effect now, not in up to 15 minutes.
    const colaborador = await loadColaboradorAtivo(Number(claims.sub));
    if (!colaborador || colaborador.papel !== "supervisor") {
      res.status(403).json({ error: "Acesso reservado ao supervisor" });
      return;
    }

    registarAcesso(colaborador.id, "equipa");
    res.json(await buildSupervisorPainel(data));
  })().catch(next);
});

// ---------------------------------------------------------------------------
// GET /api/supervisor/colaboradores — who a supervisor may look at
// GET /api/supervisor/painel/:id   — one agent's own panel, seen by a supervisor
// ---------------------------------------------------------------------------

/*
 * A supervisor sees, for any agent, exactly what that agent sees.
 *
 * The team view answers "who is carrying what" in counts. It does not answer
 * the question a supervisor actually opens the panel with — "what is going on
 * with Tiago this week" — which needs the same rows and the same coaching the
 * agent is reading. Rebuilding a second, supervisor-shaped version of that
 * screen would be two screens to keep true instead of one.
 *
 * So this is deliberately the *same* builder, not a variant of it. If the two
 * ever disagree, the conversation between a supervisor and an agent is about
 * two different screens, which is worse than no screen.
 *
 * Three things are not conveniences and should not be simplified away:
 *
 *  1. **The role is re-read from the database on every request**, never taken
 *     from the token. A token lives fifteen minutes; demoting someone must
 *     take effect now.
 *  2. **Every cross-view is logged with both ids.** This reads another
 *     person's coaching — what they do badly, in writing. A trail of who
 *     looked at whom is the least that owes.
 *  3. **An agent gets 403, not an empty list.** Hiding the tab in the UI is a
 *     courtesy; this is the control.
 */

router.get("/supervisor/colaboradores", requireSupervisor, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const supervisor = await loadColaboradorAtivo(Number(claims.sub));
    if (!supervisor || supervisor.papel !== "supervisor") {
      res.status(403).json({ error: "Acesso reservado ao supervisor" });
      return;
    }
    res.json({ colaboradores: await listarColaboradoresAtivos() });
  })().catch(next);
});

router.get("/supervisor/painel/:colaboradorId", requireSupervisor, resolveData, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const data = typeof req.query.data === "string" ? req.query.data : todayLisbon();

    const supervisor = await loadColaboradorAtivo(Number(claims.sub));
    if (!supervisor || supervisor.papel !== "supervisor") {
      res.status(403).json({ error: "Acesso reservado ao supervisor" });
      return;
    }

    const alvoId = Number(req.params.colaboradorId);
    if (!Number.isInteger(alvoId) || alvoId <= 0) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const alvo = await loadColaboradorAtivo(alvoId);
    if (!alvo || alvo.papel === "nenhum") {
      res.status(404).json({ error: "Colaborador não encontrado" });
      return;
    }

    logger.info(
      { supervisorId: supervisor.id, colaboradorId: alvo.id, data },
      "painel: supervisor abriu o painel de outro colaborador",
    );
    // Contado ao supervisor, não ao agente: quem abriu o painel foi ele. Somar
    // isto ao alvo diria que o Tiago anda a usar o painel quando na verdade
    // quem anda a olhar para o do Tiago é o Rui — exactamente ao contrário.
    registarAcesso(supervisor.id, "equipa");

    const { painel, erros } = await buildAgentePainel(alvo, data);
    for (const erro of erros) {
      logger.error({ err: erro, colaboradorId: alvo.id, data }, "painel: bloco falhou");
    }
    res.json(painel);
  })().catch(next);
});

// ---------------------------------------------------------------------------
// GET /api/supervisor/evolucao — está isto a produzir efeito?
// ---------------------------------------------------------------------------

/*
 * A vista que responde à única pergunta que justifica o painel existir.
 *
 * O estado de agora ("o que temos em cima da mesa") já estava na vista da
 * equipa, em contagens. O que faltava era a direcção: as contagens de hoje não
 * dizem se hoje é melhor do que a semana passada, e é isso que se quer saber.
 *
 * Três curvas, calculadas a partir do nascimento e da morte de cada tarefa em
 * vez de acumuladas num retrato diário — as razões estão em `evolucao.ts`, e a
 * principal é que assim a série existe já hoje em vez de daqui a duas semanas.
 *
 * A janela nunca vai atrás de 11/09: antes disso os dados existem mas são de
 * um sistema que corria noutras condições, e uma curva que abre com um degrau
 * causado por nós engana mais do que informa.
 */
router.get("/supervisor/evolucao", requireSupervisor, (req, res, next) => {
  void (async () => {
    const claims = agenteDe(req);
    const supervisor = await loadColaboradorAtivo(Number(claims.sub));
    if (!supervisor || supervisor.papel !== "supervisor") {
      res.status(403).json({ error: "Acesso reservado ao supervisor" });
      return;
    }

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

    registarAcesso(supervisor.id, "evolucao");

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

// ---------------------------------------------------------------------------
// GET /api/adopcao — e isto, alguém abre? (sem token, de propósito)
// ---------------------------------------------------------------------------

/*
 * A pergunta que o painel não fazia sobre si próprio.
 *
 * Todas as outras vistas medem o trabalho da equipa. Esta mede o nosso: um
 * painel com os números todos certos que ninguém abre não vale nada, e é uma
 * falha silenciosa — não dá erro, não aparece em log nenhum, e do lado de cá
 * parece tudo bem. A única maneira de a ver é contá-la.
 *
 * Três janelas porque respondem a três perguntas diferentes. O **dia** diz
 * quem entrou hoje, e é o que serve para ir falar com alguém agora. A
 * **semana** absorve as férias, as folgas e o dia em que o portátil não
 * arrancou — é onde se vê um hábito a formar-se ou a desfazer-se. O **mês** diz
 * se isto pegou, e é a única escala em que essa pergunta tem resposta.
 *
 * A janela por omissão acompanha a granularidade: catorze dias, doze semanas,
 * seis meses. Uma janela fixa daria seis pontos ou duzentos consoante o botão
 * escolhido, e nenhum dos dois se lê.
 *
 * ## Porque é que esta não pede token — e o que isso custa
 *
 * Todas as outras vistas do painel pedem um token de quinze minutos que só o
 * widget do Zoho Desk sabe emitir. Esta não, por pedido expresso, e a razão é
 * prática: é a vista que diz se o painel está a ser aberto, e enquanto o
 * widget não estiver a funcionar para toda a gente ela é precisamente a que
 * mais precisa de ser consultada — por quem não consegue entrar pelo Desk.
 *
 * O que fica exposto a quem souber o endereço, dito sem rodeios: **nomes de
 * colaboradores, a equipa e o papel de cada um, e quantas vezes abriram o
 * painel**. Não há um único dado de cliente — nem números, nem nomes, nem
 * assuntos de tickets — porque esta resposta é construída a partir de
 * contagens e datas e de mais nada.
 *
 * Não é inofensivo à mesma: são dados sobre pessoas identificadas, no trabalho
 * delas. O endereço não está ligado a partir de lado nenhum e o cabeçalho
 * `X-Robots-Tag` mantém-no fora dos motores de busca, mas isso é obscuridade,
 * não é uma tranca. Se um dia isto passar a ser lido por mais gente do que a
 * direcção, volta a pedir token.
 *
 * O que **não** é aceitável, e quase passou: ser legível por qualquer site que
 * um colaborador tenha aberto. Ver `semLeituraCruzada`.
 */

const JANELA_POR_OMISSAO: Record<Granularidade, number> = {
  dia: 14,
  semana: 7 * 12,
  mes: 30 * 6,
};

function granularidadeDe(raw: unknown): Granularidade {
  return raw === "semana" || raw === "mes" ? raw : "dia";
}

/**
 * Fecha esta resposta à leitura por outra origem.
 *
 * A app inteira corre com `cors({ origin: true })`, que devolve o cabeçalho de
 * permissão para **qualquer** site que peça. Nas rotas com token isso é
 * inofensivo: um site terceiro não tem o token e leva 401. Aqui não há token,
 * e sem isto qualquer página que um colaborador tivesse aberta noutro
 * separador podia ler a lista de colegas em silêncio, sem ninguém carregar em
 * nada.
 *
 * "Sem token" era o pedido; "legível por qualquer site que a equipa visite"
 * não era, e foi uma consequência que eu não vi — foi o revisor de segurança
 * que a apanhou.
 *
 * Retirar o cabeçalho não fecha a porta, fecha só esta janela: quem escrever o
 * endereço no browser continua a ver a página, e a própria página continua a
 * lê-la porque é servida da mesma origem. O que deixa de ser possível é outro
 * site lê-la por baixo do pano.
 *
 * `Vary: Origin` fica porque a resposta passa a depender da origem do pedido,
 * e uma cache pela frente não deve servir a mesma cópia a toda a gente.
 */
const semLeituraCruzada: RequestHandler = (_req, res, next) => {
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Credentials");
  res.setHeader("Vary", "Origin");
  next();
};

router.get("/adopcao", semLeituraCruzada, (req, res, next) => {
  void (async () => {
    const granularidade = granularidadeDe(req.query.granularidade);
    const ate =
      typeof req.query.ate === "string" && DATA_RE.test(req.query.ate)
        ? req.query.ate
        : todayLisbon();
    const de =
      typeof req.query.de === "string" && DATA_RE.test(req.query.de)
        ? req.query.de
        : somarDias(ate, -JANELA_POR_OMISSAO[granularidade]);

    if (de > ate) {
      res.status(400).json({ error: "`de` é posterior a `ate`" });
      return;
    }

    // Fora dos motores de busca. Não substitui uma tranca — nada aqui
    // substitui uma tranca — mas um endereço que ninguém publicou também não
    // tem de aparecer numa pesquisa pelo nome de um colaborador.
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    // A janela lida é a do *período* e não a dos dias pedidos: com a vista
    // mensal, `de` cai a meio de um mês, e ler só a partir daí mostraria a
    // primeira coluna cortada — um mês que parece fraco só porque foi lido
    // pela metade.
    const periodos = derivarAdopcao({
      acessos: [],
      pessoas: [],
      de,
      ate,
      granularidade,
    }).periodos;
    const primeiroDia = periodos[0]?.inicio ?? de;
    const ultimoDia = periodos.at(-1)?.fim ?? ate;

    const [acessos, pessoas] = await Promise.all([
      carregarAcessos(lisbonDayBoundsISO(primeiroDia)[0], lisbonDayBoundsISO(ultimoDia)[1]),
      listarPessoasComAcesso(),
    ]);

    res.json(derivarAdopcao({ acessos, pessoas, de, ate, granularidade }));
  })().catch(next);
});

export default router;
