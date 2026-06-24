/**
 * Branded HTML email templates (Alfa Seguros) for the V2 checklist digests.
 * Mirrors the look of the existing per-team summary emails: maroon header with
 * the logo, orange accents, card layout. Used by /api/alertas-dia (per-operator
 * coaching) and the coordinator team summary.
 */

const ORANGE = "#E87D1D";
const MAROON = "#762023";
const INK = "#1f2933";
const BODY = "#3e4c59";
const MUTE = "#7b8794";
const LINE = "#e4e7eb";
const BG = "#f5f6f7";
const CARD = "#ffffff";
const GREEN = "#16a34a";
const RED = "#dc2626";
const AMBER = "#d97706";
const BASE = "https://alfaseguros-assistente-comercial.replit.app";
export const LOGO = "data:image/png;base64,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";

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

function header(label: string, date: string, sub: string): string {
  return `
  <tr><td style="background:${MAROON};padding:22px 28px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:Arial,Helvetica,sans-serif;vertical-align:middle">
        <img src="${LOGO}" height="34" alt="Alfa Seguros" style="display:block;height:34px;border:0;outline:none;text-decoration:none">
        <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.7);margin-top:8px">${esc(label)}</div>
      </td>
      <td align="right" style="font-family:Arial,Helvetica,sans-serif;vertical-align:middle">
        <div style="font-size:13px;color:#fff;font-weight:600">${esc(date)}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.7)">${esc(sub)}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

function footer(): string {
  return `<tr><td style="background:${CARD};padding:22px 28px 26px;border-top:1px solid ${LINE}">
    <a href="${BASE}/checklist" style="display:inline-block;background:${ORANGE};color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;padding:11px 22px;border-radius:6px">Abrir painel do supervisor &rarr;</a>
    <p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:${MUTE}">Relatório automático gerado pelo Supervisor Virtual da Alfa Seguros.</p>
  </td></tr>`;
}

function shell(label: string, date: string, sub: string, body: string): string {
  return `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:${CARD};border-radius:10px;overflow:hidden;border:1px solid ${LINE}">
      ${header(label, date, sub)}
      ${body}
      ${footer()}
    </table>
    <div style="font-size:11px;color:${MUTE};margin-top:16px">Alfa Seguros · AlfaSeg — Gestão de Seguros, Lda · Odivelas</div>
  </td></tr>
</table>
</body></html>`;
}

function badge(text: string, color: string): string {
  return `<span style="display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${color};border:1px solid ${color};border-radius:4px;padding:1px 6px;margin-left:6px">${esc(text)}</span>`;
}

// ---------------------------------------------------------------------------
// Per-operator coaching digest
// ---------------------------------------------------------------------------
export interface DigestPonto {
  validacao: string;
  texto: string;
  chamadas_falhadas: number;
  motivo: "compliance" | "categoria_obrigatoria";
  mensagemMelhoria: string;
}

export function renderColaboradorDigest(input: { nome: string; data: string; pontos: DigestPonto[] }): string {
  const linhas = input.pontos
    .map((p) => {
      const b = p.motivo === "compliance" ? badge("Obrigatório · legal", RED) : badge("A melhorar", AMBER);
      return `<tr><td style="padding:14px 0;border-bottom:1px solid ${LINE}">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:${MUTE}">${esc(p.validacao)}${b}</div>
        <div style="font-size:14px;font-weight:700;color:${INK};margin-top:4px;line-height:1.4">${esc(p.texto)}</div>
        <div style="font-size:12px;color:${MUTE};margin-top:3px">Critério não cumprido em ${p.chamadas_falhadas} ${p.chamadas_falhadas === 1 ? "chamada" : "chamadas"}</div>
        <div style="font-size:13px;color:${BODY};margin-top:6px;line-height:1.55"><strong style="color:${ORANGE}">Como melhorar:</strong> ${esc(p.mensagemMelhoria)}</div>
      </td></tr>`;
    })
    .join("");
  const body = `<tr><td style="padding:24px 28px">
    <p style="font-size:14px;color:${BODY};margin:0 0 4px">Olá <strong style="color:${INK}">${esc(input.nome)}</strong>,</p>
    <p style="font-size:14px;color:${BODY};margin:0 0 18px;line-height:1.55">Segue o teu resumo de coaching, com os pontos do guião do 1.º telefonema a reforçar:</p>
    <table width="100%" cellpadding="0" cellspacing="0">${linhas}</table>
    <p style="margin:18px 0 0;font-size:12px;color:${MUTE};line-height:1.5">Estas notas servem para te ajudar a fechar mais negócio. Em caso de dúvida, fala com a coordenação.</p>
  </td></tr>`;
  return shell("Coaching · Equipa Vida", formatData(input.data), `${input.pontos.length} ${input.pontos.length === 1 ? "ponto" : "pontos"} a reforçar`, body);
}

// ---------------------------------------------------------------------------
// Coordinator team summary (dashboard-style)
// ---------------------------------------------------------------------------
export interface ResumoCategoria {
  nome: string;
  obrigatoria: boolean;
  taxaPercent: number | null;
  exibePercentagem: boolean;
  absoluto: string;
  cobertura: number;
  cumprido: number;
  naoCumprido: number;
  pontoMaisFracoNome: string | null;
  pontoMaisFracoCriterio: string | null;
  pontoMaisFracoMensagem: string | null;
  pontoMaisFracoTaxa: number | null; // 0..1 — weakest point's compliance
  pontoMaisFracoAplicavel: number | null;
}
export interface ResumoKpis {
  chamadas: number;
  taxaPct: number | null;
  naoCumprido: number;
}

function rateColor(pct: number | null): string {
  if (pct === null) return MUTE;
  if (pct >= 70) return GREEN;
  if (pct >= 40) return AMBER;
  return RED;
}

function kpiCell(value: string, label: string, color: string): string {
  return `<td style="padding:14px 10px;text-align:center;border:1px solid ${LINE};background:${CARD}">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;color:${color}">${esc(value)}</div>
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:${MUTE};margin-top:4px">${esc(label)}</div>
  </td>`;
}

export function renderEquipaResumo(input: { data: string; kpis: ResumoKpis; categorias: ResumoCategoria[] }): string {
  const { kpis } = input;
  const kpiRow = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin-bottom:18px"><tr>
    ${kpiCell(String(kpis.chamadas), "Chamadas avaliadas", INK)}
    ${kpiCell(kpis.taxaPct !== null ? kpis.taxaPct + "%" : "—", "Taxa de cumprimento", rateColor(kpis.taxaPct))}
    ${kpiCell(String(kpis.naoCumprido), "Pontos não cumpridos", RED)}
  </tr></table>`;

  const cards = input.categorias
    .map((c) => {
      const taxa = c.exibePercentagem && c.taxaPercent !== null
        ? `<span style="font-family:Georgia,serif;font-size:22px;color:${rateColor(c.taxaPercent)}">${c.taxaPercent}%</span>`
        : `<span style="font-size:14px;color:${BODY}">${esc(c.absoluto)} <span style="color:${AMBER};font-size:11px">(amostra pequena)</span></span>`;
      const falha = c.pontoMaisFracoTaxa !== null
        ? `<div style="font-size:12px;color:${BODY};margin-top:6px;line-height:1.5"><span style="color:${MUTE}">O que está a falhar:</span> cumprido em apenas <strong style="color:${rateColor(Math.round(c.pontoMaisFracoTaxa * 100))}">${Math.round(c.pontoMaisFracoTaxa * 100)}%</strong>${c.pontoMaisFracoAplicavel !== null ? ` de ${c.pontoMaisFracoAplicavel} ${c.pontoMaisFracoAplicavel === 1 ? "chamada aplicável" : "chamadas aplicáveis"}` : ""}.</div>`
        : "";
      const melhoria = c.pontoMaisFracoMensagem
        ? `<div style="font-size:12px;color:${BODY};margin-top:5px;line-height:1.5"><strong style="color:${ORANGE}">Como melhorar:</strong> ${esc(c.pontoMaisFracoMensagem)}</div>`
        : "";
      const driver = c.pontoMaisFracoNome
        ? `<div style="margin-top:10px;padding:11px 13px;background:#fff8f0;border-left:3px solid ${AMBER};border-radius:0 6px 6px 0">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:${MUTE}">Ponto mais fraco · ${esc(c.pontoMaisFracoNome)}</div>
            <div style="font-size:13px;color:${INK};font-weight:600;margin-top:3px;line-height:1.4">${esc(c.pontoMaisFracoCriterio ?? c.pontoMaisFracoNome)}</div>
            ${falha}
            ${melhoria}
          </div>`
        : "";
      const obr = c.obrigatoria ? badge("Obrigatória", RED) : "";
      return `<tr><td style="padding:16px 18px;border:1px solid ${LINE};border-radius:8px;background:${CARD}">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:14px;font-weight:700;color:${INK};vertical-align:top">${esc(c.nome)}${obr}
            <div style="font-size:11px;color:${MUTE};font-weight:400;margin-top:2px">Cobertura: ${c.cobertura} ${c.cobertura === 1 ? "chamada" : "chamadas"}</div>
          </td>
          <td align="right" style="vertical-align:top">${taxa}</td>
        </tr></table>
        ${driver}
      </td></tr><tr><td style="height:10px"></td></tr>`;
    })
    .join("");

  const body = `<tr><td style="padding:24px 28px">
    <p style="font-size:14px;color:${BODY};margin:0 0 16px;line-height:1.55">Resumo de cumprimento do guião do 1.º telefonema da equipa Vida — vista por categoria.</p>
    ${kpiRow}
    <table width="100%" cellpadding="0" cellspacing="0">${cards}</table>
  </td></tr>`;
  return shell("Resumo Diário · Coordenação Vida", formatData(input.data), `${kpis.chamadas} chamadas`, body);
}
