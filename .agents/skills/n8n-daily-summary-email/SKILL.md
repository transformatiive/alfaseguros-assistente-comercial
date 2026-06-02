---
name: n8n-daily-summary-email
description: Build an n8n workflow that sends a daily HTML summary email with Alfaseguros Supervisor data (executive summary, operator coaching, stats) to up to 4 recipients. Use when asked to create, update, or configure the daily summary email workflow in n8n.
---

# n8n — Daily Summary Email Workflow

Sends a concise management briefing email every weekday morning. Design principle: **key insights at a glance, not a wall of text** — supervisors click through to the dashboard for the full narrative.

## API Details

**Base URL (production):** `https://alfaseguros-assistente-comercial.replit.app`

**Endpoint:** `GET /api/email/summary?date=YYYY-MM-DD`

**Auth header:** `Authorization: Bearer <FOLLOWUP_API_TOKEN>`

**Response shape:**
```json
{
  "date": "2026-06-01",
  "run_status": "completed",
  "executive_summary": "Texto livre...",
  "sections": {
    "working_well":                 { "paragraph": "...", "bullets": ["..."] },
    "to_improve":                   { "paragraph": "...", "bullets": ["..."] },
    "risks":                        { "paragraph": "...", "bullets": ["..."] },
    "closing_rate_recommendations": { "paragraph": "...", "bullets": ["..."] }
  },
  "operators": [
    { "name": "Ana Inácio", "overview": "...", "strengths": ["..."], "blind_spots": ["..."], "coaching": ["..."] }
  ],
  "stats": {
    "total_conversations": 75,
    "with_follow_up": 12,
    "operators_analyzed": 7
  }
}
```

Returns **404** if no analysis exists for that date.

---

## Workflow Nodes

### Node 1 — Schedule Trigger
- **Cron:** `0 8 * * 1-5` (Monday–Friday 08:00, timezone: `Europe/Lisbon`)

---

### Node 2 — Set Date
- **Type:** Code
```javascript
const { DateTime } = require('luxon');
const yesterday = DateTime.now()
  .setZone('Europe/Lisbon')
  .minus({ days: 1 })
  .toFormat('yyyy-MM-dd');
return [{ json: { date: yesterday } }];
```

---

### Node 3 — HTTP Request — Fetch Summary
- **Method:** GET
- **URL:** `https://alfaseguros-assistente-comercial.replit.app/api/email/summary`
- **Headers:** `Authorization: Bearer <FOLLOWUP_API_TOKEN>`
- **Query params:** `date` = `{{ $json.date }}`
- **Response format:** JSON
- **On error:** Continue (IF node handles 404)

---

### Node 4 — IF — Has Analysis?
- **Condition:** `{{ $json.executive_summary }}` is not empty
- **False branch** → stop (or send 1-line "sem análise hoje" alert to 1 person)

---

### Node 5 — Code — Format HTML Email (concise digest)

Design: stats bar → executive hook (2 sentences) → 3 columns (bem / melhorar / riscos) → operator table → CTA button.

```javascript
const d = $input.first().json;
const BASE = 'https://alfaseguros-assistente-comercial.replit.app';

// Take at most N items from an array
const top = (arr = [], n = 3) => arr.slice(0, n);

// Render a compact bullet list (no paragraph)
const bullets = (arr = [], max = 3) =>
  top(arr, max).map(b => `<li style="margin:4px 0">${b}</li>`).join('');

// 3-column section card
const card = (emoji, title, color, arr) => `
  <td style="width:33%;vertical-align:top;padding:0 6px">
    <div style="background:#fff;border-radius:8px;padding:14px;border-top:3px solid ${color}">
      <p style="margin:0 0 8px;font-weight:600;font-size:13px">${emoji} ${title}</p>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151">
        ${bullets(d.sections[arr]?.bullets, 3) || '<li style="color:#9ca3af">Sem dados</li>'}
      </ul>
    </div>
  </td>`;

// Operator rows — name + first coaching point only
const operatorRows = (d.operators || []).map(op => {
  const coaching = op.coaching?.[0] || op.blind_spots?.[0] || '—';
  return `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 12px;font-size:13px;font-weight:500">${op.name}</td>
      <td style="padding:8px 12px;font-size:13px;color:#6b7280">${coaching}</td>
    </tr>`;
}).join('');

// Executive hook: first 2 sentences of executive_summary
const hook = d.executive_summary
  .split(/(?<=[.!?])\s+/)
  .slice(0, 2)
  .join(' ');

const subject =
  `Alfaseguros ${d.date} · ${d.stats.total_conversations} chamadas · ${d.stats.with_follow_up} follow-ups`;

const html = `
<!DOCTYPE html>
<html lang="pt">
<body style="margin:0;padding:16px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:620px;margin:0 auto">

  <!-- Header -->
  <div style="background:#1e3a8a;border-radius:10px 10px 0 0;padding:18px 24px;color:#fff">
    <div style="font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.05em">Alfaseguros · Resumo Diário</div>
    <div style="font-size:20px;font-weight:700;margin:4px 0">${d.date}</div>
  </div>

  <!-- Stats bar -->
  <div style="background:#1d4ed8;padding:10px 24px;display:flex;gap:24px">
    <table width="100%"><tr>
      <td style="color:#bfdbfe;font-size:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#fff">${d.stats.total_conversations}</div>
        Conversas
      </td>
      <td style="color:#bfdbfe;font-size:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#fff">${d.stats.with_follow_up}</div>
        Follow-ups
      </td>
      <td style="color:#bfdbfe;font-size:12px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#fff">${d.stats.operators_analyzed}</div>
        Operadores
      </td>
    </tr></table>
  </div>

  <!-- Body -->
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;padding:20px 16px;border-radius:0 0 10px 10px">

    <!-- Executive hook -->
    <p style="margin:0 0 16px;font-size:14px;color:#111827;line-height:1.6">${hook}</p>

    <!-- 3-column cards -->
    <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px">
      <tr>
        ${card('✅', 'A funcionar bem', '#16a34a', 'working_well')}
        ${card('🔧', 'A melhorar', '#d97706', 'to_improve')}
        ${card('🔴', 'Riscos', '#dc2626', 'risks')}
      </tr>
    </table>

    <!-- Operator table -->
    <div style="background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;margin-bottom:20px">
      <div style="background:#f8fafc;padding:10px 12px;font-size:12px;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">
        👥 COACHING POR OPERADOR
      </div>
      <table width="100%" cellspacing="0">
        <tr style="background:#f8fafc">
          <th style="text-align:left;padding:6px 12px;font-size:11px;color:#6b7280;font-weight:500">OPERADOR</th>
          <th style="text-align:left;padding:6px 12px;font-size:11px;color:#6b7280;font-weight:500">FOCO DO DIA</th>
        </tr>
        ${operatorRows}
      </table>
    </div>

    <!-- CTA -->
    <div style="text-align:center;padding:8px 0">
      <a href="${BASE}" style="background:#1e3a8a;color:#fff;text-decoration:none;padding:10px 28px;border-radius:6px;font-size:14px;font-weight:600;display:inline-block">
        Ver análise completa →
      </a>
    </div>

  </div>
</div>
</body>
</html>`;

return [{ json: { subject, html, date: d.date } }];
```

---

### Node 6 — Send Email (Gmail)
- **Credential:** `Z4rHBBPLO1c6UeeY` (Gmail account)
- **To:** os 4 endereços (separados por vírgula)
- **Subject:** `{{ $json.subject }}`
- **Email format:** HTML
- **HTML body:** `{{ $json.html }}`

---

### Node 7 (opcional) — Alert "Sem análise"
- Branch False do Node 4
- Envia email curto apenas ao responsável
- Subject: `⚠️ Alfaseguros {{ $('Set Date').item.json.date }} — sem análise disponível`

---

## Testing

Para testar manualmente: no Schedule Trigger, clicar **Execute Workflow** e forçar `date = 2026-05-04` no Node 2 (data com análise real na BD). Verificar que o email chega com 75 conversas e 7 operadores.
