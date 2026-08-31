# Alterações de comportamento deliberadas

> Esta migração é, por regra, um *lift-and-shift* sem alteração de comportamento.
> Tudo o que aqui está é uma **exceção aprovada pelo utilizador**, registada para
> que não passe por descuido.

## 1. `PORT` deixa de ser obrigatório no build

**Decisão do Nuno (opção B), 2026-08-30.**

O `vite.config.ts` rebentava se o `PORT` não estivesse definido, incluindo em
`vite build`. O Railway injeta o `PORT` em runtime, não garantidamente no build.

Passou a opcional. Quando definido, continua validado e continua a ligar
`server.port`/`preview.port`. Detalhe completo no handoff da secção 1.

## 2. Modelo de análise passa a Sonnet 5

**Decisão do Nuno, 2026-08-31.**

`OPENROUTER_MODEL = anthropic/claude-sonnet-5` no serviço do Railway.

Antes: a variável não estava definida, portanto valia o default do código —
`anthropic/claude-sonnet-4-6` (`artifacts/api-server/src/lib/env.ts`).

**Isto altera o output e o custo das análises.** As narrativas, os desvios
procedimentais e o coaching passam a ser gerados por outro modelo. Não é uma
mudança de infraestrutura, é uma mudança de produto — e é por isso que está aqui.

### Consequência para a verificação

O cenário `#### Scenario: Same day analysed on both platforms` da delta-spec
dizia:

> GIVEN a date that was analysed on Replit
> WHEN the same date is opened on Railway after the data restore
> THEN the cached analysis is identical

**Este cenário deixou de ser aplicável, por duas razões independentes:**

1. Não há restauração de dados — decidiu-se começar do zero
2. O modelo mudou, portanto uma nova análise do mesmo dia **não** produziria
   output idêntico, mesmo que houvesse com que comparar

Fica registado como **não aplicável**, não como não verificado. Quem fundir a
delta no spec canónico tem de o remover ou reescrever.

### Por confirmar

- Que o OpenRouter serve `anthropic/claude-sonnet-5` com esse identificador
  exato. Só se confirma numa análise real, que ainda não correu.
- O custo por conversa face ao Sonnet 4.6. O código já regista o custo por
  conversa e por run, portanto é medível assim que a primeira análise correr.
- Se o Replit tinha o `OPENROUTER_MODEL` definido para outro valor. Se tinha,
  a comparação com o histórico do Replit deixa de fazer sentido de qualquer forma.

## Variáveis opcionais que continuam por confirmar contra o Replit

Estas não estão no Railway e valem o default do código. Se o Replit tiver valores
diferentes, o comportamento muda sem ninguém dar por isso:

| Variável | Default no código |
|---|---|
| `ZOHO_DESK_NAOVIDA_DEPARTMENT_ID` | `367662000000006907` |
| `VIDA_AGENT_IDS` | vazio |
| `FOLLOWUP_EXCLUDE_PRODUCTS` | `TVDE,Caravela` |

O `OPENROUTER_MODEL` saiu desta lista — passou a estar explicitamente definido.
