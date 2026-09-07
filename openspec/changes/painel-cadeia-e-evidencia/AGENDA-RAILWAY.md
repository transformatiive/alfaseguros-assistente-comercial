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
- **Config**: `railway.agenda.json` — apontado em *Settings → Config as code*
- **Restart policy**: `NEVER` (é um trabalho pontual, não um servidor)
- **Variáveis**: `PUBLIC_APP_URL`, `CRON_WEBHOOK_SECRET`, `AGENDA_INTERVALO_MIN`

### Porque tem um ficheiro de configuração próprio

O `railway.json` da raiz corre `pnpm run build`, que constrói o repositório
inteiro — incluindo o `mockup-sandbox`, que exige `BASE_PATH` e faz o build
falhar sem ele. Um ficheiro de configuração no repositório sobrepõe-se ao que
está definido pela API ou pelo painel, por isso não bastava mudar o comando
de build no serviço: era ignorado. A agenda corre por `tsx` e não precisa de
build nenhum, só de `pnpm install`.

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
