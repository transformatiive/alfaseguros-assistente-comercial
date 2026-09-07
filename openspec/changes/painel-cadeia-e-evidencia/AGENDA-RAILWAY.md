# O agendamento no Railway

## Os dois trabalhos

| Trabalho | Endpoint | Ritmo | Toca no modelo? |
|---|---|---|---|
| Refresh dos canais | `POST /api/painel/refresh` | 15 min, 07:00–20:00, dias úteis | **Não**, por construção e por teste |
| Análise | `POST /api/run` | 08:00 e 16:30, dias úteis | Sim, por conversa |

O refresh ressincroniza as chamadas do dia no Ringover e os tickets e
comentários recentes no Desk. São esses dois canais que a verificação de
evidência lê, por isso uma resposta enviada no Desk às 09:15 só faz a tarefa
desaparecer depois de isto ter corrido. A verificação em si é SQL puro e
acontece a cada leitura do painel — não tem cron nem custo.

## Porque é que a hora está no código e não no cron

**Os agendamentos do Railway são avaliados só em UTC.** Não há campo de fuso.
Portugal é UTC+1 durante sete meses e UTC+0 nos outros cinco, por isso
qualquer expressão fixa está certa para metade do ano: `0 7 * * 1-5` são 08:00
em agosto e 07:00 em janeiro.

Para o refresh isso não teria importância. Para a análise tem: as 08:00
existem para estar pronta antes de as pessoas chegarem, e as 16:30 estão
coladas ao fim do dia de trabalho.

Então o cron é `*/15 * * * *` e é `scripts/src/agenda-plano.ts` que decide,
lendo `Europe/Lisbon` pelo Intl, quais dos trabalhos são devidos naquele
momento. O horário acompanha as mudanças da hora porque vem do tzdata.

## O serviço

- **Nome**: `agenda` (projeto *Alfaseguros Supervisor Virtual*)
- **Cron**: `*/15 * * * *`
- **Start command**: `pnpm --filter @workspace/scripts run agenda`
- **Restart policy**: `NEVER` (é um trabalho pontual, não um servidor)
- **Variáveis**: `PUBLIC_APP_URL`, `CRON_WEBHOOK_SECRET`, `AGENDA_INTERVALO_MIN`,
  `BASE_PATH`

### Porque é que a agenda precisa de `BASE_PATH`

Não precisa — precisa o *build*. O `railway.json` da raiz corre
`pnpm run build`, que constrói o repositório inteiro, incluindo o
`mockup-sandbox`, cujo `vite.config.ts` rebenta se `BASE_PATH` não estiver
definida. O primeiro build da agenda falhou exactamente aí.

O caminho limpo seria um ficheiro de configuração só para este serviço, mas o
Railway depreciou o config-as-code (`railway.json` / `railway.toml`) a favor
de `.railway/railway.ts`, e a API já recusa apontar um ficheiro alternativo.
Por isso a agenda leva `BASE_PATH=/`, que nunca usa: o valor só existe para o
build do repositório passar. É desperdício — a agenda constrói frontends de
que não precisa — mas só acontece quando há um commit novo, nunca nas
corridas do cron, que reutilizam o build.

Vale a pena, um dia, fazer o `mockup-sandbox` assumir um valor por omissão em
vez de rebentar: hoje `pnpm run build` na raiz também falha numa máquina
local sem essa variável.

## Verificar

Nos logs do serviço, cada corrida imprime a decisão antes de fazer o que quer
que seja:

```
Tick: 09:15 em Lisboa → refresh=true análise=false
refresh → HTTP 200 {"data":"2026-09-08","devolucoes":{...},"tickets":{...}}
```

Um tick fora de horas diz `Nada a fazer neste tick.` e sai com 0.

## O que desligar no n8n

Os dois crons que hoje disparam `painel/refresh` e `run` a partir do n8n
passam a ser duplicados. Devem ser desativados — não por custo (a análise não
reanalisa o que já tem `analysisJson`), mas para haver **uma só** fonte da
verdade sobre quando é que estas coisas correm.

## Por fazer: desligar os crons do n8n

Os agendamentos que hoje existem no n8n para disparar `POST /api/run` e
`POST /api/painel/refresh` passaram a ser duplicados do serviço `agenda`.

Não é uma questão de custo — a análise não reanalisa uma conversa que já
tenha `analysisJson`, por isso a segunda corrida do dia é quase gratuita. É
uma questão de haver **uma só** resposta à pergunta "quando é que isto
corre". Com dois agendadores, quem investigar uma manhã em que o painel
chegou vazio tem de descobrir primeiro qual dos dois falhou.

Ficam identificados:

- `4rx93UXKxdDdmPpY` — *ALFASEGUROS: Supervisor Virtual — Daily Cron*,
  `POST /api/run`
- o workflow de refresh do painel criado em setembro, `POST /api/painel/refresh`
  às 08:00 e 16:30 (`Europe/Lisbon`)

Basta desativá-los (não apagar: o histórico de execuções é útil se algo
correr mal na primeira semana do serviço novo).
