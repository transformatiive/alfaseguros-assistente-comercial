# QA HANDOFF — Atribuição das chamadas perdidas (passos 1–4 do plano)

Change: `openspec/changes/phase-3-painel-agente`
Plano: `PLANO-CHAMADAS-PERDIDAS.md`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Resumo

O painel deixa de inventar a atribuição e passa a ler a que o n8n já fez.
Resolve também uma dupla contagem que estava a inflar a carga de cada agente.

## Ficheiros alterados

| Ficheiro | Alteração |
|---|---|
| `lib/db/src/schema/devolucoes.ts` | coluna `ticket_id` + índice |
| `painel/atribuicao.ts` | **novo** — emparelhamento puro chamada↔ticket |
| `painel/atribuicao.test.ts` | **novo** — 12 testes |
| `storage/devolucoes-repo.ts` | atribuição no upsert; fecho manual por grupo |
| `painel/agente.ts` | `agruparDevolucoes`, e a nova forma do bloco |
| `painel/supervisor.ts` | fim da dupla contagem na carga |
| `routes/agente.ts` | `tambemResolvidas` na resposta do fecho |

## Passo 1 e 2 — atribuir pelo dono do ticket

Ordem de preferência, e a razão de ser desta ordem:

1. **dono do ticket** que o n8n criou para esta chamada — é a decisão que já
   existe, e a única que reproduz o round-robin sem o reimplementar;
2. `user_id` da própria chamada, quando existe;
3. quem devolveu a chamada mais tarde (a regra antiga).

O emparelhamento é por impressão digital do telefone, com o ticket criado
**depois** da chamada e dentro de 30 minutos. Um ticket é reclamado por uma
única chamada, para que duas chamadas seguidas não apontem ambas ao mesmo.

**Porquê 30 minutos:** o ticket nasce de um webhook, portanto em segundos. A
folga é para uma repetição ou uma execução em fila, e fica muito abaixo do
intervalo típico entre duas chamadas do mesmo cliente.

## Passo 3 — fim da dupla contagem

Toda a chamada perdida também vira ticket. Uma chamada de há três dias aparecia
**duas vezes**: como devolução e como ticket em risco. A fórmula somava as duas.

Agora a **carga** desconta a sobreposição; as **contagens mostradas não mudam** —
o agente tem mesmo aquelas devoluções. Carga mede quanto trabalho existe, não em
quantos sítios aparece.

O campo `jaContadasComoTicket` explica a diferença na própria resposta, para o
supervisor não suspeitar de um erro de aritmética.

> **Isto altera a sugestão de redistribuição.** Os pesos (1 / 1,5 / 2) foram
> escolhidos antes desta correção e merecem uma conversa com o João Catalão
> depois de ele ver os números novos.

## Passo 4 — agrupar reinsistências

Cinco linhas do mesmo número em treze minutos passam a uma linha com
`tentativas: 5`, primeira e última chamada. As linhas individuais continuam na
base de dados — a idempotência depende do `ringover_call_id`.

**Consequência no fecho:** resolver uma devolução passa a resolver **todas** as
pendentes do mesmo número no mesmo dia. É a mesma regra que a resolução
automática já aplicava: uma chamada de volta salda a dívida toda. A resposta
devolve `tambemResolvidas` com quantas outras foram fechadas.

## Passo 5 — balde partilhado

Já implementado antes deste lote. Passa a ser a **medida de sucesso do passo 1**:
hoje 41 das 61 chamadas de 2026-08-28 não tinham agente. Depois desta mudança
esse número tem de cair muito.

## Cobertura

| Scenario | Teste | Resultado |
|---|---|---|
| Redistribution suggestion is rule-based | `redistribuicao.test.ts` (18) | **exercitado — passa** |
| Calls to return | `devolucoes.test.ts` (14) + agrupamento (6) | **exercitado — passa** |
| Atribuição pelo ticket | `atribuicao.test.ts` (12) | **exercitado — passa** |
| Cross-agent write is refused | — | **não exercitado; o caminho MUDOU e precisa de reteste** |
| Refresh is idempotente | — | **não exercitado — continua o risco nº1** |

## Riscos que o QA deve atacar primeiro

1. **O `concluirDevolucao` foi reescrito.** Deixou de ser um `UPDATE` com a
   posse no `WHERE` e passou a ler primeiro e escrever depois. A recusa entre
   agentes continua garantida (compara `colaboradorId` antes de escrever), mas
   **é código novo num caminho de segurança** e o teste que o cobria era de
   produção, não unitário. **Retestar explicitamente.**
2. **Nada disto correu contra Postgres.** A atribuição é pura e está testada; a
   consulta que a alimenta não.
3. **A janela de 30 minutos é um palpite informado.** Se o `phone_fingerprint`
   dos tickets não estiver preenchido como se espera, a atribuição devolve zero
   e ninguém dá por isso — só se nota porque o balde partilhado não encolhe.
4. **`ticket_id` precisa do push do schema** antes de qualquer disto funcionar.

## Verificação

```
pnpm run typecheck                                       # 0 erros
BASE_PATH=/ pnpm run build                               # verde
pnpm exec vitest run src/painel src/middleware src/jobs  # 89 passed
```

**Pré-existente:** `src/analysis/schema.test.ts`, 5 testes.

## Estado

**READY FOR INDEPENDENT QA**
