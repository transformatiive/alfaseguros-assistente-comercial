# Extensão do Zoho Desk — o painel dentro do Desk

O painel do agente, inteiro, numa faixa de ecrã inteiro no topo do Zoho Desk.

A extensão não desenha o painel: identifica o agente, emite-lhe um token de 15
minutos e aponta-lhe um `<iframe>`. O painel continua a ser servido pelo Railway.

## Foi um lançador até 13/09

Até aqui era uma barra fina com um botão **O meu painel** que abria um separador
novo. A razão era a sessão de 8 horas prevista na secção 7C: dentro de um iframe
o armazenamento do browser é particionado, e um cookie *first-party* só existe
numa navegação de topo.

Essa razão caiu porque a sessão de 8 horas também caiu. O painel (`lib/sessao.ts`)
guarda o token **só em memória** — sem cookie, sem `localStorage`, sem
`sessionStorage` — por isso não há nada que o particionamento possa partir. O
que se perde é a sessão longa; o que se ganha é o painel onde o agente já está,
sem um separador extra a gerir.

## Como funciona

```
Agente autenticado no Desk
        │
        ▼
ZOHODESK.get("user")  ──►  POST /api/agente/sessao   (X-Painel-Widget-Token)
        │                          │
        │                          ▼
        │                   token de 15 minutos
        ▼                          │
<iframe src="/agente#token=…"> ◄───┘
        │
        │  o painel apanha um 401 e diz
        ▼
postMessage "painel-agente:token-expirado"  ──►  novo token, novo src
```

O token viaja no fragmento do URL — a única parte que os browsers nunca enviam
ao servidor nem escrevem num log de acessos. O painel lê-o uma vez e apaga-o.

Três decisões que é fácil desfazer sem querer:

- **O token é emitido antes de o iframe ser desenhado.** Um iframe apontado a um
  token morto é uma página em branco, e branco é indistinguível de um portal
  partido. Emitir primeiro dá a cada falha um sítio onde ser dita.
- **A renovação é conduzida pelo painel, não por um relógio.** É o painel que
  sabe quando o token morreu — apanha um 401 e avisa. Um temporizador sozinho
  recarregaria a página debaixo das mãos do agente com o token ainda bom. O
  temporizador que existe só dispara com o separador escondido, onde o painel
  não faz pedidos e portanto nunca daria por nada.
- **A escuta de `message` verifica a origem.** Qualquer coisa na página pode
  enviar uma mensagem; agir sobre uma de outra proveniência era deixar um
  terceiro emitir-nos tokens à vontade.

## Enquadramento (framing)

Duas coisas têm de estar certas, e estão:

- O `/agente` responde sem `X-Frame-Options` e sem CSP `frame-ancestors`, por
  isso pode ser enquadrado. Confirmado a 13/09; nada a mudar no Railway.
- O manifesto autoriza o nosso domínio em `frame-src` **e** `child-src`
  (`connect-src` cobre o `fetch`, não o enquadramento). São iframes encadeados —
  Desk → `zappsusercontent.com` → Railway.

## Onde é que o widget aparece (e porque é que ninguém o encontra)

O `desk.topband` **não** é um item sempre visível na barra. Segundo a
documentação da Zoho: *"Click the More icon on the top of Zoho Desk portal. The
widgets configured in this location will be listed. Select the widget to be
loaded."*

Ou seja: **ícone "mais" (⋯) no topo do portal → escolher "O meu painel"**. Só
depois é que o painel ocupa o ecrã todo. Quem espera um separador novo na barra
não o encontra, e conclui que não tem permissões.

Duas coisas no manifesto também contavam para isso, e foram corrigidas:

- **Faltavam o `logo` e o `icon` do widget.** A lista do menu "mais" é
  desenhada a partir deles, e a documentação inclui-os no exemplo do
  `desk.topband`. Um item sem ícone é, na melhor das hipóteses, difícil de ver.
- **Havia um `"type": "personal"` no topo do manifesto.** Essa chave não existe
  no manifesto do Desk — as documentadas são `locale`, `service`, `storage`,
  `whiteListedDomains`, `modules`, `cspDomains`, `connectors`,
  `zohoAuthorisation`, `config`, `moduleSupport`, `updateBefore` e `secret`.
  Vem do Zoho Projects, onde "personal" significa que **cada utilizador**
  configura a extensão por si. Foi retirada: no melhor caso era ruído, no pior
  fazia a instalação comportar-se como pessoal em vez de da organização.

## Instalação

1. `zet validate` e depois `zet pack` nesta pasta. O pacote sai em
   `dist/zoho-desk.zip`. (O `zet pack` é um zip simples dos seis ficheiros —
   `app/widget.html`, `app/translations/en.json`, `app/img/logo.png`,
   `app/img/icon.png`, `plugin-manifest.json`, `resources.json` — por isso o
   pacote também se reconstrói sem o CLI, desde que a estrutura de pastas
   dentro do zip seja essa.)
2. Em [sigma.zoho.com](https://sigma.zoho.com), criar uma extensão **privada**
   para o Desk e carregar o zip.
3. Instalar no portal da Alfaseguros.
4. **Preencher os dois parâmetros de configuração** — sem eles o widget diz que
   não está configurada e não faz mais nada:

   | Parâmetro | Valor |
   |---|---|
   | Endereço do painel | `https://supervisor-production-f030.up.railway.app` (sem barra final) |
   | Token do widget | o mesmo valor de `PAINEL_WIDGET_TOKEN` no servidor |

O token do widget é pedido na instalação, e não escrito no código, por duas
razões: não vive no repositório, e pode ser rodado sem reempacotar a extensão.

## O que aparece quando corre mal

Nunca fica em branco. Cada falha diz o que fazer a seguir:

| Situação | O que aparece |
|---|---|
| Configuração por preencher | pede a um administrador que preencha os dois campos, e mostra o que o Desk devolveu |
| Agente sem `zid` no painel (403) | nomeia o email dele e manda falar com o Nuno |
| SDK do Desk não carregou | pede para recarregar |
| Renovação do token falhou | esconde o iframe e diz porquê — um painel morto não fica a fingir que está vivo |

Uma falha silenciosa é indistinguível de um portal partido, e o agente não tem
como saber qual dos dois é.

## Por confirmar num portal real

A forma exata da resposta de `ZOHODESK.get("user")`, `("portal")` e
`("extension.config")` **não está no guia público** da Zoho. O widget aceita
várias formas plausíveis e, quando não encontra identidade nenhuma, mostra o que
recebeu — para o próximo a olhar resolver num relance em vez de adivinhar.

É o primeiro teste a fazer com `zet run` ou com uma conta real.

## Porque é que o "Endereço do painel" não é realmente configurável

O domínio está fixado duas vezes no manifesto — `whiteListedDomains` e
`cspDomains`. Um valor diferente no campo de configuração seria
bloqueado pelo browser antes de chegar a lado nenhum. O campo continua a
existir (retirá-lo deixava órfão o valor já guardado no portal), mas o widget
tem o endereço por omissão no código e só precisa mesmo de ler o **token**.

Isto foi uma decisão tomada a corrigir um bug real: o widget dava-se como não
configurado porque não conseguia ler a resposta de
`ZOHODESK.get("extension.config")`, cuja forma a Zoho não documenta. Fazer o
arranque depender de duas leituras quando só uma é indispensável era um risco
sem retorno.

## A forma de `ZOHODESK.get("extension.config")`

A Zoho não documenta isto em lado nenhum — o `global-methods.html` documenta
User, Portal, Department e Current Call, e mais nada. Confirmado contra o
portal real a 13/09:

```json
{"extension.config": [
  {"name": "agenteAppUrl", "value": "https://…up.railway.app", "defaultValue": null},
  {"name": "widgetToken",  "value": "…",                       "defaultValue": null}
]}
```

**Um array de pares `{name, value, defaultValue}` sob a chave
`"extension.config"`.** Os nomes dos parâmetros são *valores* do campo `name`,
não chaves do objecto — foi assim que uma versão anterior do widget falhou: ia
à procura de chaves com esses nomes e nunca as encontrava.

O `procurarValores()` lê as duas formas, a de pares e a de chave directa, para
que um SDK futuro que achate o array não parta o arranque em silêncio.
