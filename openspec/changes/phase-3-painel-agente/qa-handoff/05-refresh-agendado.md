# QA HANDOFF — Secção 5: Refresh agendado

Change: `openspec/changes/phase-3-painel-agente`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Resumo

`POST /api/painel/refresh` recalcula as chamadas por devolver de hoje e
re-sincroniza os tickets recentes. **Nunca chama o modelo de linguagem.**

## Ficheiros alterados

| Ficheiro | Alteração |
|---|---|
| `jobs/painel-refresh.ts` | **novo** — o job |
| `jobs/painel-refresh.test.ts` | **novo** — 6 testes sobre o grafo de imports |
| `routes/painel-refresh.ts` | **novo** — a rota, com guarda de segredo |
| `routes/index.ts` | monta antes do `requireAuth` |
| `painel/redistribuicao.ts` | vírgula decimal no limiar (defeito da secção 4) |

## Cobertura dos critérios de aceitação

| Scenario | Implementado | Teste do programador | Resultado |
|---|---|---|---|
| Scheduled refresh | Sim — recalcula devoluções e re-sincroniza 2 dias de tickets | nenhum de integração | **implementado, não exercitado ponta a ponta** |
| ...AND no OpenRouter request is made | Sim | `painel-refresh.test.ts`: 4 asserções sobre o grafo de imports | **exercitado — passa** |
| ...AND no `runs.totalCostUsd` value changes | Sim, por construção — o job não toca na tabela `runs` | nenhum | **não exercitado** |
| Refresh without the cron secret | Sim — 401, e 503 se o segredo não estiver configurado | nenhum | **não exercitado** |
| Refresh is idempotent | Sim — herda o `setWhere` do upsert das devoluções | nenhum | **não exercitado — continua a ser o risco nº1 da secção 2** |

## Como está garantido que não chama o LLM

Pelo **grafo de imports**, não por um mock.

Um mock só prova que o caminho que o teste percorreu ficou calado. O grafo
prova que o código **não consegue** chegar ao OpenRouter, em caminho nenhum,
incluindo caminhos acrescentados no futuro por quem nunca leu isto.

O teste percorre recursivamente os imports a partir de `painel-refresh.ts`,
apanha também `import()` dinâmico, e verifica:

1. nenhum pacote com `openrouter` no nome;
2. nenhum módulo alcançável faz `from "…openrouter"` ou `new OpenRouterClient`;
3. nenhum módulo de `analysis/` fora de uma lista explícita;
4. **que o próprio grafo não está vazio** — sem isto, um resolver partido faria
   as três asserções anteriores passar sobre um conjunto vazio.

### Um achado do próprio teste

A asserção original proibia toda a pasta `analysis/` e **falhou**. O caminho
alcança `analysis/outcome.ts` — que é o classificador de resultados **por
regra**, importa um tipo e não chama nada. O `CLAUDE.md` diz-o: *"Outcome
classification is rule-based, not AI."*

A asserção estava a proibir uma **pasta** em vez de um **comportamento**.
Passou a lista explícita por módulo, mais um teste que confirma que
`outcome.ts` não tem `openrouter` nem `fetch(`. Um import **novo** de
`analysis/` nesta via faz o teste falhar e obriga a uma justificação — que é
exatamente a revisão que esta guarda existe para provocar.

## Decisões que valem revisão

- **O segredo é exigido em todos os caminhos.** Ao contrário do `POST /api/run`,
  onde a guarda só corre se o corpo trouxer `source: "cron"`. Este endpoint
  gasta chamadas ao Ringover e ao Zoho; não deve ser disparável por quem
  souber o URL. Não corrigi o `/api/run` — é alteração de comportamento de um
  endpoint existente e continua a precisar de decisão.

- **Devolve 200 mesmo quando uma das metades falha.** O corpo diz exatamente o
  que correu bem. Um 500 geral faria o n8n repetir a metade que já tinha
  funcionado.

- **As duas metades são independentes.** O Ringover em baixo não impede os
  tickets de atualizar, e vice-versa. Meio refresh vale mais do que nenhum, e a
  falha fica no log de qualquer forma.

- **Dois dias de tickets**, não um: cobre um fim de semana ou uma execução
  falhada.

## Por fazer nesta secção

- **5.4 — os dois agendamentos no n8n** (08:00 e 16:30, segunda a sexta).
  **Não executado de propósito.** O n8n aponta hoje para o Replit; criar lá
  agendamentos que batem no Railway mistura duas plataformas antes do cutover.
  Deve ser feito no mesmo momento em que os workflows são repontados.
- **5.5 — não mexer no cron das 06:00 nem no email diário.** Respeitado: nada
  foi tocado.

## Riscos que o QA deve atacar primeiro

1. **A idempotência continua sem teste contra Postgres.** Agora importa mais:
   o refresh das 16:30 corre sobre o trabalho que o agente fechou de manhã. Se
   o `setWhere` estiver errado, ressuscita-o.
2. **O refresh nunca correu.** Nem em produção, nem localmente.
3. **Custo do `syncTickets`.** Dois dias de tickets, duas vezes ao dia, contra
   a API do Zoho. Não é gratuito em quota, ainda que não gaste LLM.

## Verificação

```
pnpm run typecheck                                       # 0 erros
BASE_PATH=/ pnpm run build                               # verde
pnpm exec vitest run src/painel src/middleware src/jobs  # 71 passed
```

**Falhas pré-existentes:** `src/analysis/schema.test.ts`, 5 testes.

## Estado

**READY FOR INDEPENDENT QA**
