# QA HANDOFF — Secção 0: Groundwork

Change: `openspec/changes/phase-3-painel-agente`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Resumo

Schema, variáveis de ambiente e o script de identidade que as secções seguintes
precisam. Nenhum comportamento visível mudou: nada lê ainda `papel`,
`crm_user_id` ou `devolucoes` em produção.

## Ficheiros alterados

| Ficheiro | Alteração |
|---|---|
| `lib/db/src/schema/colaboradores.ts` | colunas `papel` e `crm_user_id` |
| `lib/db/src/schema/devolucoes.ts` | tabela nova |
| `lib/db/src/schema/index.ts` | export |
| `artifacts/api-server/src/lib/env.ts` | 3 variáveis novas, todas opcionais |
| `.env.example` | documenta as 3 |
| `lib/zoho-desk/src/{client,types,index}.ts` | `listAgents()` + schema do agente |
| `scripts/src/backfill-zid.ts` | script novo |

## Cobertura das tarefas

| Tarefa | Feito | Verificado |
|---|---|---|
| 0.1 `papel` em `colaboradores` | Sim | typecheck |
| 0.2 tabela `devolucoes` | Sim | typecheck |
| 0.3 export + `drizzle-kit push` | Sim | **exercitado — schema aplicado no Railway** |
| 0.4 3 variáveis em `env.ts` e `.env.example` | Sim | typecheck |
| 0.5 confirmar licenças CRM com o Rui | **Não** — depende de terceiro | não verificado |
| 0.6 `crmUserId` | Sim | typecheck |
| 0.7 script de backfill do `zid` | Sim | **não executado** — precisa das credenciais Zoho e da BD |

## Desvios e riscos

1. ~~O schema não está aplicado.~~ **Resolvido.** O schema está aplicado na
   base de dados do Railway, por um serviço dedicado `db-schema-push` — o
   `preDeployCommand` do Railway não cria sequer o passo de pre-deploy neste
   projeto. Ver `openspec/changes/migracao-railway/RAILWAY-CONFIG.md`.
   Verificado em produção: `/api/agente/sessao` devolve 403 "Colaborador não
   reconhecido" em vez de 500, o que prova que a consulta a `colaboradores`
   com as colunas novas executa.
2. **O backfill nunca correu.** Sem `colaboradores.zid` preenchido, nenhum agente
   se resolve pelo Desk — só por email. O script existe e é seguro (modo
   simulação por omissão), mas o seu output real é desconhecido.
3. **0.5 está por responder.** Se os nove agentes da equipa 360 não tiverem
   licença de CRM que permita Web Tabs, a secção 7B cai. Não bloqueia as
   secções 0–2.

## Decisões que valem revisão

- `papel` tem default `agente`, não `nenhum`. Um colaborador existente passa
  automaticamente a ter painel próprio, mas **nunca** a vista de equipa. Achei
  isto o default seguro; o QA pode discordar.
- O backfill recusa-se a escrever num match ambíguo ou em conflito, e regista-o.
  Um `zid` errado daria a um agente o painel de outro — preferi falhar em voz
  alta a adivinhar.

## Estado

**READY FOR INDEPENDENT QA**
