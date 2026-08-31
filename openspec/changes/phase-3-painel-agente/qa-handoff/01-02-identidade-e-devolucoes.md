# QA HANDOFF — Secções 1 e 2: Identidade, token e chamadas por devolver

Change: `openspec/changes/phase-3-painel-agente`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Resumo

A secção 1 (identidade e token) entrou junto com a secção 2 porque os endpoints
`/api/agente/devolucoes*` não existem sem ela.

O núcleo é `painel/devolucoes.ts`: puro, sem rede nem base de dados. É o que
torna as duas regras que interessam — resolução automática e atribuição —
testáveis sem Postgres e sem Ringover.

## Ficheiros alterados

| Ficheiro | Alteração |
|---|---|
| `artifacts/api-server/src/painel/token.ts` | JWT HS256, 15 min, sobre `node:crypto` |
| `artifacts/api-server/src/painel/identity.ts` | `resolveColaborador({ deskUserId, crmUserId, email })` |
| `artifacts/api-server/src/painel/devolucoes.ts` | `computeDevolucoes(calls, data)`, puro |
| `artifacts/api-server/src/middleware/require-agent.ts` | `requireAgent`, `requireSupervisor`, `agenteDe` |
| `artifacts/api-server/src/storage/devolucoes-repo.ts` | upsert idempotente, listagem, conclusão |
| `artifacts/api-server/src/routes/agente.ts` | `/api/agente/sessao`, `/api/agente/devolucoes*` |
| `artifacts/api-server/src/jobs/refresh-devolucoes.ts` | recálculo de um dia, sem LLM |
| `artifacts/api-server/src/routes/index.ts` | monta o router antes de `requireAuth` |

## Cobertura dos critérios de aceitação

Os critérios são os blocos `#### Scenario:` de
`openspec/changes/phase-3-painel-agente/specs/supervisor/spec.md`, na íntegra.

| Scenario | Implementado | Teste do programador | Resultado |
|---|---|---|---|
| Known, active agent opens the panel | Sim | `token.test.ts` (round-trip das claims); `resolveColaborador` **não testado** | **parcial — a emissão do token está exercitada, a resolução da identidade não** |
| Agent not yet registered | Sim — 403 + `logger.warn` com a identidade pedida | `POST /api/agente/sessao` em produção com um email desconhecido → 403 "Colaborador não reconhecido" | **exercitado — passa** |
| Deactivated agent | Sim — `ativo = true` está no WHERE de todos os caminhos | nenhum | não exercitado |
| Request from the wrong portal | Sim — 403 antes de qualquer consulta à BD | `portalId: "999"` em produção → 403 "Organização não autorizada" | **exercitado — passa** |
| Expired token | Sim — 401 | `token.test.ts` e `require-agent.test.ts` | **exercitado — passa** |
| Two agents, two panels | Sim — a listagem filtra por `colaboradorId` do token | nenhum | não exercitado |
| Cross-agent write is refused | Sim — 403, ver "Desvios" | nenhum | **não exercitado contra uma BD real** |
| Calls to return | Sim — mais antigas primeiro, com número, hora e contexto | `devolucoes.test.ts` (ordenação, filtragem) | **exercitado — passa** |
| A call returned without anyone clicking anything | Sim | `devolucoes.test.ts`: 6 testes da janela de resolução | **exercitado — passa** |
| Refresh is idempotent | Sim — `ON CONFLICT ... setWhere estado = 'pendente'` | **nenhum** | **não exercitado — ver riscos** |
| Tickets past 24 hours | Não — secção 3 | nenhum | não exercitado |
| End-of-day alert | Não — secção 3 | nenhum | não exercitado |
| Scheduling data is not yet available | Não — secção 3 | nenhum | não exercitado |
| Supervisor opens the team view | Não — secção 4 | nenhum | não exercitado |
| Agent tries to open the team view | Parcialmente — `requireSupervisor` existe, o endpoint não | `require-agent.test.ts` | **o guarda está exercitado, o endpoint não existe** |
| Redistribution suggestion is rule-based | Não — secção 4 | nenhum | não exercitado |
| Scheduled refresh / Refresh without the cron secret | Não — secção 5 | nenhum | não exercitado |
| Tudo em "Reach the panel without ever authenticating" | Não — secções 6, 7A, 7B, 7C | nenhum | não exercitado |
| Existing login still works | Sim, por construção — nada em `artifacts/supervisor/**` nem em `require-auth.ts` foi tocado | login real + `GET /api/run/2026-08-28` → 200 no domínio público | **exercitado — passa** |
| n8n integrations unaffected | Sim, por construção — nenhum endpoint existente mudou | `GET /leads` → 200 e `/api/healthz` → 200 depois do deploy | **parcial — os endpoints continuam vivos; o output do `/api/followups/pending` não foi comparado byte a byte** |

## Testes executados

```
pnpm exec vitest run src/painel src/middleware
  ✓ src/painel/devolucoes.test.ts      (14)
  ✓ src/painel/token.test.ts            (9)
  ✓ src/middleware/require-agent.test.ts (7)
  30 passed
pnpm run typecheck                # verde
BASE_PATH=/ pnpm run build        # verde
```

**Falhas pré-existentes, não introduzidas aqui:** `src/analysis/schema.test.ts`
tem 5 testes a falhar. Confirmado com `git stash -u` que falham igualmente na
árvore sem estas alterações. Não corrigido — fora do âmbito.

## Desvios face ao spec

1. **`Cross-agent write is refused` — cumprido, mas com um trio de estados.**
   O spec pede 403. A primeira implementação devolvia 404 para os três casos
   (não existe, é de outro, já resolvida) para não permitir sondar ids. Foi
   corrigida para cumprir o spec: **403** quando a linha é de outro colaborador,
   404 quando não existe, 409 quando já está resolvida. A verificação de posse
   continua a ser feita em SQL, no mesmo statement do UPDATE — a leitura extra
   só acontece no caminho já rejeitado.

2. **`Expired token` — a segunda metade não está feita.** O spec diz "AND the
   widget silently mints a new token and reloads the panel". O servidor devolve
   401; o widget é a secção 7A.

## Riscos que o QA deve atacar primeiro

1. **A idempotência do upsert nunca correu contra Postgres.** É a regra mais
   importante da secção 2 — se o `setWhere` estiver errado, o refresh das 16:30
   ressuscita trabalho que o agente já fechou de manhã. A lógica pura está
   testada; o SQL não. Precisa de um teste de integração com uma base de dados
   real: correr o refresh, resolver uma linha à mão, correr outra vez, confirmar
   que continua resolvida.
2. **`resolveColaborador` não tem um único teste.** É a função que decide de quem
   é o painel. Um erro aqui mostra a um agente o trabalho de outro.
3. **A atribuição por "quem devolveu a chamada" é uma heurística.** Uma chamada
   perdida sem `user_id` é atribuída a quem falou com aquele cliente mais tarde
   no mesmo dia. Na prática é quase sempre certo, mas é um palpite e o QA deve
   validá-lo contra um dia real de chamadas.
4. **O rate limit da emissão é por processo e em memória.** Não sobrevive a um
   restart nem a réplicas. É um travão, não uma fronteira de segurança — a
   fronteira é o `PAINEL_WIDGET_TOKEN`.

## Verificação em produção (2026-08-31, depois do schema aplicado)

```
POST /api/agente/sessao  email desconhecido       → 403 Colaborador não reconhecido
POST /api/agente/sessao  sem widget token         → 401 Widget não autorizado
POST /api/agente/sessao  widget token errado      → 401 Widget não autorizado
POST /api/agente/sessao  portalId errado          → 403 Organização não autorizada
GET  /api/agente/devolucoes  sem token            → 401 Sessão expirada
GET  /api/agente/devolucoes  token inválido       → 401 Sessão expirada
GET  /api/healthz                                 → 200
GET  /api/run/2026-08-28  (sessão de supervisor)  → 200
GET  /leads                                       → 200
```

Nenhum caminho feliz do painel foi exercitado: não há nenhum colaborador com
`zid` preenchido, porque o backfill (tarefa 0.7) ainda não correu. Tudo o que
está provado acima são as recusas.

## Estado

**READY FOR INDEPENDENT QA**
