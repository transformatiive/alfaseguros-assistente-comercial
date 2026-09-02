# QA HANDOFF — Secção 6: Frontend do painel

Change: `openspec/changes/phase-3-painel-agente`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Resumo

Artifact novo `artifacts/agente` — o ecrã que o agente vê. Vite + React +
TanStack Query + Wouter, servido pelo Express em `/agente`, desenhado para a
largura do painel esquerdo do Zoho Desk.

Nada do que já existia mudou de significado: `/api`, `/leads` e todas as rotas
do supervisor continuam iguais. O único ficheiro tocado fora do artifact novo é
o `app.ts`, e só para acrescentar uma montagem.

## Ficheiros

| Ficheiro | Alteração |
|---|---|
| `artifacts/agente/**` | **novo** — o artifact inteiro |
| `artifacts/api-server/src/app.ts` | montagem de `/agente`, antes do cliente do supervisor |
| `openspec/.../tasks.md` | 6.1–6.8 marcadas |

## Cobertura das tarefas

| # | Implementado | Verificado como |
|---|---|---|
| 6.1 scaffold | sim | `pnpm run typecheck` e `pnpm run build` limpos |
| 6.2 só os primitivos usados | sim — card, badge, button, skeleton, separator, tabs, tooltip, copiados | os originais do supervisor não foram tocados |
| 6.3 token do hash | sim | **não exercitado por teste** — ver riscos |
| 6.4 401 → pede token ao pai | sim | **não exercitado por teste** |
| 6.5 painel do agente | sim | build; **não visto em ecrã real** |
| 6.6 vista da equipa em `/agente/equipa` | sim | SPA fallback verificado com `curl` |
| 6.7 estados vazios explícitos | sim | inspeção do código |
| 6.8 servido pelo Express | sim | **exercitado** — ver abaixo |

## O que foi mesmo exercitado

Servidor local, `curl`:

```
GET /agente/                    → 200 text/html
GET /agente/equipa              → 200, index.html com assets /agente/*
GET /agente/assets/nao-existe.js → 404   (e não HTML com 200)
GET /                           → 200   (supervisor intacto)
GET /api/nao-existe             → 401   (API intacta)
```

O 404 do asset em falta é o que interessa: se caísse para o `index.html` o
browser recebia HTML com 200 e falhava com `Unexpected token '<'`, que é uma
forma péssima de descobrir que um build está partido.

## Riscos por ordem de gravidade

1. **A sessão nunca foi exercitada com o widget, porque o widget não existe.**
   O 6.3 e o 6.4 são a metade de baixo de um aperto de mão cuja metade de cima é
   a secção 7A. O código lê o `#token`, limpa-o com `replaceState` e, em 401,
   faz `postMessage` ao frame pai. Nada disto foi visto a funcionar contra um
   emissor real. **É o primeiro teste a fazer quando a 7A aterrar**, e até lá o
   painel só é utilizável a partir de um token colado à mão no fragmento.

2. **Nenhum teste automático no artifact.** Não há Vitest aqui. A lógica com
   risco real de regressão é pequena e pura — `formatos.ts` e o arranque da
   sessão — e merece testes; não os escrevi, e digo-o em vez de os fingir.

3. **Nunca foi visto num ecrã.** Build limpo não é o mesmo que legível. A
   largura foi escolhida para o painel do Desk sem ter medido o painel do Desk.

4. **Os tipos do payload são copiados à mão** (`src/lib/tipos.ts`). Estes
   endpoints não estão no `openapi.yaml`, por isso não há de onde gerar. Se o
   servidor mudar um campo, o TypeScript não se queixa — só o ecrã. Quando os
   endpoints entrarem na spec, apagar o ficheiro e importar do `@workspace/api-zod`.

## Desvio à especificação, deliberado

O 6.1 pedia `BASE_PATH=/agente/`. Não usei o `BASE_PATH`: essa variável já vale
`/` para o cliente do supervisor e está definida ao nível do serviço em todos os
serviços que constroem este repositório. Reutilizá-la obrigava um valor a ser
duas coisas, e quem a mudasse para um artifact partia o outro em silêncio.

O caminho é uma constante (`/agente/`) porque é o Express que decide onde monta,
com `AGENTE_BASE_PATH` como escape para uma pré-visualização. Efeito prático:
zero variáveis novas em produção.

## Estado

**READY FOR INDEPENDENT QA.**

Não aprovado, não pronto para produção. O risco nº1 não é fechável nesta secção.
