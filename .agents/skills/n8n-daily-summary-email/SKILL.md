---
name: n8n-daily-summary-email
description: Build an n8n workflow that sends a daily HTML summary email with Alfaseguros Supervisor data (executive summary, operator coaching, stats) to up to 4 recipients. Use when asked to create, update, or configure the daily summary email workflow in n8n.
---

# n8n — Daily Summary Email Workflow

Sends a formatted HTML email every weekday morning with the previous day's analysis from the Alfaseguros Supervisor dashboard.

## API Details

**Base URL (production):** `https://alfaseguros-assistente-comercial.replit.app`

**Endpoint:** `GET /api/email/summary?date=YYYY-MM-DD`

**Auth header:** `Authorization: Bearer <FOLLOWUP_API_TOKEN>`
(same token used for `/api/followups/*`)

**Response shape:**
```json
{
  "date": "2026-06-01",
  "run_status": "completed",
  "executive_summary": "Texto livre do resumo executivo...",
  "sections": {
    "working_well":                  { "paragraph": "...", "bullets": ["..."] },
    "to_improve":                    { "paragraph": "...", "bullets": ["..."] },
    "risks":                         { "paragraph": "...", "bullets": ["..."] },
    "closing_rate_recommendations":  { "paragraph": "...", "bullets": ["..."] }
  },
  "operators": [
    {
      "name": "Ana Inácio",
      "overview": "...",
      "strengths": ["..."],
      "blind_spots": ["..."],
      "coaching": ["..."]
    }
  ],
  "stats": {
    "total_conversations": 75,
    "with_follow_up": 12,
    "operators_analyzed": 7
  }
}
```

Returns **404** if no analysis exists for that date (analysis not yet run, or weekend).

---

## Workflow Nodes

### Node 1 — Schedule Trigger
- **Type:** Schedule Trigger
- **Cron expression:** `0 8 * * 1-5`
  (Monday–Friday at 08:00; adjust to local n8n timezone → set to `Europe/Lisbon`)

---

### Node 2 — Set Date
- **Type:** Code (or Set node)
- **Purpose:** Compute yesterday's date in Lisbon time (the analysis runs for the previous day)
- **Code (JavaScript):**
```javascript
const { DateTime } = require('luxon');
const yesterday = DateTime.now()
  .setZone('Europe/Lisbon')
  .minus({ days: 1 })
  .toFormat('yyyy-MM-dd');

return [{ json: { date: yesterday } }];
```
- If the analysis runs same-day (and the email is sent after the run completes), use `.toFormat('yyyy-MM-dd')` without `.minus({ days: 1 })`.

---

### Node 3 — HTTP Request — Fetch Summary
- **Type:** HTTP Request
- **Method:** GET
- **URL:** `https://alfaseguros-assistente-comercial.replit.app/api/email/summary`
- **Authentication:** None (handled via header below)
- **Headers:**
  | Key | Value |
  |---|---|
  | `Authorization` | `Bearer <FOLLOWUP_API_TOKEN>` |
- **Query Parameters:**
  | Key | Value |
  |---|---|
  | `date` | `{{ $json.date }}` |
- **Response Format:** JSON
- **On Error:** Continue (so the IF node below can handle the 404 gracefully)

---

### Node 4 — IF — Has Analysis?
- **Type:** IF
- **Condition:** `{{ $json.executive_summary }}` **is not empty**
- **True** → proceed to format + send
- **False** → send a brief "no analysis" notification (optional) or stop

---

### Node 5 — Code — Format HTML Email
- **Type:** Code
- **Input:** output of Node 3
- **JavaScript:**
```javascript
const d = $input.first().json;

// Helper: render bullet list
const bullets = (arr = []) =>
  arr.length ? `<ul>${arr.map(b => `<li>${b}</li>`).join('')}</ul>` : '<p><em>Sem dados</em></p>';

// Helper: render a section
const section = (title, emoji, sec) => `
  <h2>${emoji} ${title}</h2>
  ${sec.paragraph ? `<p>${sec.paragraph}</p>` : ''}
  ${bullets(sec.bullets)}
`;

// Operator cards
const operatorCards = (d.operators || []).map(op => `
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:12px 0;">
    <h3 style="margin:0 0 8px">${op.name}</h3>
    ${op.overview ? `<p style="color:#374151">${op.overview}</p>` : ''}
    ${op.blind_spots?.length ? `
      <p><strong>⚠️ Pontos a melhorar:</strong></p>
      ${bullets(op.blind_spots)}
    ` : ''}
    ${op.coaching?.length ? `
      <p><strong>🎯 Recomendações:</strong></p>
      ${bullets(op.coaching)}
    ` : ''}
  </div>
`).join('');

const subject = `Alfaseguros ${d.date} — ${d.stats.total_conversations} conversas · ${d.stats.with_follow_up} follow-ups`;

const html = `
<!DOCTYPE html>
<html lang="pt">
<body style="font-family:sans-serif;max-width:700px;margin:0 auto;color:#111827">
  <div style="background:#1e40af;color:white;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Resumo Diário Alfaseguros</h1>
    <p style="margin:4px 0 0;opacity:.8">${d.date} · ${d.stats.total_conversations} conversas · ${d.stats.operators_analyzed} operadores</p>
  </div>

  <div style="padding:24px;background:#f9fafb;border:1px solid #e5e7eb;border-top:none">

    <h2 style="margin-top:0">📋 Resumo Executivo</h2>
    <p>${d.executive_summary}</p>

    ${section('O que está a funcionar bem', '✅', d.sections.working_well)}
    ${section('A melhorar', '🔧', d.sections.to_improve)}
    ${section('Riscos', '🔴', d.sections.risks)}
    ${section('Recomendações de fecho', '💡', d.sections.closing_rate_recommendations)}

    <h2>👥 Coaching por Operador</h2>
    ${operatorCards}

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="color:#6b7280;font-size:13px">
      Follow-ups pendentes: <strong>${d.stats.with_follow_up}</strong> ·
      <a href="https://alfaseguros-assistente-comercial.replit.app">Ver dashboard</a>
    </p>
  </div>
</body>
</html>
`;

return [{ json: { subject, html, date: d.date } }];
```

---

### Node 6 — Send Email
- **Type:** Gmail / SMTP / SendGrid (qualquer provider disponível no n8n)
- **To:** os 4 endereços de email (separados por vírgula no campo `To`)
- **Subject:** `{{ $json.subject }}`
- **Email Format:** HTML
- **HTML Body:** `{{ $json.html }}`

---

### Node 7 (opcional) — Send "No Analysis" Alert
- **Connected from:** Node 4 (branch False)
- **Type:** Send Email
- **Subject:** `Alfaseguros {{ $('Set Date').item.json.date }} — sem análise`
- **Body:** `Não existe análise para {{ $('Set Date').item.json.date }}. Verifique se o processo de análise foi executado.`
- **To:** apenas o supervisor/responsável (1 pessoa)

---

## Recipients (4 pessoas)

Preencher no Node 6 (campo **To**):
```
email1@alfaseguros.pt, email2@alfaseguros.pt, email3@alfaseguros.pt, email4@alfaseguros.pt
```

---

## Notes

- O `FOLLOWUP_API_TOKEN` está configurado nos secrets do Replit. Usar o mesmo valor no n8n como credencial ou variável de ambiente do workflow.
- O endpoint devolve 404 se a análise ainda não foi executada para esse dia — por isso o nó IF é importante.
- A análise diária corre tipicamente de madrugada; um email às 8h da manhã deve encontrar os dados prontos.
- Para testar manualmente, fazer um POST no Schedule Trigger node (`Execute Workflow`) com `date` = uma data com análise (ex: `2026-05-04`).
