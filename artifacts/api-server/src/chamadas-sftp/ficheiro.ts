/**
 * Leitura dos nomes das gravações e das transcrições do bucket do SFTP.
 *
 * Desde 19/10/2026 a Solidnetworks usa
 * `YYYY_MM_DD_HH_MM_SS_mmm_<telefone do cliente>_<uuid>.mp3`. Os ficheiros mais
 * antigos têm outro formato (ex.: `09_08_17_382_campaign_1394_ALFASEG02_always`),
 * sem data no nome: para esses vale a data de upload.
 */

const PREFIXO_TRANSCRICOES = "transcricoes/";

export interface DadosFicheiro {
  /** Nome sem pasta nem extensão — a chave do JSON em `transcricoes/`. */
  nome: string;
  dataHora: Date | null;
  telefone: string | null;
}

const RE_NOVO = /(20\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_\d{3}_(\+?\d{6,15})_/;
const RE_DATA = /(20\d{2})[-_/](\d{2})[-_/](\d{2})/;
const RE_HORA = /(?:^|[/_])(\d{2})_(\d{2})_(\d{2})_\d{3}_/;

/** A gravação é hora de Lisboa; converte para um Date em UTC. */
function lisboaParaUtc(ano: number, mes: number, dia: number, h: number, m: number, s: number): Date {
  const comoUtc = Date.UTC(ano, mes - 1, dia, h, m, s);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const partes = Object.fromEntries(fmt.formatToParts(new Date(comoUtc)).map((x) => [x.type, x.value]));
  const lisboa = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second),
  );
  return new Date(comoUtc - (lisboa - comoUtc));
}

export function nomeBase(chave: string): string {
  const base = chave.split("/").pop() ?? chave;
  return base.replace(/\.(mp3|json|wav)$/i, "");
}

export function lerFicheiro(chave: string): DadosFicheiro {
  const nome = nomeBase(chave);
  const novo = RE_NOVO.exec(chave);
  if (novo) {
    const [, a, me, d, h, mi, s, tel] = novo;
    return {
      nome,
      dataHora: lisboaParaUtc(+a, +me, +d, +h, +mi, +s),
      telefone: tel.replace(/^\+/, ""),
    };
  }
  const data = RE_DATA.exec(chave);
  const hora = RE_HORA.exec(chave);
  if (data) {
    const [, a, me, d] = data;
    const [h, mi, s] = hora ? [+hora[1], +hora[2], +hora[3]] : [12, 0, 0];
    return { nome, dataHora: lisboaParaUtc(+a, +me, +d, h, mi, s), telefone: null };
  }
  return { nome, dataHora: null, telefone: null };
}

export function chaveTranscricao(nome: string): string {
  return `${PREFIXO_TRANSCRICOES}${nome}.json`;
}

export interface Segmento {
  inicio: number;
  fim: number;
  texto: string;
}

export interface Transcricao {
  ficheiro: string;
  duracao_s: number;
  segmentos: Record<string, Segmento[]>;
}

function eSegmento(x: unknown): x is Segmento {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return typeof s.inicio === "number" && typeof s.texto === "string";
}

/** Valida o JSON escrito pelo transcritor (dados de fora do processo). */
export function lerTranscricao(bruto: unknown): Transcricao | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  if (typeof o.ficheiro !== "string" || !o.segmentos || typeof o.segmentos !== "object") return null;
  const segmentos: Record<string, Segmento[]> = {};
  for (const [canal, lista] of Object.entries(o.segmentos as Record<string, unknown>)) {
    if (!Array.isArray(lista)) continue;
    segmentos[canal] = lista.filter(eSegmento).map((s) => ({
      inicio: s.inicio,
      fim: typeof s.fim === "number" ? s.fim : s.inicio,
      texto: s.texto.trim(),
    }));
  }
  return {
    ficheiro: o.ficheiro,
    duracao_s: typeof o.duracao_s === "number" ? o.duracao_s : 0,
    segmentos,
  };
}

/** Número de palavras ditas, somando os canais. */
export function palavras(t: Transcricao): number {
  return Object.values(t.segmentos)
    .flat()
    .reduce((n, s) => n + (s.texto ? s.texto.split(/\s+/).length : 0), 0);
}

function mmss(seg: number): string {
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Junta os dois canais numa só conversa, por ordem de tempo, com o canal em
 * cada linha. Cada canal é um lado da chamada; quem é o operador fica para o
 * modelo decidir (é quem se apresenta em nome da Alfaseguros).
 */
export function conversaEmTexto(t: Transcricao, maxCaracteres = 40_000): string {
  const linhas = Object.entries(t.segmentos)
    .flatMap(([canal, segs]) =>
      segs.filter((s) => s.texto).map((s) => ({ ...s, canal: canal.replace(/^canal_/, "Canal ") })),
    )
    .sort((a, b) => a.inicio - b.inicio)
    .map((s) => `[${mmss(s.inicio)}] ${s.canal}: ${s.texto}`);
  const texto = linhas.join("\n");
  return texto.length > maxCaracteres ? `${texto.slice(0, maxCaracteres)}\n[… transcrição cortada]` : texto;
}
