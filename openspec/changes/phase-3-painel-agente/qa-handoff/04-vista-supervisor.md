# QA HANDOFF — Secção 4: Vista do supervisor

Change: `openspec/changes/phase-3-painel-agente`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Resumo

Totais por bloco, carga por agente, e uma sugestão de redistribuição obtida
por regra — nunca por LLM.

## Ficheiros alterados

| Ficheiro | Alteração |
|---|---|
| `painel/redistribuicao.ts` | **novo** — a regra, pura, sem base de dados |
| `painel/redistribuicao.test.ts` | **novo** — 18 testes |
| `painel/supervisor.ts` | **novo** — `buildSupervisorPainel(data)` |
| `routes/agente.ts` | `GET /api/supervisor/painel` atrás de `requireSupervisor` |

## Cobertura dos critérios de aceitação

| Scenario | Implementado | Teste do programador | Resultado |
|---|---|---|---|
| Supervisor opens the team view | Sim — totais, carga por agente, sugestão com razão em português | nenhum de integração | **implementado, não exercitado contra dados reais** |
| Agent tries to open the team view | Sim — 403, verificado **duas vezes**: no `requireSupervisor` pelas claims, e outra vez contra a base de dados na rota | `require-agent.test.ts` cobre o guarda | **o guarda está exercitado; a segunda verificação não** |
| Redistribution suggestion is rule-based | Sim — função pura, zero chamadas de rede | `redistribuicao.test.ts`, 18 testes | **exercitado — passa** |
| ...reasoning names the agents and the counts | Sim | teste dedicado que verifica nomes e as três contagens no texto | **exercitado — passa** |

## A regra, e porque é assim

Carga ponderada, não contagem simples:

| Bloco | Peso | Porquê |
|---|---|---|
| Chamadas por devolver | 1 | uma chamada de volta, curta |
| Tickets em risco | 2 | ler um histórico e escrever uma resposta |
| Follow-ups | 1,5 | entre os dois |

Os pesos medem **atenção exigida**, não importância. Um agente com 4 tickets
está mais carregado do que um com 5 chamadas, e a regra tem de o ver.

Sobrecarga = carga acima de **1,5× a mediana da equipa**. A mediana, e não a
média, porque um único agente muito carregado puxaria a média e esconder-se-ia
a si próprio.

**O limiar é estrito.** Exatamente 1,5× não dispara — há um teste para isso.

## Decisões que valem revisão

- **Determinismo por desempate no id.** Dois agentes com a mesma carga
  ordenavam de forma arbitrária, e a sugestão mudava entre recargas da página.
  Um supervisor que recarrega e vê conselhos diferentes deixa de confiar no
  conselho. Há um teste que baralha a ordem do array e exige o mesmo resultado.

- **Mediana zero tem caminho próprio.** Se a maioria da equipa está sem nada e
  uma pessoa está cheia, o teste do rácio dividia por zero — mas o desequilíbrio
  é real. Trata-se como sobrecarga, com uma frase diferente.

- **Todos os caminhos "sem sugestão" devolvem uma frase.** Nunca uma string
  vazia. Um supervisor num dia calmo deve ler "a equipa está equilibrada", não
  ficar a pensar se a funcionalidade está partida.

- **O supervisor reutiliza `buildAgentePainel` por agente.** Custa mais idas à
  base de dados do que um agregado à mão, mas garante que ele vê exatamente os
  números que cada agente vê. Uma vista de equipa que discorda do ecrã do
  próprio agente é pior do que não haver vista de equipa.

- **Um bloco que falha para um agente conta zero e é nomeado em
  `indisponiveis`.** Um total parcial nunca é apresentado como completo.

- **A regra é publicada na resposta** (`regra.pesos`, `regra.limiarSobrecarga`)
  para a UI poder explicar ao supervisor a mesma regra que o servidor aplicou,
  sem a duplicar.

## Riscos que o QA deve atacar primeiro

1. **`buildSupervisorPainel` não tem teste.** A regra está bem coberta; o
   agregador que a alimenta não. Um erro de contagem aqui produz uma sugestão
   perfeitamente lógica sobre números errados.
2. **Custo em idas à base de dados.** Nove agentes × três blocos por carregamento
   da vista. Aceitável hoje; se a equipa crescer, é o primeiro sítio a doer.
3. **Os pesos são um palpite informado, não medidos.** 1 / 2 / 1,5 parecem certos
   e são fáceis de mudar num sítio só. Valem uma conversa com o João Catalão
   depois de ele ver a vista com dados reais.
4. **Nunca correu contra dados reais.** Não há chamadas nem tickets na base de
   dados de produção, portanto a vista devolveria hoje nove linhas a zero e
   "ninguém tem trabalho pendente".

## Verificação

```
pnpm run typecheck                                  # 0 erros
BASE_PATH=/ pnpm run build                          # verde
pnpm exec vitest run src/painel src/middleware      # 64 passed
```

**Falhas pré-existentes, não introduzidas aqui:** `src/analysis/schema.test.ts`, 5 testes.

## Estado

**READY FOR INDEPENDENT QA**
