# Project Context — Alfaseguros Supervisor Virtual

> Read this **first** if you're new to the project. It explains the *why*, not the *how*. For implementation details see [`CLAUDE.md`](./CLAUDE.md). For setup see [`README.md`](./README.md).

---

## The client: Alfaseguros

Alfaseguros is a Portuguese insurance broker (corretora de seguros). They sell policies on behalf of multiple insurance carriers (Tranquilidade, Lusitania, Fidelidade, etc.) — they are not the underwriter, they are the intermediary that helps the customer choose, simulate, and contract a policy.

Operating shape:

- **~10 people** in the call centre, taking inbound calls and emails, also walk-ins at the physical store
- Two main commercial teams:
  - **360 / Não Vida** — handles all non-life products: auto, TVDE, multirriscos, condomínio, saúde, empresas. Pipeline tracked in **Zoho Desk** (tickets).
  - **Vida** — handles life insurance. Pipeline tracked in **NoCRM**. *Out of scope for this project for now.*
- Primary channel for new lead intake is **phone (Ringover)** and **email-to-Desk**, plus a website with simulator forms that already pipe into Zoho CRM
- They also use **Único** as the back-office ERP (the standard ERP in the Portuguese broker ecosystem) for policies and recibos

Key people:

- **Rui** — CEO/owner. Sponsor of this project. Wants to fix conversion and team productivity.
- **Soraia** — internal Alfaseguros operations contact, point person for procedures and field/configuration confirmation
- **Diane** — also internal, present in the meeting where this was scoped
- **Hélio** — Vida team agent (out of scope, hard-filtered)
- **Marina, João, Andreia C., Vânia, Tiago, Ana, Daniela, Rute, Dina, Ligia, Inês, Cláudia, Beatriz, Ana R., Lara** — Não Vida / 360 team agents (in scope)

---

## The problems Rui wants solved

These come directly from the kickoff meeting transcript. Quoted in his own words where possible:

### 1. Closing rate is dropping and Rui doesn't know why

> *"Estamos a fechar menos. Eu sei, mas não sei o quê. Tenho cálculo, mas não estou a analisar as chamadas todas."*

He has a gut sense the team is leaving deals on the table — bad objection handling, weak follow-up, poor qualification, slow response — but no visibility into which of those is actually happening or where. He wants the AI to act as a *super-supervisor* who reads every call and ticket, identifies what was done well and what was missed, and gives him a daily report.

### 2. The team is overloaded with low-value queries

> *"Vocês têm dois problemas: tem um volume de tickets e de chamadas que a equipa consegue absorver isso tudo? Não."*

A large chunk of incoming volume is shopping-around traffic — people who'll never close, but who consume operator time. Rui wants:

- To identify which conversations were warm leads vs. tire-kickers (so the team focuses on the right ones)
- To find patterns of repetitive queries that could be automated (chatbot, self-service, AI agent) to free up the team for value-adding work

### 3. Things "fall through the cracks"

> *"Por vezes as coisas ficam lá a marinar e não é feito nada, quer seja no primeiro contacto, quer seja em follow-up."*

Promised follow-ups that don't happen. Quotes sent and never chased. Customers who said "I'll think about it" and were never recontacted within their decision window. Rui wants alerts before these die.

### 4. Long-term: AI that closes the deal itself

> *"Daqui a seis meses, queria que o AI me fechasse contratos."*

His ambition is genuine self-service: an AI agent that can answer questions, prepare quotes, and ideally close simple policies (e.g., TVDE renewals) end-to-end. He acknowledges this depends on whether the regulator (ASF) allows it — he's already started asking.

---

## What this codebase is (and isn't)

### What it IS

A **commercial intelligence layer over Alfaseguros' phone + ticket data.** It pulls every call from Ringover and every Zoho Desk ticket from the previous day, groups them into customer engagements ("cases"), runs each case through Claude (via OpenRouter), and produces:

- A per-case narrative ("the story" of that customer's request, end-to-end)
- Procedural deviation flags (where the operator deviated from expected practice)
- Coaching feedback per operator
- A daily executive summary with five sections: working well / to improve / risks / closing-rate recommendations / automation opportunities
- A "by operator" view with personal coaching notes

It's exposed as a web app (Express + React, served from Replit), with both manual triggers (date picker + button) and a daily 07:00 Lisbon cron from the existing n8n instance.

### What it is NOT

- **Not a replacement for Zoho CRM or Desk.** It's read-only against both. It doesn't write back (yet).
- **Not a real-time supervisor agent.** It's a daily batch. The transcript shows Rui wanted real-time, then accepted that batch is the realistic v1.
- **Not the AI-that-closes-deals.** That's the long-term vision (#4 above). This project is the foundation that lets us understand what's automatable.
- **Not yet the full commercial intelligence Rui asked for.** Phase 1 (call-only analysis) is shipped. Phase 2A (Desk ticket integration → cases with outcome data) is partially built — the plumbing is in place but outcome classification and the case-level analyzer need live data to wire up.

---

## Why we built it the way we did

### Why daily batch, not real-time

- Real-time supervisor whisper requires audio streaming + LLM-on-call infrastructure that's an order of magnitude more complex
- Ringover offers paid real-time supervision but it's their most expensive tier
- A daily batch with morning summary lands cleanly into the supervisor's existing workflow (coffee + report) and is operationally robust

### Why "cases" instead of "calls"

A customer engagement at Alfaseguros isn't a call — it's a multi-channel conversation. The customer might:

- Call inbound asking for a quote → operator opens a Desk ticket → quote sent by email → customer replies → operator calls back to close

If we only analyse calls, we mark "missing follow-up" when the follow-up actually happened by email. We mark conversations as "open" that are actually closed. We miss the full narrative. **The case is the right unit of analysis.**

### Why outcome classification is rule-based, not AI

Once we have ticket data, classifying a ticket as won/lost/open is best done by reading concrete custom fields (`cf_estado_negociacao`, `cf_apolice_emitida`, etc.) — that's deterministic, cheap, and auditable. The AI is reserved for the narrative analysis where its strength matters: reading a long email thread + call summaries and producing useful coaching feedback.

### Why OpenRouter, not the Anthropic API directly

User preference + portability. OpenRouter passes prompt caching through to Anthropic, so we don't sacrifice cost optimisation. If the user later wants to test with a different model (Haiku for cost, Opus for quality), it's a one-line change.

### Why Replit, not a "proper" deployment

Pragmatism. Replit gives Postgres + a hosted runtime + auto-deploy from GitHub for less than the cost of a tiny VPS, and the user already has it set up. The architecture is portable — it can move to Railway / Fly / Render later without code changes.

---

## What "good" looks like for this project

Rui should be able to:

1. **Open the dashboard at 07:30 Monday** and within 90 seconds know:
   - How many genuine commercial opportunities yesterday
   - How many likely closed
   - Which leads need a follow-up call **today** (or they die)
   - Which operator had a tough day and needs a 1:1
   - Whether any procedural pattern has emerged (e.g., everyone forgetting to ask for the customer's NIF on TVDE)
2. **Drill into a specific lost deal** and see the full conversation across calls + emails, plus an honest analysis of what could have been done differently
3. **See trends over weeks**, not just yesterday — *eventually*. Not in v1.
4. **Trust that the cron ran** — failures should be visible, not silent

If Rui changes his behaviour because of this dashboard (calls a customer he wouldn't have, coaches an operator on a specific objection technique, decides to invest in a chatbot for a recurring query) — the project is succeeding.

If he reads it once and goes back to gut feel — we built a report, not a tool.

---

## What we're still missing

These are real gaps, not aspirational features. Items closer to the top are higher leverage.

### Conversion ground truth (phase 2A — partially built)

We need to know which deals actually closed. That data lives in **Zoho Desk custom fields** that the Não Vida team uses today as their pipeline tracker. The codebase has the plumbing to fetch and link tickets but the outcome classifier is a placeholder until we look at real ticket data and map fields → outcomes.

### Lead temperature classification

A new field on each case: `quente | morno | frio | tire_kicker | já_cliente`. Easy to add once cases are flowing. Reframes the whole dashboard from "all conversations equal" to "here are the warm leads, here's what's happening to them."

### Why-we-lost analysis across time

Once outcomes are wired, aggregate over weeks: top 5 reasons for losing TVDE deals, etc. This is the answer to Rui's "I don't know why we're closing less."

### Follow-up SLA engine

Independent of analysis. A daily worker that surfaces "promised X by date Y, hasn't happened, customer hasn't replied" — with a draft message ready to send. Highest single-feature ROI for #3 in Rui's problem list.

### Closer playbook

Mine the conversations where deals *did* close. Surface the moves that worked: "Andreia closes 60% of TVDE price-objection cases — here's what she typically says." Coaching content that emerges from data, not a binder.

### Volume self-service / automation pipeline

The daily summary already detects automation opportunities one day at a time. Aggregated over weeks, the patterns become loud enough to fund concrete projects (chatbot, self-service portal, voice agent for renewals).

### Alice integration

Alfaseguros has an internal product knowledge chatbot ("Alice", running on Sonnet 4.6 with a Pinecone KB of insurance product info). Rui wants this elevated to a "senior supervisor" role with procedural knowledge. This project's outputs (procedures, common objections, what works) should eventually feed Alice. Not a v2 priority, but worth knowing the connection exists.

### Vida team

Out of scope today. NoCRM holds the pipeline. When this works for Não Vida, extending to Vida means adding a NoCRM data source and possibly different procedures.

---

## Strategic principles for whoever is working on this

These come from the meeting context and shape every design decision:

1. **Specificity beats generality.** Rui repeatedly asked for "what *specifically* was missed in *this* call" not "the team should follow up more." Generic advice is useless to him.
2. **Phased delivery.** Rui knows complexity is high. He's happy with cores first, edges later. Don't try to build phase 2 features in phase 1 just because they're tempting.
3. **Operationally lightweight.** This must run reliably without a human babysitting it. Cron failures must surface. Costs must be predictable. The system should be dull when it's working.
4. **Respect the operators.** Rui was emphatic: *"Isto não é haver um controle das pessoas, a ideia é termos uma ferramenta para as pessoas terem ajuda para conseguirem fechar mais."* The tool exists to help operators close more deals, not to police them. Coaching tone, not surveillance tone.
5. **Cost discipline.** Cache analyses. Use prompt caching. Don't re-analyse what's already analysed unless explicitly told. The user (Transformatiive) is absorbing the LLM cost as part of client work — wasted spend is real money.
6. **EU-PT, not BR-PT.** Every output. Every notification. Every comment. This is non-negotiable.
7. **Architecture should accommodate Vida and write-back later.** Even though they're out of scope, design choices that lock them out are wrong choices.

---

## Glossary (for non-PT readers and AI assistants)

- **Corretora de seguros** — insurance broker (intermediary, not underwriter)
- **Apólice** — insurance policy
- **Recibo** — payment receipt for a premium
- **Sinistro** — insurance claim
- **TVDE** — Transporte em Veículo Descaracterizado a partir de plataforma Eletrónica = Uber/Bolt/Free Now driver insurance. High volume, high value at Alfaseguros.
- **Multirriscos** — household / multi-peril insurance
- **Condomínio** — building / shared-property insurance (for an apartment block)
- **Ramos Vida vs Não Vida** — Life vs Non-Life lines of business. Distinct teams, distinct regulators-ish.
- **Cotação / Simulação** — quote
- **Seguradora** — insurance carrier (the underwriter — Tranquilidade, Lusitania, Fidelidade, etc.)
- **Caravela** — a lead source / partnership Alfaseguros uses (Excel-based lead drops processed via n8n)
- **ASF** — Autoridade de Supervisão de Seguros e Fundos de Pensões. The Portuguese insurance regulator.
- **Único** — common Portuguese broker ERP for managing policies/recibos. Alfaseguros uses it.
- **NoCRM** — pipeline tool used by the Vida team. Out of scope.
- **Ringover** — cloud PBX. Source of all call data + AI-generated call summaries.
- **Zoho Desk** — helpdesk/ticketing. Não Vida team uses tickets as their pipeline.
- **Zoho CRM** — Alfaseguros uses this for simulator-driven leads, not for manual pipeline management today.
- **Alice** — internal Alfaseguros product-knowledge chatbot. Different system, different scope.
