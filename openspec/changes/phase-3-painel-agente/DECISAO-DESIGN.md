# Decisão de design — bibliotecas de componentes

**Data:** 2026-08-31
**Contexto:** pedido para o produto não ter "ar de feito por AI", avaliando
`ui.shadcn.com`, `kibo-ui.com` e `shadcnblocks.com`.

## O que cada uma é, na prática

| Fonte | Licença / custo | O que dá | O que **não** dá |
|---|---|---|---|
| **ui.shadcn.com** | MIT, grátis, copy-paste | As primitivas (já temos 55 em `artifacts/supervisor/src/components/ui/`), `sidebar`, `chart` (wrapper Recharts com tooltip/legenda a sério), `data-table` (TanStack Table), blocos `dashboard-01`, `login-0x` | Identidade visual. Os blocos são deliberadamente neutros |
| **kibo-ui.com** | Open source, grátis, registry compatível (`npx kibo-ui add …`) | Componentes que o shadcn não tem: Kanban, Gantt, Calendar, Tree, List, Ticker, Contribution Graph, Status, Table avançada, Dropzone, Code Block | Também é neutro; 28 "blocks" prontos |
| **shadcnblocks.com** | Freemium — nível grátis limitado, Pro **149 USD** / Premium 299 / Elite 399 (compra única) | ~2000 blocos de *marketing* (hero, pricing, testimonials, FAQ) + alguns de dashboard/stats/data-table | Quase tudo o que tem valor está atrás do pagamento, e a maior parte do catálogo é de landing pages — não serve para este produto |

## A tensão que é preciso nomear

O `HANDOVER.md` §3 define uma linguagem visual **deliberada** para o supervisor:
Georgia serif nos blocos narrativos e nos valores das estatísticas (28px),
etiquetas de 10px em maiúsculas com espaçamento, paleta neutra quente, faixa de
7 colunas de estatísticas, banner preto do resumo executivo em itálico Georgia,
borda azul de 3px nos cartões multi-chamada. O `CLAUDE.md` diz explicitamente:
*"Don't simplify."*

Ora, o "ar de feito por AI" **é exatamente o aspeto dos blocos genéricos**:
cartões arredondados todos iguais, Inter em tudo, ícones lucide a cada título,
gradientes suaves. Colar blocos do shadcnblocks por cima do que existe tornaria
o produto mais genérico, não menos.

## Decisão

**Manter a linguagem editorial existente. Ir buscar a estas bibliotecas
mecânica, não aparência.** Ou seja: usar o comportamento (ordenação, filtros,
virtualização, acessibilidade, estados vazios) e re-vestir com os tokens do
projeto.

### O que extrair, em concreto

**Do shadcn/ui (grátis, adotar já):**
1. `chart` — hoje os gráficos são feitos à mão. O wrapper dá tooltips, legendas e
   temas coerentes, e aceita as nossas cores por CSS var.
2. `data-table` (TanStack Table) — para a lista de conversas e o painel do
   agente: ordenação, filtro e paginação sem código próprio.
3. `sidebar` — só se e quando o supervisor precisar de navegação lateral. Não é
   prioritário.

**Do Kibo UI (grátis, adotar seletivamente):**
1. **Contribution Graph** — mapa de calor por dia/agente. É a peça que dá ar de
   ferramenta séria e que não existe no shadcn.
2. **Status** — indicadores consistentes para desvio/risco/seguimento, em vez de
   badges ad-hoc.
3. **Ticker** — números que animam na faixa de estatísticas; barato e eleva
   bastante a perceção de qualidade.
4. **List / Kanban** — candidato natural para o painel do agente ("por devolver"
   → "em curso" → "fechado"). A decidir na fase 2.

**Do shadcnblocks: não comprar.** O catálogo é dominado por blocos de marketing
que não usamos, e os poucos de dashboard não valem 149 USD quando o shadcn e o
Kibo cobrem o mesmo de graça. Reavaliar apenas se aparecer uma landing page
pública do produto.

### O que faz mesmo a diferença no "ar de feito por AI"

Por ordem de impacto, e nada disto vem de uma biblioteca:

1. **Tipografia com hierarquia real** — já a temos (Georgia + etiquetas
   condensadas). Aplicá-la de forma consistente no painel do agente também.
2. **Densidade de informação** — mostrar mais por ecrã, menos espaço em branco
   decorativo. Ferramentas internas a sério são densas.
3. **Estados vazios e de erro escritos por humanos**, em português, específicos
   ("Não houve chamadas a 25 de abril — feriado") em vez de "No data available".
4. **Números com contexto** — variação face à média, não o valor isolado.
5. **Menos ícones.** Um ícone por título é a assinatura visual do gerado por AI.

## Consequência para a fase 2 (painel do agente)

O painel do agente herda a mesma linguagem: Georgia nos blocos narrativos,
etiquetas 10px maiúsculas, paleta neutra quente, densidade alta. Componentes
novos vêm do shadcn/ui e do Kibo UI, sempre re-vestidos com os tokens do
projeto. Nenhum bloco pago.
