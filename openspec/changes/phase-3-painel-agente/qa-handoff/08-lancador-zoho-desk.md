# QA HANDOFF — Secção 7A: Lançador do Zoho Desk

Change: `openspec/changes/phase-3-painel-agente`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Resumo

Extensão Sigma para o Zoho Desk em `extension/zoho-desk`. Uma barra no topo com
um botão e a contagem de chamadas por devolver do agente. É a metade que faltava
do aperto de mão da sessão — o risco nº1 do handoff 07.

Nada no servidor mudou. Zero ficheiros alterados fora de `extension/` e da
documentação.

## Ficheiros

| Ficheiro | Alteração |
|---|---|
| `extension/zoho-desk/plugin-manifest.json` | **novo** — passa `zet validate` |
| `extension/zoho-desk/app/widget.html` | **novo** — o lançador |
| `extension/zoho-desk/app/translations/en.json` | **novo** |
| `extension/zoho-desk/resources.json` | **novo** — exigido pelo validador |
| `extension/zoho-desk/README.md` | **novo** — instalação e diagnóstico |
| `openspec/.../tasks.md` | 7A.1–7A.6 marcadas, 7A.7 parcial, nota do cabeçalho corrigida |

## O que foi mesmo exercitado

| Verificação | Como | Resultado |
|---|---|---|
| Chave `desk.topband` existe | documentação oficial da Zoho | **confirmada** — e documentada como *full screen* |
| Manifesto válido | `zet validate` (v1.0.28) | **passa** |
| Empacotamento | `zet pack` | **passa** — `dist/zoho-desk.zip`, 4 ficheiros |
| CORS do widget para a app | `OPTIONS` real contra produção com `Origin: https://desk.zoho.com` | **204**, com `access-control-allow-headers: content-type,x-painel-widget-token` |
| Guarda do widget viva | `POST /api/agente/sessao` sem token e com token errado | **401** nos dois (e não 503, logo o segredo está configurado em produção) |

O `zet validate` apanhou duas coisas que a minha leitura da documentação não
apanhou: `connectors` é obrigatório mesmo vazio, e o `resources.json` tem de
existir. Foi por isso que o corri em vez de confiar no que li.

## Riscos por ordem de gravidade

1. **A forma da resposta do `ZOHODESK.get()` não está documentada publicamente.**
   Nem para `user`, nem para `portal`, nem para `extension.config`. Não a
   consegui confirmar em lado nenhum que fosse fonte primária.

   O widget não adivinha uma forma: aceita quatro envelopes plausíveis e, se não
   encontrar identidade, **mostra na barra o que recebeu**. Um erro de forma
   passa a ser diagnosticável num relance em vez de produzir uma barra em
   branco. Mas continua a ser código escrito contra uma API não verificada, e é
   a primeira coisa a testar com `zet run`.

2. **Nunca correu dentro do Zoho.** Nem `zet run`, nem instalação, nem uma conta
   real. Toda a verificação acima é do manifesto, do empacotamento e do lado do
   servidor. O 7A.7 está por fazer e precisa de acesso ao Sigma.

3. **O token do widget é um segredo partilhado num pacote de cliente.** Quem o
   extrair pode pedir um token para qualquer colaborador que consiga nomear.
   Continua a ser a decisão em aberto na descrição do TRNSF-1561. Mitigado em
   parte por vir da configuração de instalação e não do repositório, o que
   permite rodá-lo sem reempacotar — mas não deixa de ser um segredo no cliente.

4. **Sem `logo` nem `icon`.** O template da Zoho tem os dois; o validador não os
   exige. A barra pode aparecer sem ícone na lista de extensões.

## Correção a documentação anterior

O cabeçalho do 7A dizia *"Desk cannot host a full-page dashboard"*. É falso, e já
era contradito pela nota de corte do 7B escrita a 2026-08-31. `desk.topband` é
ecrã inteiro.

O lançador mantém-se, mas por outra razão: dentro de um iframe o armazenamento é
particionado, e o cookie *first-party* de 8 horas do 7C só existe numa navegação
de topo. Corrigido no `tasks.md` para não induzir em erro quem ler a seguir.

**Decisão que fica para o Nuno:** com o topband a ser ecrã inteiro, é possível
desenhar o painel ali dentro e poupar o separador novo — um clique em vez de
dois. O custo é o 7C, que deixa de poder usar cookie e volta a depender de um
token de 15 minutos re-emitido em silêncio. Não escolhi sozinho.

## Estado

**READY FOR INDEPENDENT QA.**

Não aprovado, não pronto para produção. O risco nº1 e o nº2 só fecham dentro de
um portal real.
