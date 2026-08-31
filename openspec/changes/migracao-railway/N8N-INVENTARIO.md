# Inventário n8n — tarefa 7.1

> Instância: `https://trnsf.up.railway.app`. Varridos **464 workflows** (5 páginas
> da API REST) à procura de referências ao Replit. Data: 2026-08-31.
> O MCP do n8n não liga; foi usada a API REST.

## O essencial

48 workflows contêm `.replit.`. **Só 8 pertencem a esta aplicação.** Os outros 40
apontam para aplicações Replit **completamente diferentes** — Unicenter,
AI Travel Find, To Be., Zoho-Moloni middleware, AILE, AuditConsult, CJ Seguros.

**Repontar qualquer um desses partiria outros clientes.** Ficam fora de âmbito.

## Os 8 desta aplicação (`alfaseguros-assistente-comercial.replit.app`)

### Ativos — têm de ser repontados no cutover

| ID | Nome | Nó(s) | Endpoint |
|---|---|---|---|
| `4rx93UXKxdDdmPpY` | ALFASEGUROS: Supervisor Virtual — Daily Cron | `POST /api/run (yesterday)` | `/api/run` |
| `NLE1zb5d0QgkMn4A` | ALFASEGUROS: Supervisor Follow-up → Desk Task | `Get Pending Follow-ups`, `Ack Supervisor` | `/api/followups/pending`, `/api/followups/{{...}}` |
| `rcycpfaZf9wRY9EH` | ALFASEGUROS: Resumo Diário por Equipa (360/Vida/Corporate) | `Fetch Summary`, `Build 3 Emails`, `Linkify Conversas` | `/api/email/summary` + links no corpo do email |
| `3MXCukLS8jqcXzIy` | ALFASEGUROS: Email Diário de Leads (Rui) | `Build Email` | `/api/leads` |

### Inativos — repontar por higiene, sem urgência

| ID | Nome | Endpoint |
|---|---|---|
| `FOnGBolnhh2YcMLZ` | ALFASEGUROS: Resumo Diário por Email | `/api/email/summary` |
| `Kw1uOR925DiuZhPo` | ALFASEGUROS: Resumo Diário por Email (duplicado) | `/api/email/summary` |
| `XzGck1xzAAWsIM8F` | ALFASEGUROS: Alertas Checklist Vida — Digest | `/api/alertas-dia`, `/api/alertas-dia/confirmar` |
| `qjEguhbYKdpSaQs6` | ALFASEGUROS: [TESTE] Exemplos com marca Vida 19-06 | `/api/alertas-dia`, `/api/resumo-checklist-dia` |

## O `design.md` estava incompleto

O `design.md` listava quatro chamadores: o cron, `/api/followups/pending`,
`/api/alertas-dia` e `/api/email/summary`. A varredura encontrou **mais dois
endpoints** que ninguém tinha listado:

- **`/api/leads`** — usado pelo `3MXCukLS8jqcXzIy`, que está **ativo**
- **`/api/resumo-checklist-dia`** — usado pelo `qjEguhbYKdpSaQs6`
- **`/api/followups/{{id}}`** (o *ack*) — o `design.md` só mencionava o `pending`
- **`/api/alertas-dia/confirmar`** — idem

O próprio `design.md` avisava para varrer em vez de assumir a lista completa.
Bem avisado: quatro endpoints teriam ficado de fora.

## Fora de âmbito — NÃO tocar

Estes têm `.replit.` mas são de **outras** aplicações. Listados para que ninguém
os inclua num "find and replace" distraído:

- `alfaseguros-lead-dashboard.replit.app` — `iMqihlx3X9nMOL9H` (ALFASEGUROS:
  Referenciação de Leads, **ativo**). É do cliente Alfaseguros mas é **outra
  aplicação**, que não faz parte desta migração.
- `zoho-moloni-middleware.replit.app` — FITTEST, keep-alives
- `deca-unicenter` / `questionarios-unicenter` / `unicenter-agendamento-cc` — Unicenter
- `aitravelfind.replit.app` — AI Travel Find
- `tobe-confirmacao-consulta` / `agenda-clinica-tobe` / `tobe-questionario-inflamacao` — To Be.
- `relatorios-ai-aile.replit.app` — AILE
- `audit-consult-semaforo.replit.app` — AuditConsult
- `egoi-sync-middleware.replit.app` — CJ Seguros
- `fleet-allocator.replit.app` — referido no Credential Vault
- `trns-weekly-planner.replit.app` — interno
- `riker.replit` no `ZKSE38f5mgq1ycEs` (Alfaseguros - Chatbot KB) — parece um host
  interno de base de dados do Replit, não um endpoint desta app. **Confirmar
  antes de mexer.**

## Estado

A tarefa **7.1 está feita**. A **7.2 (repontar) NÃO foi executada, de propósito.**

Repontar agora mandaria tráfego de produção para uma aplicação cuja base de dados
ainda está vazia: o cron das 07:00 correria contra nada, os emails diários sairiam
vazios e os follow-ups desapareceriam. A ordem do `tasks.md` é deliberada — a
secção 7 vem depois da 5 (dados) e da 6 (verificação).

### Quando chegar a altura

Substituir em cada nó:

```
https://alfaseguros-assistente-comercial.replit.app
→ https://supervisor-production-f030.up.railway.app
```

Os quatro ativos primeiro, um de cada vez, confirmando uma execução com sucesso
antes de passar ao seguinte. Só depois desligar o cron do Replit (tarefa 7.3),
sem apagar o deployment.
