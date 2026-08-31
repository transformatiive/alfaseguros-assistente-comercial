# QA HANDOFF — Secção 3: O resto do payload do painel

Change: `openspec/changes/phase-3-painel-agente`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Resumo

Os outros três blocos do painel: tickets em risco, follow-ups do agente, e o
espaço reservado para os agendamentos.

A parte que merece escrutínio não é nenhuma delas — é a **extração da query dos
follow-ups**. `/api/followups/pending` é lido por um workflow n8n **ativo** que
cria tarefas no Zoho Desk. Se a forma da resposta mudar, as tarefas param de ser
criadas, em silêncio.

## Ficheiros alterados

| Ficheiro | Alteração |
|---|---|
| `painel/followups-shape.ts` | **novo** — shaping puro, sem import da base de dados |
| `painel/followups-query.ts` | **novo** — carregamento; delega a forma |
| `routes/followups.ts` | passa a chamar `loadPendingFollowUps`; a query saiu daqui |
| `painel/tickets-risco.ts` | **novo** — tickets abertos há mais de 24h, com link para o Desk |
| `painel/agente.ts` | **novo** — `buildAgentePainel` |
| `painel/identity.ts` | `loadColaboradorAtivo(id)` |
| `routes/agente.ts` | `GET /api/agente/painel` |
| `vitest.config.ts` | **novo** — `DATABASE_URL` de placeholder |

## Cobertura dos critérios de aceitação

| Scenario | Implementado | Teste do programador | Resultado |
|---|---|---|---|
| Tickets past 24 hours | Sim — idade em horas e deep link do Desk | `tickets-risco.test.ts`: 6 testes da regra de idade, incluindo o limite dos 23h59 e uma mudança de hora | **parcial — a regra de idade está exercitada; a query em si, não** |
| End-of-day alert | Não — não faz parte desta secção | nenhum | não exercitado |
| Scheduling data is not yet available | Sim — `{ disponivel: false, motivo }`, nunca um array vazio | nenhum | **implementado, não exercitado** |
| Two agents, two panels | Sim — todos os blocos filtram pelo colaborador do token | `followups-shape.test.ts`: 3 testes do filtro por agente | **parcial — o filtro dos follow-ups está exercitado; os outros blocos, não** |
| n8n integrations unaffected | Sim | `followups-shape.test.ts`: 7 testes, incluindo igualdade profunda contra um fixture e a **ordem exata das chaves** | **exercitado — passa** |
| Calls to return | Já da secção 2 | `devolucoes.test.ts` | **exercitado — passa** |

## O que foi feito para não partir o n8n

1. A forma da resposta foi movida para um módulo **puro** (`followups-shape.ts`),
   sem import do cliente da base de dados, precisamente para poder ser fixada
   por um teste sem Postgres.
2. O teste faz `toEqual` sobre o objeto **inteiro**, não verificações campo a
   campo: uma chave acrescentada ou renomeada falha.
3. Um segundo teste fixa a **ordem das chaves** do item.
4. O `agentRef` é opcional e a rota do n8n **não o passa** — há um teste
   explícito de que, sem ele, vêm os follow-ups de todos os agentes.

**Limite honesto:** o que está provado é que o *shaping* é idêntico. A tarefa
3.1 pede "byte-identical for a fixed fixture", e isso está cumprido ao nível da
função. **Não** foi feita uma comparação ponta a ponta do endpoint vivo, antes e
depois, contra a base de dados real. É o primeiro teste que o QA deve fazer.

## Decisões que valem revisão

- **`loadColaboradorAtivo` a cada pedido.** A rota do painel volta a ler o
  colaborador em vez de confiar nas claims do token. Custa uma query; em troca,
  desativar alguém corta-lhe o painel **imediatamente**, em vez de até 15
  minutos depois. Achei a troca óbvia.

- **Degradação por bloco, com `Promise.allSettled`.** Uma falha do Zoho não
  apaga a página: o bloco afetado passa a `{ disponivel: false, motivo }` com
  uma frase em português para o agente ler, e o erro fica no log. Um painel
  3/4 útil vale mais do que um painel em branco.

- **Um agente sem `zid` vê uma mensagem, não um vazio.** "Ainda não está
  associado a uma conta do Zoho Desk" distingue-se de "não tem tickets". Como
  o backfill (0.7) ainda não correu, este é hoje o caminho de **todos** os
  agentes.

- **`statusType` nulo conta como aberto.** O Desk deixa-o por preencher nalguns
  canais. Preferi mostrar um ticket que talvez esteja aberto a esconder um que
  está.

- **`vitest.config.ts` com um `DATABASE_URL` de placeholder.** O
  `@workspace/db` rebenta no import sem a variável, o que impedia testar lógica
  pura em qualquer módulo que lhe tocasse. O `pg` liga preguiçosamente, por isso
  nenhum socket é aberto; um teste que chegasse mesmo à base de dados falharia
  contra um host inexistente — que é o que deve acontecer.

## Riscos que o QA deve atacar primeiro

1. **Comparar `/api/followups/pending` ponta a ponta, antes e depois.** É o
   único risco desta secção com consequências para o cliente. Capturar a
   resposta contra a base de dados real e comparar byte a byte.
2. **A query dos tickets nunca correu contra Postgres.** Só a aritmética da
   idade está testada. O `assigneeId` do Desk é um ZID; se o backfill escrever
   um valor com outro formato, a query devolve sempre vazio — e vazio parece
   "não tens tickets", não "está partido".
3. **`buildAgentePainel` não tem teste.** É a função que decide o que cada
   agente vê.
4. **Nenhum caminho feliz foi exercitado em produção**, porque não há nenhum
   colaborador com `zid`. Continua a ser verdade desde a secção 2.

## Verificação

```
pnpm run typecheck                      # 0 erros
BASE_PATH=/ pnpm run build              # verde
pnpm exec vitest run src/painel src/middleware
  46 passed
```

**Falhas pré-existentes, não introduzidas aqui:** `src/analysis/schema.test.ts`,
5 testes. Falham igualmente sem estas alterações.

## Verificação em produção (2026-08-31)

```
GET  /api/agente/painel   token inválido      → 401 Sessão expirada
GET  /api/agente/painel   sem token           → 401 Sessão expirada
GET  /api/agente/painel   ?data=ontem         → 401 Sessão expirada
GET  /api/followups/pending  sem token        → 401 Unauthorized
GET  /api/followups/pending  token errado     → 401 Unauthorized
POST /api/agente/sessao   email desconhecido  → 403 Colaborador não reconhecido
GET  /api/healthz                             → 200
GET  /api/run/2026-08-28  (supervisor)        → 200
GET  /leads                                   → 200
```

Nota sobre o terceiro caso: uma `data` inválida devolve 401, não 400, porque o
`requireAgent` corre antes da validação do parâmetro. É a ordem certa — quem não
está autenticado não deve sequer saber que o parâmetro existe.

**Nota metodológica, e um erro meu.** A primeira sondagem deste deploy procurava
o código 401 e deu positivo aos 20 segundos. Era falso: a versão **antiga**
também devolve 401 nessa rota, porque a guarda de sessão apanha qualquer caminho
que não conheça. A sondagem passou a procurar o **corpo** da resposta, que
distingue as versões sem ambiguidade (`Sessão expirada` na nova,
`Não autenticado` na antiga). Um código de estado sozinho não prova que um
deploy aterrou.

Continua sem nenhum caminho feliz exercitado: não há colaborador com `zid`.

## Estado

**READY FOR INDEPENDENT QA**
