/**
 * Análise de Chamadas Vida (gravações do SFTP), TRNSF-2206.
 *
 * Com sessão (menu "Análise de Chamadas" da app):
 *   GET /api/chamadas-sftp/resumo?de=&ate=           — KPIs, tipos, dias, pontos, destaques
 *   GET /api/chamadas-sftp/chamadas?de=&ate=&…        — lista de chamadas (filtros: tipo, item, res, estado)
 *   GET /api/chamadas-sftp/chamadas/:id               — uma chamada com todos os pontos
 *   GET /api/chamadas-sftp/chamadas/:id/transcricao   — conversa transcrita
 *   GET /api/chamadas-sftp/chamadas/:id/audio         — a gravação (aceita Range)
 *
 * Com X-Cron-Secret:
 *   POST /api/chamadas-sftp/processar?limite=N        — corre a análise agora
 */
import { Router, type IRouter, type RequestHandler } from "express";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { bucket, lerAudio, lerJson } from "../chamadas-sftp/bucket.js";
import { chaveTranscricao, conversaEmTexto, lerTranscricao, nomeBase } from "../chamadas-sftp/ficheiro.js";
import { percentagem, periodoUtc } from "../chamadas-sftp/agregar.js";
import { PONTOS, type TipoChamada } from "../chamadas-sftp/catalogo.js";
import { carregarPeriodo, periodoAnterior } from "../chamadas-sftp/painel.js";
import { destaquesSchema } from "../chamadas-sftp/destaques.js";
import { emExecucao, processarChamadasSftp } from "../jobs/chamadas-sftp.js";
import {
  chamadaPorId,
  chamadasDoPeriodo,
  destaquesMaisRecentes,
  resultadosDasChamadas,
  ultimaAnalise,
} from "../storage/chamadas-sftp-repo.js";

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function periodo(q: Record<string, unknown>): { de: string; ate: string } | null {
  const de = typeof q.de === "string" && DATA_RE.test(q.de) ? q.de : null;
  const ate = typeof q.ate === "string" && DATA_RE.test(q.ate) ? q.ate : null;
  if (!de || !ate || de > ate) return null;
  return { de, ate };
}

/** Só os últimos dígitos: chega para reconhecer a chamada sem expor o número. */
function telefoneCurto(t: string | null): string | null {
  return t ? `…${t.slice(-3)}` : null;
}

const requireCronSecret: RequestHandler = (req, res, next) => {
  const cfg = env();
  if (!cfg.CRON_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Cron secret not configured on server" });
    return;
  }
  if (req.header("x-cron-secret") !== cfg.CRON_WEBHOOK_SECRET) {
    res.status(401).json({ error: "Invalid X-Cron-Secret" });
    return;
  }
  next();
};

export const chamadasSftpAdminRouter: IRouter = Router();

chamadasSftpAdminRouter.post("/chamadas-sftp/processar", requireCronSecret, async (req, res): Promise<void> => {
  if (emExecucao()) {
    res.status(409).json({ error: "Já há uma execução em curso" });
    return;
  }
  const limite = Number(req.query.limite);
  const resumo = await processarChamadasSftp({ limite: Number.isFinite(limite) && limite > 0 ? limite : undefined });
  res.json({ ok: true, ...resumo });
});

const router: IRouter = Router();

router.get("/chamadas-sftp/resumo", async (req, res): Promise<void> => {
  const p = periodo(req.query);
  if (!p) {
    res.status(400).json({ error: "Parâmetros 'de' e 'ate' (YYYY-MM-DD) são obrigatórios" });
    return;
  }
  const ant = periodoAnterior(p.de, p.ate);
  const [atual, anterior, destaques, ultima] = await Promise.all([
    carregarPeriodo(p.de, p.ate),
    carregarPeriodo(ant.de, ant.ate),
    destaquesMaisRecentes(),
    ultimaAnalise(),
  ]);
  const d = destaques ? destaquesSchema.safeParse(destaques.conteudo) : null;
  res.json({
    configurado: bucket() !== null,
    de: p.de,
    ate: p.ate,
    ultimaAnalise: ultima?.toISOString() ?? null,
    ...atual.agregado,
    anterior: {
      de: ant.de,
      ate: ant.ate,
      analisadas: anterior.agregado.kpis.analisadas,
      cumprimentoPct: anterior.agregado.kpis.cumprimentoPct,
      pontos: Object.fromEntries(anterior.agregado.pontos.map((pt) => [pt.item, pt.pct])),
    },
    destaques:
      destaques && d?.success
        ? {
            periodoDe: destaques.periodoDe,
            periodoAte: destaques.periodoAte,
            geradoEm: destaques.geradoEm.toISOString(),
            ...d.data,
          }
        : null,
  });
});

router.get("/chamadas-sftp/chamadas", async (req, res): Promise<void> => {
  const p = periodo(req.query);
  if (!p) {
    res.status(400).json({ error: "Parâmetros 'de' e 'ate' (YYYY-MM-DD) são obrigatórios" });
    return;
  }
  const tipo = typeof req.query.tipo === "string" ? req.query.tipo : null;
  const item = typeof req.query.item === "string" && PONTOS.has(req.query.item) ? req.query.item : null;
  const resFiltro = typeof req.query.res === "string" ? req.query.res : null; // cumpriu | nao | rever
  const estado = typeof req.query.estado === "string" ? req.query.estado : "analisada"; // analisada | todas

  let chamadas = await chamadasDoPeriodo(periodoUtc(p.de, p.ate));
  if (estado !== "todas") chamadas = chamadas.filter((c) => c.estado === "analisada");
  if (tipo) chamadas = chamadas.filter((c) => c.tipo === tipo);

  const resultados = await resultadosDasChamadas(chamadas.filter((c) => c.estado === "analisada").map((c) => c.id));
  const porChamada = new Map<number, typeof resultados>();
  for (const r of resultados) {
    const l = porChamada.get(r.chamadaId) ?? [];
    l.push(r);
    porChamada.set(r.chamadaId, l);
  }

  const linhas = chamadas
    .map((c) => {
      const rs = porChamada.get(c.id) ?? [];
      const doItem = item ? rs.find((r) => r.item === item) : undefined;
      let cumpriu = 0;
      let nao = 0;
      let rever = 0;
      for (const r of rs) {
        if (r.estado === "nao_aplicavel") continue;
        if (r.rever) rever += 1;
        else if (r.estado === "cumprido") cumpriu += 1;
        else nao += 1;
      }
      return {
        id: c.id,
        dataHora: c.dataHora.toISOString(),
        duracaoS: c.duracaoS,
        estado: c.estado,
        colaborador: c.colaborador,
        tipo: c.tipo,
        resumo: c.resumo,
        desfecho: c.desfecho,
        objecoes: c.objecoes ?? [],
        motivoDescarte: c.motivoDescarte,
        telefone: telefoneCurto(c.telefone),
        ficheiro: nomeBase(c.ficheiro),
        cumprimentoPct: percentagem({ cumpriu, nao }),
        pontosRever: rever,
        item: doItem
          ? {
              estado: doItem.estado,
              rever: doItem.rever,
              confianca: doItem.confianca,
              evidencia: doItem.evidencia,
            }
          : null,
      };
    })
    .filter((l) => {
      if (!item) return true;
      if (!l.item) return false;
      if (resFiltro === "cumpriu") return l.item.estado === "cumprido" && !l.item.rever;
      if (resFiltro === "nao") return l.item.estado === "nao_cumprido" && !l.item.rever;
      if (resFiltro === "rever") return l.item.rever;
      return l.item.estado !== "nao_aplicavel";
    });

  res.json({ de: p.de, ate: p.ate, total: linhas.length, chamadas: linhas });
});

function idValido(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/chamadas-sftp/chamadas/:id", async (req, res): Promise<void> => {
  const id = idValido(req.params.id);
  const c = id ? await chamadaPorId(id) : null;
  if (!c) {
    res.status(404).json({ error: "Chamada não encontrada" });
    return;
  }
  const rs = await resultadosDasChamadas([c.id]);
  res.json({
    id: c.id,
    dataHora: c.dataHora.toISOString(),
    duracaoS: c.duracaoS,
    estado: c.estado,
    colaborador: c.colaborador,
    tipo: c.tipo as TipoChamada | null,
    resumo: c.resumo,
    desfecho: c.desfecho,
    objecoes: c.objecoes ?? [],
    motivoDescarte: c.motivoDescarte,
    telefone: telefoneCurto(c.telefone),
    ficheiro: nomeBase(c.ficheiro),
    modelo: c.modelo,
    resultados: rs.map((r) => {
      const pt = PONTOS.get(r.item);
      return {
        item: r.item,
        seccao: pt?.seccao ?? "",
        validacao: pt?.validacao ?? r.item,
        pergunta: pt?.pergunta ?? "",
        estado: r.estado,
        rever: r.rever,
        confianca: r.confianca,
        evidencia: r.evidencia,
      };
    }),
  });
});

router.get("/chamadas-sftp/chamadas/:id/transcricao", async (req, res): Promise<void> => {
  const id = idValido(req.params.id);
  const c = id ? await chamadaPorId(id) : null;
  if (!c || !bucket()) {
    res.status(404).json({ error: "Chamada não encontrada" });
    return;
  }
  try {
    const t = lerTranscricao(await lerJson(chaveTranscricao(nomeBase(c.ficheiro))));
    if (!t) throw new Error("formato inesperado");
    res.json({ linhas: conversaEmTexto(t, 200_000).split("\n") });
  } catch (err) {
    logger.warn({ err, id }, "chamadas-sftp: transcrição indisponível");
    res.status(404).json({ error: "Transcrição indisponível" });
  }
});

router.get("/chamadas-sftp/chamadas/:id/audio", async (req, res): Promise<void> => {
  const id = idValido(req.params.id);
  const c = id ? await chamadaPorId(id) : null;
  if (!c || !bucket()) {
    res.status(404).json({ error: "Gravação não encontrada" });
    return;
  }
  const range = req.header("range");
  try {
    const a = await lerAudio(c.ficheiro, range);
    res.status(range && a.intervalo ? 206 : 200);
    res.setHeader("Content-Type", a.tipo);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (a.tamanho !== undefined) res.setHeader("Content-Length", String(a.tamanho));
    if (a.intervalo) res.setHeader("Content-Range", a.intervalo);
    a.corpo.on("error", (err) => {
      logger.warn({ err, id }, "chamadas-sftp: áudio interrompido");
      res.destroy(err);
    });
    a.corpo.pipe(res);
  } catch (err) {
    logger.warn({ err, id }, "chamadas-sftp: gravação indisponível");
    if (!res.headersSent) res.status(404).json({ error: "Gravação indisponível" });
  }
});

export default router;
