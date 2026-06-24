/**
 * Server-side HTML for the /leads dashboard. Pure string rendering — no
 * framework, no JS, no SVG/Canvas. Inline CSS + a <style> block in <head>,
 * brand palette matching the email templates.
 */
import type { LeadsView } from "./compute.js";
import { formatDDMM } from "./compute.js";

const MAROON = "#762023";
const ORANGE = "#E87D1D";
const INK = "#1f2933";
const MUTE = "#7b8794";
const LINE = "#e4e7eb";
const BG = "#f5f6f7";
const CARD = "#ffffff";
const GREEN = "#0a7d3f";
const RED = "#c0392b";

const DESK_TICKET_URL = (id: string) => `https://desk.zoho.com/support/alfaseguros/ShowHomePage.do#Cases/dv/${encodeURIComponent(id)}`;

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(body: string): string {
  return `<!DOCTYPE html><html lang="pt"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Dashboard de Leads · Alfa Seguros</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:${BG};color:${INK};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}
  a{color:inherit}
  .wrap{max-width:980px;margin:0 auto;padding:0 14px 48px}
  .header{background:${MAROON};color:#fff;padding:20px 0}
  .header .inner{max-width:980px;margin:0 auto;padding:0 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
  .header .brand{font-size:22px;font-weight:bold;letter-spacing:.3px}
  .header .sub{font-size:13px;color:rgba(255,255,255,.78);margin-top:2px}
  .header .period-label{font-size:13px;color:rgba(255,255,255,.9)}
  .section-title{color:${MAROON};font-size:15px;font-weight:bold;margin:26px 0 12px}
  .filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:18px 0 4px}
  .btn{display:inline-block;padding:8px 14px;border-radius:6px;border:1px solid ${LINE};background:${CARD};color:${INK};text-decoration:none;font-size:13px}
  .btn.active{background:${ORANGE};border-color:${ORANGE};color:#fff;font-weight:bold}
  .custom{display:flex;gap:6px;align-items:center;background:${CARD};border:1px solid ${LINE};border-radius:6px;padding:6px 8px}
  .custom input{border:1px solid ${LINE};border-radius:4px;padding:5px;font-size:13px}
  .custom button{background:${MAROON};color:#fff;border:0;border-radius:4px;padding:6px 10px;font-size:13px;cursor:pointer}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:14px}
  .kpi{background:${CARD};border:1px solid ${LINE};border-radius:8px;padding:16px}
  .kpi .v{font-size:30px;font-weight:bold;color:${ORANGE};line-height:1.1}
  .kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:${MUTE};margin-top:6px}
  .kpi .v.small{font-size:20px}
  .card{background:${CARD};border:1px solid ${LINE};border-radius:8px;padding:16px}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:9px 8px;border-bottom:1px solid ${LINE};font-size:13px;vertical-align:middle}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:${MUTE};font-weight:bold}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .bar-track{background:${BG};border-radius:4px;height:16px;width:100%;overflow:hidden}
  .bar-fill{height:16px;border-radius:4px}
  .chip{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;color:#fff;white-space:nowrap}
  .pos{color:${GREEN};font-weight:bold}
  .neg{color:${RED};font-weight:bold}
  .week-row td{border-bottom:1px solid ${LINE}}
  .pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px;color:${MUTE};font-size:13px}
  .muted{color:${MUTE}}
  .err{background:${CARD};border:1px solid ${LINE};border-left:4px solid ${RED};border-radius:8px;padding:20px;margin-top:24px}
  .hide-mobile{}
  @media (max-width:680px){
    .kpis{grid-template-columns:repeat(2,1fr)}
    .header .brand{font-size:19px}
    .hide-mobile{display:none}
  }
</style></head><body>${body}</body></html>`;
}

function header(periodLabel: string): string {
  return `<div class="header"><div class="inner">
    <div><div class="brand">Alfa Seguros</div><div class="sub">Dashboard de Leads</div></div>
    <div class="period-label">${esc(periodLabel)}</div>
  </div></div>`;
}

function periodLabelText(v: LeadsView): string {
  const names: Record<string, string> = { hoje: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", "90d": "Últimos 90 dias", custom: "Período personalizado" };
  return `${names[v.period.preset] ?? "Período"} · ${formatDDMM(v.period.from)} – ${formatDDMM(v.period.to)}`;
}

function filters(v: LeadsView): string {
  const presets: Array<[string, string]> = [["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["90d", "90 dias"]];
  const btns = presets
    .map(([key, label]) => `<a class="btn${v.period.preset === key ? " active" : ""}" href="/leads?preset=${key}">${label}</a>`)
    .join("");
  const custom = `<form class="custom" method="get" action="/leads">
    <span class="muted">De</span><input type="date" name="from" value="${esc(v.period.from)}">
    <span class="muted">a</span><input type="date" name="to" value="${esc(v.period.to)}">
    <button type="submit">Aplicar</button>
  </form>`;
  return `<div class="filters">${btns}${custom}</div>`;
}

function kpis(v: LeadsView): string {
  let varHtml = `<span class="muted">—</span>`;
  if (v.variacaoPct !== null) {
    const cls = v.variacaoPct >= 0 ? "pos" : "neg";
    const sign = v.variacaoPct > 0 ? "+" : "";
    varHtml = `<span class="${cls}">${sign}${v.variacaoPct}%</span>`;
  }
  const top = v.canalMaisActivo ? `${esc(v.canalMaisActivo.label)}` : "—";
  const topVol = v.canalMaisActivo ? `${v.canalMaisActivo.volume} leads` : "";
  return `<div class="kpis">
    <div class="kpi"><div class="v">${v.total}</div><div class="l">Leads no período</div></div>
    <div class="kpi"><div class="v">${v.mediaDiaria}</div><div class="l">Média diária</div></div>
    <div class="kpi"><div class="v small">${esc(top)}</div><div class="l">Canal mais activo${topVol ? ` · ${esc(topVol)}` : ""}</div></div>
    <div class="kpi"><div class="v small">${varHtml}</div><div class="l">vs período anterior (${v.prevTotal})</div></div>
  </div>`;
}

function weeksChart(v: LeadsView): string {
  if (v.weeks.length === 0) return "";
  const max = Math.max(1, ...v.weeks.map((w) => w.count));
  const rows = v.weeks
    .map((w) => {
      const pct = Math.round((w.count / max) * 100);
      const color = w.isLatestComplete ? ORANGE : MAROON;
      return `<tr class="week-row">
        <td style="width:64px;color:${MUTE};white-space:nowrap">${esc(w.label)}</td>
        <td><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div></td>
        <td class="num" style="width:48px;font-weight:bold">${w.count}</td>
      </tr>`;
    })
    .join("");
  return `<div class="section-title">Evolução semanal</div>
    <div class="card"><table>${rows}</table>
    <div class="muted" style="margin-top:8px;font-size:12px">A laranja: semana completa mais recente.</div></div>`;
}

function breakdownTable(v: LeadsView): string {
  const maxTotal = Math.max(1, ...v.breakdown.map((b) => b.total));
  const rows = v.breakdown
    .map((b) => {
      const pct = Math.round((b.total / maxTotal) * 100);
      let delta = `<span class="muted">0</span>`;
      if (b.delta > 0) delta = `<span class="pos">+${b.delta}</span>`;
      else if (b.delta < 0) delta = `<span class="neg">${b.delta}</span>`;
      return `<tr>
        <td><span class="chip" style="background:${b.color}">${esc(b.label)}</span>
          <div class="bar-track" style="margin-top:6px;max-width:220px"><div class="bar-fill" style="width:${pct}%;background:${b.color}"></div></div></td>
        <td class="num">${b.ontem}</td>
        <td class="num">${b.d7}</td>
        <td class="num">${b.d30}</td>
        <td class="num" style="font-weight:bold">${b.total}</td>
        <td class="num">${delta}</td>
      </tr>`;
    })
    .join("");
  return `<div class="section-title">Por canal</div>
    <div class="card"><table>
      <thead><tr><th>Canal</th><th class="num">Ontem</th><th class="num">7d</th><th class="num">30d</th><th class="num">Período</th><th class="num">Δ ant.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function pager(v: LeadsView): string {
  if (v.totalPages <= 1) return "";
  const q = (p: number) => `/leads?preset=${v.period.preset}&from=${v.period.from}&to=${v.period.to}&page=${p}`;
  const prev = v.page > 1 ? `<a class="btn" href="${q(v.page - 1)}">‹ Anteriores</a>` : "";
  const next = v.page < v.totalPages ? `<a class="btn" href="${q(v.page + 1)}">Seguintes ›</a>` : "";
  return `<div class="pager">${prev}<span>Página ${v.page} de ${v.totalPages}</span>${next}</div>`;
}

function leadsTable(v: LeadsView): string {
  if (v.pageRows.length === 0) {
    return `<div class="section-title">Leads</div><div class="card muted">Sem leads neste período.</div>`;
  }
  const rows = v.pageRows
    .map((r) => {
      const date = `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}`;
      return `<tr>
        <td style="white-space:nowrap">${esc(date)}</td>
        <td><span class="chip" style="background:${r.channelColor}">${esc(r.channelLabel)}</span></td>
        <td class="hide-mobile"><a href="${DESK_TICKET_URL(r.id)}" target="_blank" rel="noopener">${esc(r.subject || "(sem assunto)")}</a></td>
        <td>${esc(r.status)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="section-title">Leads (${v.totalInPeriod})</div>
    <div class="card"><table>
      <thead><tr><th>Data</th><th>Canal</th><th class="hide-mobile">Assunto</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${pager(v)}</div>`;
}

export function renderLeadsPage(v: LeadsView): string {
  const body = `${header(periodLabelText(v))}
  <div class="wrap">
    ${filters(v)}
    ${kpis(v)}
    ${weeksChart(v)}
    ${breakdownTable(v)}
    ${leadsTable(v)}
  </div>`;
  return shell(body);
}

export function renderErrorPage(message: string): string {
  const body = `${header("")}
  <div class="wrap">
    <div class="err">
      <div style="font-weight:bold;color:${RED};margin-bottom:6px">Não foi possível carregar o dashboard</div>
      <div class="muted">${esc(message)}</div>
    </div>
  </div>`;
  return shell(body);
}
