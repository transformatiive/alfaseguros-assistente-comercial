# Extensão do Zoho Desk — lançador do painel

Uma barra no topo do Zoho Desk com um botão, **O meu painel**, e a contagem de
chamadas por devolver do próprio agente.

Não é o painel. É o que identifica o agente e o leva lá.

## Porque é um lançador e não o painel

`desk.topband` **é** ecrã inteiro — está documentado como tal e foi confirmado
contra a documentação da Zoho. A extensão podia, tecnicamente, desenhar o painel
inteiro aqui dentro.

Não o faz por uma razão diferente da capacidade: dentro de um iframe o
armazenamento do browser é particionado, e a sessão de 8 horas prevista na
secção 7C precisa de um cookie *first-party*, que só existe numa navegação de
topo. Abrir num separador novo é o que torna essa sessão possível.

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
GET /api/agente/painel ◄───────────┘
   (contagem na barra)
        │
   clique no botão
        ▼
novo separador: /agente#token=…
```

O token viaja no fragmento do URL — a única parte que os browsers nunca enviam
ao servidor nem escrevem num log de acessos. O painel lê-o uma vez e apaga-o.

Cada clique pede um token novo em vez de reutilizar o do arranque: a barra fica
aberta a manhã toda, e um token emitido às 09:00 já morreu às 11:00.

## Instalação

1. `zet validate` e depois `zet pack` nesta pasta. O pacote sai em
   `dist/zoho-desk.zip`.
2. Em [sigma.zoho.com](https://sigma.zoho.com), criar uma extensão **privada**
   para o Desk e carregar o zip.
3. Instalar no portal da Alfaseguros.
4. **Preencher os dois parâmetros de configuração** — sem eles a barra diz que
   não está configurada e não faz mais nada:

   | Parâmetro | Valor |
   |---|---|
   | Endereço do painel | `https://supervisor-production-f030.up.railway.app` (sem barra final) |
   | Token do widget | o mesmo valor de `PAINEL_WIDGET_TOKEN` no servidor |

O token do widget é pedido na instalação, e não escrito no código, por duas
razões: não vive no repositório, e pode ser rodado sem reempacotar a extensão.

## O que a barra diz quando corre mal

Nunca fica em branco. Cada falha diz o que fazer a seguir:

| Situação | O que aparece |
|---|---|
| Configuração por preencher | pede a um administrador que preencha os dois campos |
| Agente sem `zid` no painel (403) | nomeia o email dele e manda falar com o Nuno |
| SDK do Desk não carregou | pede para recarregar |
| Contagem falhou, mas o resto está bem | o botão continua a funcionar |

Uma falha silenciosa é indistinguível de um portal partido, e o agente não tem
como saber qual dos dois é.

## Por confirmar num portal real

A forma exata da resposta de `ZOHODESK.get("user")`, `("portal")` e
`("extension.config")` **não está no guia público** da Zoho. O widget aceita
várias formas plausíveis e, quando não encontra identidade nenhuma, mostra o que
recebeu — para o próximo a olhar resolver num relance em vez de adivinhar.

É o primeiro teste a fazer com `zet run` ou com uma conta real.
