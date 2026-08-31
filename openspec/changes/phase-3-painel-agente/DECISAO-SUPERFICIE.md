# Decisão: a superfície do painel é o Zoho Desk, ecrã inteiro

> Registada a pedido do utilizador, 2026-08-30, durante a sessão da migração
> Railway. **Corrige uma premissa factualmente errada no `design.md`.** O
> `design.md`, o `proposal.md`, o `tasks.md` e o delta-spec ainda **não** foram
> reescritos — ver "Impacto" no fim.

## O que o utilizador quer

Um menu na **barra de topo do Zoho Desk** que abre o dashboard **em página
inteira dentro do Desk**. Nada de painéis laterais. Referência concreta dada
pelo utilizador: a extensão *Monday.com for Zoho Desk* (Spritle), no marketplace
do Desk, que aparece como item de menu no topo e abre uma página própria na área
de conteúdo do Desk.

## A premissa errada

`design.md` → "Decision: Zoho CRM Web Tab is the home of the full-page dashboard;
Zoho Desk gets a launcher" afirma:

> **Zoho Desk cannot host a full-page dashboard.** [...] `desk.topband` is full
> screen **width** but is a band [...] There is no arrangement of these that
> yields a full page.

Isto está errado. A documentação oficial das localizações de widgets do Zoho Desk
descreve `desk.topband` como:

| Location key | Renders | Access point |
|---|---|---|
| `desk.topband` | **Full-screen view** | **More icon in top navigation bar** |

E, textualmente: *"The selected widget will be loaded on the entire screen of
desk."*

Fonte: https://www.zoho.com/desk/extensions/guide/WidgetLocations.html

`desk.topband` **é** a localização de ecrã inteiro, não uma faixa. É exatamente o
que o screenshot da extensão Monday.com mostra.

## Decisão

- O painel do agente vive em **`desk.topband`**, renderizado em página inteira
  dentro do Zoho Desk. Esta é a superfície primária e, por agora, a única.
- **Não** há painel lateral, nem `*.detail.rightpanel`, nem `*.detail.lefttab`.
- O Zoho CRM Web Tab **deixa de ser a superfície primária**. Fica no máximo como
  hipótese futura, se e quando a migração da equipa 360 para o CRM (Plan §8.2)
  acontecer. Não é âmbito da fase 3.
- Deixa de ser preciso abrir o dashboard num separador novo do browser. O agente
  fica dentro do Desk.

## Por confirmar na implementação

- **O ponto de acesso exato.** A documentação diz "More icon in top navigation
  bar". O screenshot do utilizador mostra o item visível diretamente na barra de
  topo, não escondido atrás de um "More". Provavelmente o Desk mostra as
  extensões instaladas na barra e só as empurra para o "More" quando não há
  espaço — mas isto não foi confirmado e deve ser validado com a extensão
  instalada num portal real.
- A tarefa 7A.2 do `tasks.md` já manda confirmar a chave da localização contra o
  schema atual do manifesto Sigma em vez de a copiar de um blog. Isso mantém-se:
  o que está acima vem da documentação oficial da Zoho, não do manifesto, e as
  chaves mudam entre versões.
- Se o widget corre em iframe dentro do Desk, a decisão "Identity comes from the
  Zoho JS SDK, not from cookies" do `design.md` **mantém-se válida e passa a ser
  ainda mais central** — deixa de haver o caminho first-party do separador novo
  que permitia o cookie de 8 horas. Ver "Impacto".

## Impacto (por tratar na sessão da fase 3)

Esta correção cascateia. Nada disto foi alterado ainda:

| Ficheiro | O que precisa de mudar |
|---|---|
| `design.md` | reescrever a decisão da superfície; rever a tabela de contextos de sessão — o caminho "opened from the Desk topband button / first-party / cookie de 8h" deixa de existir se o painel corre embebido |
| `proposal.md` | linhas 18 e 42: deixa de haver "dois embeds"; passa a haver um |
| `specs/supervisor/spec.md` | `#### Scenario: Full page inside Zoho CRM` (linha 54) e a linha 90 (`THEN it is a desk.topband launcher that opens the dashboard elsewhere`) contradizem esta decisão |
| `tasks.md` | 0.5 (licenças CRM) e 0.6 (`crmUserId`) deixam de ser necessárias; secção 7B (CRM Web Tab) cai; 7A passa a ser o painel completo e não um launcher; 8.8 e 8.11 mudam |

**Decisão em aberto para o utilizador:** o cookie de 8 horas que fazia um
bookmark funcionar dependia de o dashboard abrir como página de topo. Se o painel
passa a viver embebido no Desk, esse caminho desaparece e o token em memória
(15 min, re-mintado) passa a ser o único mecanismo. Isso é mais simples e mais
seguro, mas significa que não há bookmark — o agente entra sempre pelo Desk.
Confirmar se é aceitável.

---

## Resposta à tarefa 0.5 (2026-08-31)

O Nuno confirmou: **todos os agentes da equipa 360 têm licenças Zoho One com
acesso ao Zoho Desk.**

Consequências:

1. **A tarefa 0.5 fica fechada.** Não há barreira de licenciamento — nem no
   Desk, nem no CRM (o Zoho One inclui ambos).

2. **A secção 7B (Zoho CRM Web Tab) deixa de ser necessária.** Ela só existia
   como contorno à premissa errada de que "o Desk não consegue alojar uma
   página inteira". Como o `desk.topband` é uma vista de ecrã inteiro, e como
   é isso que o utilizador pediu explicitamente — *"um menu no topo do desk, e
   depois o dashboard em baixo, nada de barras laterais"* — o CRM é um desvio
   sem retorno.

   Recomendação: **cortar a 7B**, e com ela a tarefa 0.6 (`crmUserId`) e o
   ramo `crm` da resolução de identidade. A coluna e o código já existem e são
   inofensivos, mas ficam sem utilizador.

   Isto é uma decisão de âmbito, não uma implementação. Fica registada, não
   executada.

3. **A secção 7C (sessão sem emenda) simplifica-se.** Sem contexto de iframe do
   CRM, a única via é a de topo, a partir do Desk — o que torna o cookie de 8
   horas viável sem a ressalva do `window.top !== window.self`. A regra de
   nunca ler o cookie quando embebido continua a valer como defesa, mas deixa
   de haver um caso real que a exercite.
