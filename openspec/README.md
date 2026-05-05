# OpenSpec — Alfaseguros Supervisor Virtual

This folder is the source of truth for what the system **does** (specs/) and what we plan to **change** (changes/).

## Structure

- **`specs/supervisor/spec.md`** — the canonical "as-built" spec. Reflects what's actually deployed on Replit today. When a change is implemented and archived, its delta merges into this file.
- **`changes/<change-name>/`** — proposals in flight. Each contains:
  - `proposal.md` — why and scope
  - `design.md` — technical approach with decisions and rationale
  - `tasks.md` — implementation checklist
  - `specs/supervisor/spec.md` — delta against the canonical spec, in ADDED/MODIFIED/REMOVED form

## How to read this

For project context, read `/CONTEXT.md` and `/HANDOVER.md` at the repo root first. Those cover the business and technical "why". This folder covers "what specifically".

## Active changes

- **`phase-2a-desk-cases/`** — Zoho Desk integration: cases that span calls + tickets + email threads, outcome classification, case-level analysis, pipeline view UI. Soft target: demo to Rui.
- **`phase-2b-commercial-intelligence/`** — lead temperature, why-we-lost analysis, follow-up SLA engine, closer playbook. Queued; depends on 2A being live.

## Workflow

1. New idea → create a folder under `changes/<slug>/` with proposal/design/tasks/delta-spec
2. Discuss / refine until the proposal feels solid
3. Implement task by task — tick off `tasks.md`
4. When done: merge the delta into `specs/supervisor/spec.md`, move the change folder to `changes/archive/`

## RFC 2119 keywords

All requirements use:
- **MUST / SHALL** — absolute requirement
- **SHOULD** — strong recommendation; deviation needs justification
- **MAY** — optional, no obligation
