# Tarefas

## 1. Prazos com origem declarada  ✅
- [x] `painel/prazos.ts` — ler uma data prometida em português europeu:
      *"até ao final do dia 03/09"*, *"até quinta-feira"*, *"até segunda-feira
      de manhã"*, *"até às 21h"*, *"dentro de 2 a 3 dias úteis"*, *"até ao
      final da semana"*, *"no prazo de 48 horas"*.
- [x] Inferência por tipo de ticket quando não há data escrita: primeira
      resposta (24 h), simulação pedida (2 dias úteis), follow-up de simulação
      enviada (5 dias), à espera do cliente (10 dias antes de relembrar).
- [x] Cada prazo traz `origem` (`prometido` | `inferido`) e `porque`, para o
      cartão poder dizer qual usou.
- [x] Testes.

## 2. Cadeia  ✅
- [x] `painel/cadeia.ts` — os três passos (`pedido`, `simulacao`,
      `follow_up`), cada um `feito` / `em_falta` / `nao_aplicavel`, com data.
- [x] O passo em falta é o que dá o título e a categoria da tarefa.
- [x] Testes.

## 3. Evidência  ✅
- [x] `painel/evidencia.ts` — predicado puro: uma tarefa está feita se houver
      chamada atendida ao número depois do compromisso (≥ `DURACAO_MINIMA_SEG`)
      ou comentário de saída de um agente no ticket depois do compromisso.
- [x] `carregarEvidencias()` — uma consulta a `conversations` e uma a
      `ticket_comments`, por dia e por agente.
- [x] As tarefas com prova saem da lista e entram em `fechadasSozinhas`, com o
      motivo, para o painel poder mostrar o que se fechou sem clique.
- [x] Testes, incluindo os dois falsos positivos: chamada curta e comentário
      de sistema.

## 4. Ligação ao Desk  ✅
- [x] `deskUrl` derivado do `ticketId` em todas as categorias, não só nas que
      vêm de um ticket.
- [x] UI: `target="_blank" rel="noopener noreferrer"` em todas.

## 5. UI  ✅
- [x] Cadeia como três marcas na linha, com data.
- [x] A ausência por escrito, em cinzento, por baixo.
- [x] O prazo com a razão da inferência.
- [x] Cartão "fecharam-se sozinhas" — devolve o feedback que o botão dava.
- [x] Dropdown de agente com o desenho do painel (temporário, na
      pré-visualização).

## 6. Cadência — POR FAZER
- [ ] Separar as duas cadências: análise (LLM) às 08:00 e 16:30; verificação de
      evidência (SQL puro, sem LLM) de 15 em 15 minutos.
- [ ] Endpoint `POST /api/painel/evidencia` e cron n8n de 15 minutos.

## 7. Tom da leitura do dia — POR FAZER, A DECIDIR
- [ ] Segundo prompt para o painel do agente, em segunda pessoa e em tom de
      sugestão. `prompts.ts` proíbe hoje exactamente este registo ("TERCEIRA
      PESSOA OBRIGATÓRIA", com *"tens de…"*, *"faz isso…"*, *"liga-lhe…"*
      listados como PROIBIDOS) — e bem, para o painel do supervisor, que lê
      sobre terceiros. O painel do agente é o próprio a ler-se.
- [ ] Confirmar com o Nuno antes de duplicar a instrução.

## 8. Retirar os botões de estado — POR FAZER
- [ ] Com a evidência a funcionar, "Devolvida" e "Concluir" passam a ser
      declarações redundantes. Fica só o "não se aplica", que é o único juízo
      que nenhuma evidência consegue fazer.
- [ ] Depende de 6: sem a verificação de 15 em 15 minutos, tirar os botões
      deixa o agente sete horas a olhar para trabalho já feito.

## 6. Cadência — FEITO
- [x] `scripts/src/agenda-plano.ts` — a regra, pura: que trabalhos são devidos
      a um dado momento de Lisboa. `scripts/src/agenda.ts` — o disparo.
- [x] Um só cron no Railway, de 15 em 15 minutos. **A decisão de hora está no
      código e não na expressão cron**: os agendamentos do Railway são
      avaliados só em UTC, e Portugal é UTC+1 sete meses por ano e UTC+0 os
      outros cinco. `0 7 * * 1-5` são 08:00 em agosto e 07:00 em janeiro.
- [x] `runPainelRefresh` aceita `janelaHoras`: os ticks frequentes pedem 2
      horas de histórico do Desk, os de 08:00/16:30 pedem 2 dias. Sem isto,
      cinquenta corridas por dia custavam cinquenta sincronizações de 2 dias.
- [x] 9 testes sobre a regra, cada um com o mesmo momento de Lisboa escrito
      nos dois offsets.
