# Painel do agente: cadeia, evidência e prazos inferidos

## Porquê

O painel lista o que existe. Devia raciocinar sobre o que falta.

Hoje uma tarefa é um registo: uma chamada não atendida, um ticket com mais de
24 horas, um `followUpDescricao` que o modelo escreveu. Sai da lista quando
alguém carrega num botão. Três consequências, todas verificadas em código:

1. **Não há noção de cadeia.** Um negócio percorre `pedido → simulação →
   follow-up`. O painel não sabe em que passo está, por isso não sabe qual é o
   passo em falta — mostra o registo, não o buraco.

2. **Não há verificação de conclusão.** `follow_up_sla_hours` é a constante
   `24` para toda a gente (`followups-shape.ts`), e `RISCO_THRESHOLD_HOURS` é
   `24` para todos os tickets (`tickets-risco.ts`). Nada olha para o que
   aconteceu *depois*: uma tarefa cumprida às 09:15 continua no ecrã até
   alguém a declarar feita. A única excepção é `computeDevolucoes`, que já
   resolve chamadas por evidência — mas só dentro do dia que foi buscar, e sem
   exigir duração mínima.

3. **Os prazos são falsos.** O modelo escreve *"até ao final do dia 03/09"*,
   *"até segunda-feira de manhã"*, *"dentro de 2 a 3 dias úteis"* — e o painel
   deita fora a frase e usa 24 horas a contar da análise. Um prazo que não é o
   prazo é pior do que nenhum: ensina o agente a ignorar a coluna.

E há um quarto problema, mais pequeno e mais irritante: as tarefas que vêm de
uma conversa trazem `linked_ticket_id` mas não trazem `deskUrl`, por isso a
linha sabe qual é o ticket e não deixa lá ir.

## O que muda

**Uma tarefa nasce de um buraco na cadeia e só desaparece com prova.** A prova
é uma de duas: uma chamada atendida ao cliente depois do compromisso, ou uma
resposta de um agente no ticket depois do compromisso. Sem nenhuma das duas, a
tarefa continua aberta — e a linha mostra essa ausência por escrito.

- `cadeia.ts` — o estado dos três passos por tarefa, e qual falta.
- `evidencia.ts` — a prova de conclusão, e o fecho automático quando existe.
- `prazos.ts` — o prazo por duas vias, dizendo sempre qual usou: a data escrita
  na promessa ou na thread, ou uma inferência a partir do tipo de ticket e do
  tempo em aberto sem resposta.
- `deskUrl` em todas as tarefas que tenham ticket, aberto noutro separador.

## O que não muda

O contrato de `/api/followups/pending` (lido por um workflow n8n activo) fica
byte a byte igual. Os campos novos entram só no payload do painel, que é nosso.

## Riscos

**Fazer desaparecer uma tarefa por fazer é muito pior do que deixar uma a
mais.** Uma chamada de 8 segundos que caiu no voicemail é um registo, não é uma
devolução; uma resposta automática do Desk não é uma resposta. A regra exige
chamada **atendida com duração mínima** e comentário de **saída, escrito por um
agente** (`authorType = 'AGENT'`). Na dúvida, a tarefa fica.
