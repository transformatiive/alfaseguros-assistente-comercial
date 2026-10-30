/**
 * Server-side HTML for the /leads dashboard. Pure string rendering — no
 * framework, no JS, no SVG/Canvas. Inline CSS + a <style> block in <head>,
 * brand palette matching the email templates.
 */
import type { LeadsView, Carga } from "./compute.js";
import { CHANNELS } from "./channels.js";
import { formatDDMM } from "./compute.js";
import { LOGO } from "../lib/email-template.js";
import { urlDoDesk } from "../painel/tickets-risco.js";

const MAROON = "#762023";
const ORANGE = "#E87D1D";
const INK = "#1f2933";
const MUTE = "#7b8794";
const LINE = "#e4e7eb";
const BG = "#f5f6f7";
const CARD = "#ffffff";
const GREEN = "#0a7d3f";
const RED = "#c0392b";

const DESK_TICKET_URL = (id: string) => urlDoDesk(id);

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
  .custom{display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:${CARD};border:1px solid ${LINE};border-radius:6px;padding:6px 8px}
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
  .pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px;color:${MUTE};font-size:13px}
  .muted{color:${MUTE}}
  .err{background:${CARD};border:1px solid ${LINE};border-left:4px solid ${RED};border-radius:8px;padding:20px;margin-top:24px}
  /* Vertical bar chart (evolução semanal) */
  .vchart{display:flex;align-items:flex-end;gap:6px;height:180px;padding-top:8px}
  .vcol{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
  .vcol .vnum{font-size:11px;font-weight:bold;color:${INK};margin-bottom:4px}
  .vcol .vbar{width:60%;max-width:34px;border-radius:4px 4px 0 0;min-height:3px}
  .vcol .vlbl{font-size:10px;color:${MUTE};margin-top:6px;white-space:nowrap}
  /* Channel breakdown rows */
  .chrow{padding:12px 0;border-bottom:1px solid ${LINE}}
  .chrow:last-child{border-bottom:0}
  .chrow .chtop{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .chrow .chval{font-size:18px;font-weight:bold;color:${INK};font-variant-numeric:tabular-nums}
  .chrow .chbar-track{background:${BG};border-radius:5px;height:10px;width:100%;overflow:hidden;margin:7px 0 6px}
  .chrow .chbar-fill{height:10px;border-radius:5px}
  .chrow .chmeta{font-size:11.5px;color:${MUTE}}
  .chrow .chmeta b{color:${INK};font-weight:600}
  .chrow .chbar-track.seg{display:flex}
  .chrow .chbar-track.seg span{display:block;height:10px}
  .new-note{font-size:12px;color:${MUTE};margin:-4px 0 10px}
  select{border:1px solid ${LINE};border-radius:4px;padding:5px;font-size:13px;background:${CARD};color:${INK};max-width:190px}
  .pill{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:bold;white-space:nowrap}
  .pill.hi{background:#fbeaea;color:${RED}}
  .pill.mid{background:#fdf3e1;color:#b7791f}
  .pill.ok{background:#e7f4ec;color:${GREEN}}
  .legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 10px;font-size:11.5px;color:${MUTE}}
  .legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}
  .person{display:grid;grid-template-columns:200px 1fr 60px 130px;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid ${LINE}}
  .person:last-child{border-bottom:0}
  .person .nm{font-weight:bold;font-size:13px;min-width:0}
  .person .nm small{display:block;font-weight:normal;color:${MUTE};font-size:11px}
  .person .ptrack{display:flex;background:${BG};border-radius:5px;height:14px;overflow:hidden}
  .person .ptrack span{display:block;height:14px}
  .person .n{text-align:right;font-weight:bold;font-variant-numeric:tabular-nums}
  .scroll{overflow-x:auto}
  td.heat{text-align:center;font-variant-numeric:tabular-nums;font-weight:bold}
  tr.tot td{font-weight:bold;background:${BG}}
  .hide-mobile{}
  @media (max-width:680px){
    .kpis{grid-template-columns:repeat(2,1fr)}
    .header .brand{font-size:19px}
    .vchart{height:150px;gap:3px}
    .vcol .vlbl{font-size:8px}
    .vcol .vnum{font-size:9px}
    .hide-mobile{display:none}
    .person{grid-template-columns:1fr 50px}
    .person .ptrack,.person .stt{grid-column:1 / -1}
  }
</style></head><body>${body}</body></html>`;
}

function header(periodLabel: string): string {
  return `<div class="header"><div class="inner">
    <div>
      <img src="${LOGO}" height="30" alt="Alfa Seguros" style="display:block;height:30px;border:0">
      <div class="sub" style="margin-top:7px;letter-spacing:1.5px;text-transform:uppercase;font-size:11px">Dashboard de Leads</div>
    </div>
    <div class="period-label">${esc(periodLabel)}</div>
  </div></div>`;
}

function periodLabelText(v: LeadsView): string {
  const names: Record<string, string> = { hoje: "Hoje", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias", "90d": "Últimos 90 dias", custom: "Período personalizado" };
  return `${names[v.period.preset] ?? "Período"} · ${formatDDMM(v.period.from)} – ${formatDDMM(v.period.to)}`;
}

/** Query string for the active canal/tipo/pessoa filters, starting with "&". */
function filterQs(v: LeadsView): string {
  const f = v.filters;
  return (
    (f.canal ? `&canal=${encodeURIComponent(f.canal)}` : "") +
    (f.tipo ? `&tipo=${encodeURIComponent(f.tipo)}` : "") +
    (f.pessoa ? `&pessoa=${encodeURIComponent(f.pessoa)}` : "")
  );
}

function filters(v: LeadsView, base: string): string {
  const presets: Array<[string, string]> = [["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["90d", "90 dias"]];
  const fq = filterQs(v);
  const btns = presets
    .map(([key, label]) => `<a class="btn${v.period.preset === key ? " active" : ""}" href="${base}?preset=${key}${fq}">${label}</a>`)
    .join("");
  const opt = (value: string, label: string, current?: string) =>
    `<option value="${esc(value)}"${current === value ? " selected" : ""}>${esc(label)}</option>`;
  const canal = `<select name="canal" id="f-canal" aria-label="Canal">${opt("", "Canal: todos", v.filters.canal)}${CHANNELS.map((c) => opt(c.key, c.label, v.filters.canal)).join("")}</select>`;
  const tipo = `<select name="tipo" id="f-tipo" aria-label="Tipo de lead">${opt("", "Tipo: todos", v.filters.tipo)}${v.opcoes.tipos.map((t) => opt(t, t, v.filters.tipo)).join("")}</select>`;
  const pessoa = `<select name="pessoa" id="f-pessoa" aria-label="Responsável">${opt("", "Pessoa: todas", v.filters.pessoa)}${v.opcoes.pessoas.map((p) => opt(p, p, v.filters.pessoa)).join("")}</select>`;
  const custom = `<form class="custom" method="get" action="${base}">
    <span class="muted">De</span><input type="date" name="from" value="${esc(v.period.from)}">
    <span class="muted">a</span><input type="date" name="to" value="${esc(v.period.to)}">
    ${canal}${tipo}${pessoa}
    <button type="submit">Aplicar</button>
  </form>`;
  const clear = fq ? `<a class="btn" href="${base}?preset=${v.period.preset}${v.period.preset === "custom" ? `&from=${v.period.from}&to=${v.period.to}` : ""}">Limpar filtros</a>` : "";
  return `<div class="filters">${btns}${custom}${clear}</div>`;
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
  </div>
  <div class="kpis">
    <div class="kpi"><div class="v small">${v.abertos}</div><div class="l">Leads em aberto</div></div>
    <div class="kpi"><div class="v small"${v.semResponsavel > 0 ? ` style="color:${RED}"` : ""}>${v.semResponsavel}</div><div class="l">Leads sem responsável</div></div>
    <div class="kpi"><div class="v small">${v.mediaPorPessoa}</div><div class="l">Média de leads por pessoa</div></div>
    <div class="kpi"><div class="v small">${v.pessoas.filter((p) => p.carga === "acima30").length}</div><div class="l">Pessoas &gt;30% acima da média</div></div>
  </div>`;
}

function weeksChart(v: LeadsView): string {
  if (v.weeks.length === 0) return "";
  const max = Math.max(1, ...v.weeks.map((w) => w.count));
  const cols = v.weeks
    .map((w) => {
      const h = Math.max(3, Math.round((w.count / max) * 150));
      const color = w.isLatestComplete ? ORANGE : MAROON;
      return `<div class="vcol" title="${esc(w.label)}: ${w.count}">
        <div class="vnum">${w.count}</div>
        <div class="vbar" style="height:${h}px;background:${color}"></div>
        <div class="vlbl">${esc(w.label)}</div>
      </div>`;
    })
    .join("");
  return `<div class="section-title">Evolução semanal</div>
    <div class="card"><div class="vchart">${cols}</div>
    <div class="muted" style="margin-top:10px;font-size:12px">Leads por semana (início à segunda-feira). A laranja: semana completa mais recente.</div></div>`;
}

function breakdownTable(v: LeadsView): string {
  // Bar length = leads in the SELECTED period (the bold number), so the visual
  // and the headline figure always agree. Ontem/7d/30d are secondary context.
  const maxTotal = Math.max(1, ...v.breakdown.map((b) => b.total));
  const rows = v.breakdown
    .map((b) => {
      let delta = `<span class="muted">→ 0</span>`;
      if (b.delta > 0) delta = `<span class="pos">▲ +${b.delta}</span>`;
      else if (b.delta < 0) delta = `<span class="neg">▼ ${b.delta}</span>`;
      return `<div class="chrow">
        <div class="chtop">
          <span class="chip" style="background:${b.color}">${esc(b.label)}</span>
          <span class="chval">${b.total}</span>
        </div>
        <div class="chbar-track seg">${b.tipos
          .map((t, i) => (t.count > 0 ? `<span title="${esc(t.tipo)}: ${t.count}" style="width:${(t.count / maxTotal) * 100}%;background:${b.color};opacity:${(1 - i * 0.13).toFixed(2)}"></span>` : ""))
          .join("")}</div>
        <div class="chmeta">no período · ${delta} vs anterior &nbsp;·&nbsp; ontem <b>${b.ontem}</b> · 7d <b>${b.d7}</b> · 30d <b>${b.d30}</b>${topTipos(b.tipos)}</div>
      </div>`;
    })
    .join("");
  return `<div class="section-title">Por canal</div>
    <div class="card">
      <div class="muted" style="font-size:12px;margin-bottom:6px">A barra e o número grande representam os leads no período seleccionado (${formatDDMM(v.period.from)}–${formatDDMM(v.period.to)}).</div>
      ${rows}
    </div>`;
}

function topTipos(tipos: Array<{ tipo: string; count: number }>): string {
  const top = tipos.filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  if (top.length === 0) return "";
  return ` &nbsp;|&nbsp; ${top.map((t) => `${esc(t.tipo)} <b>${t.count}</b>`).join(" · ")}`;
}

function tipoTable(v: LeadsView): string {
  const tipos = v.tipos.map((t) => t.tipo);
  const head = `<tr><th>Canal</th>${tipos.map((t) => `<th class="num">${esc(t)}</th>`).join("")}<th class="num">Total</th></tr>`;
  const rows = v.breakdown
    .filter((b) => b.total > 0)
    .map(
      (b) =>
        `<tr><td><span class="chip" style="background:${b.color}">${esc(b.label)}</span></td>${b.tipos
          .map((t) => `<td class="num">${t.count || '<span class="muted">·</span>'}</td>`)
          .join("")}<td class="num"><b>${b.total}</b></td></tr>`,
    )
    .join("");
  const tot = `<tr class="tot"><td>Total</td>${v.tipos.map((t) => `<td class="num">${t.total}</td>`).join("")}<td class="num">${v.total}</td></tr>`;
  return `<div class="section-title">Tipo de lead por canal</div>
    <div class="card"><div class="scroll"><table>${head}${rows}${tot}</table></div>
    <div class="muted" style="font-size:12px;margin-top:8px">Tipo = ramo do seguro, lido do assunto do ticket. O que não dá para classificar fica em "Outros".</div></div>`;
}

const CARGA_PILL: Record<Carga, string> = {
  acima30: '<span class="pill hi">Mais de 30% acima</span>',
  acima10: '<span class="pill mid">10% a 30% acima</span>',
  media: '<span class="pill ok">Dentro da média</span>',
  sem_responsavel: '<span class="pill hi">Por atribuir</span>',
};

function peopleSection(v: LeadsView): string {
  if (v.pessoas.length === 0) {
    return `<div class="section-title">Quem está a tratar as leads</div><div class="card muted">Sem leads neste período.</div>`;
  }
  const max = Math.max(1, ...v.pessoas.map((p) => p.total));
  const legend = CHANNELS.map((c) => `<span><i style="background:${c.color}"></i>${esc(c.label)}</span>`).join("");
  const rows = v.pessoas
    .map((p) => {
      const seg = CHANNELS.map((c) => {
        const n = p.porCanal[c.key] ?? 0;
        return n > 0 ? `<span title="${esc(c.label)}: ${n}" style="width:${(n / max) * 100}%;background:${c.color}"></span>` : "";
      }).join("");
      return `<div class="person"><div class="nm">${esc(p.name)}<small>${p.abertos} em aberto</small></div>
        <div class="ptrack">${seg}</div><div class="n">${p.total}</div><div class="stt">${CARGA_PILL[p.carga]}</div></div>`;
    })
    .join("");
  return `<div class="section-title">Quem está a tratar as leads</div>
    <div class="card"><div class="legend">${legend}</div>${rows}
    <div class="muted" style="font-size:12px;margin-top:10px">Responsável atual de cada lead. Média: <b>${v.mediaPorPessoa}</b> leads por pessoa no período (só pessoas com leads). "Em aberto" = ticket ainda não fechado, segundo o Supervisor Virtual.</div></div>`;
}

function channelPersonTable(v: LeadsView): string {
  if (v.pessoas.length === 0) return "";
  const used = CHANNELS.filter((c) => v.pessoas.some((p) => (p.porCanal[c.key] ?? 0) > 0));
  const maxCell = Math.max(1, ...v.pessoas.flatMap((p) => used.map((c) => p.porCanal[c.key] ?? 0)));
  const head = `<tr><th>Pessoa</th>${used.map((c) => `<th class="num" title="${esc(c.label)}">${esc(c.label.split(" ")[0])}</th>`).join("")}<th class="num">Total</th><th class="num">Em aberto</th></tr>`;
  const rows = v.pessoas
    .map(
      (p) =>
        `<tr><td style="white-space:nowrap">${esc(p.name)}</td>${used
          .map((c) => {
            const n = p.porCanal[c.key] ?? 0;
            const a = n ? (0.12 + (0.6 * n) / maxCell).toFixed(2) : "0";
            return `<td class="heat" style="background:rgba(232,125,29,${a})">${n || '<span class="muted" style="font-weight:normal">·</span>'}</td>`;
          })
          .join("")}<td class="num"><b>${p.total}</b></td><td class="num">${p.abertos}</td></tr>`,
    )
    .join("");
  const tot = `<tr class="tot"><td>Total</td>${used
    .map((c) => `<td class="num">${v.pessoas.reduce((a, p) => a + (p.porCanal[c.key] ?? 0), 0)}</td>`)
    .join("")}<td class="num">${v.total}</td><td class="num">${v.abertos}</td></tr>`;
  return `<div class="section-title">Canal × pessoa</div>
    <div class="card"><div class="muted" style="font-size:12px;margin-bottom:8px">Quantas leads de cada canal foram para cada pessoa. Quanto mais escuro, mais leads.</div>
    <div class="scroll"><table>${head}${rows}${tot}</table></div></div>`;
}

function pager(v: LeadsView, base: string): string {
  if (v.totalPages <= 1) return "";
  const q = (p: number) => `${base}?preset=${v.period.preset}&from=${v.period.from}&to=${v.period.to}${filterQs(v)}&page=${p}`;
  const prev = v.page > 1 ? `<a class="btn" href="${q(v.page - 1)}">‹ Anteriores</a>` : "";
  const next = v.page < v.totalPages ? `<a class="btn" href="${q(v.page + 1)}">Seguintes ›</a>` : "";
  return `<div class="pager">${prev}<span>Página ${v.page} de ${v.totalPages}</span>${next}</div>`;
}

function leadsTable(v: LeadsView, base: string): string {
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
        <td>${esc(r.tipo)}</td>
        <td style="white-space:nowrap">${r.assigneeId ? esc(r.assigneeName) : '<span class="pill hi">Sem responsável</span>'}</td>
        <td>${esc(r.status)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="section-title">Leads (${v.totalInPeriod})</div>
    <div class="card"><div class="scroll"><table>
      <thead><tr><th>Data</th><th>Canal</th><th class="hide-mobile">Assunto</th><th>Tipo</th><th>Responsável</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${pager(v, base)}</div>`;
}

/** `base` is the dashboard's own URL path (e.g. "/leads" or "/api/leads") so
 *  filter/pagination links resolve to the same route regardless of mount. */
export function renderLeadsPage(v: LeadsView, base: string): string {
  const body = `${header(periodLabelText(v))}
  <div class="wrap">
    ${filters(v, base)}
    ${kpis(v)}
    ${weeksChart(v)}
    ${breakdownTable(v)}
    ${tipoTable(v)}
    ${peopleSection(v)}
    ${channelPersonTable(v)}
    ${leadsTable(v, base)}
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
