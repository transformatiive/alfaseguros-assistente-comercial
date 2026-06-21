# Notas futuras — Supervisor Virtual (a rever mais tarde)

> Ideias e melhorias adiadas, guardadas para revisão. Não fazem parte do MVP atual.

## 1. Transcrição completa em vez do resumo de IA da Ringover  *(prioridade alta — qualidade da análise)*

**Problema observado (teste real de 19/06/2026, equipa Vida):**
Na validação do checklist da Fase 1, **48% dos pontos ficaram `indeterminado`**
(699 de 1445). A causa não é o motor — é a **fonte de dados**: o campo `note`
da Ringover é um **resumo gerado por IA** (~500 caracteres, máx ~1500), não a
transcrição literal. Para quase metade dos pontos do guião, o resumo não tem
detalhe suficiente para decidir `cumprido` vs `nao_cumprido`.

**Ideia:** deixar de depender do resumo de IA da Ringover e passar a usar a
**transcrição real e completa** da chamada, fazendo **nós a síntese/análise**
(é exatamente o que o nosso motor faz melhor). Isto deve **reduzir
drasticamente o `indeterminado`** e tornar a taxa de cumprimento muito mais fiável.

**Duas vias para obter a transcrição completa:**

1. **Whisper sobre o áudio** *(mudança maior — fica para depois)*
   - A Ringover guarda o áudio no campo `record` (URL) de cada chamada.
   - Pipeline novo: descarregar o áudio → transcrever (Whisper/STT) → alimentar
     a transcrição completa ao analisador (narrativa **e** checklist).
   - Custos a considerar: download de áudio, tempo/custo de STT, armazenamento.

2. **Transcrição direta da Ringover, sem a síntese de IA deles** *(✅ CONFIRMADO que existe)*
   - **Descoberta (sondagem real à API v2, 21/06):** a Ringover **fornece a
     transcrição completa** via `GET /transcriptions/{call_id}`.
   - Resposta: lista com `transcription_data.speeches[]` — cada segmento tem
     `channelId` (0/1 → separa interlocutores), `start`, `end`, `text` e
     `words[]`. Há `transcription_status` (`DONE`) e info do utilizador/agente.
   - **Concatenar os `speeches[].text`** dá o diálogo completo, sem qualquer
     síntese de IA. Pode-se prefixar por canal (ex.: `Agente:` / `Cliente:`).
   - **Prova de valor (mesma chamada):** resumo (`note`) = 606 caracteres;
     transcrição concatenada = **2828 caracteres / 40 segmentos** (~4,7×), com
     o diálogo literal ("*Olá, sou a Ana de Alfa Seguros…*").
   - Endpoints úteis confirmados: `GET /transcriptions` (lista),
     `GET /transcriptions/{call_id}` (por chamada). A chave da API está nos
     workflows Ringover do n8n (`Authorization: <key>`, sem prefixo Bearer).
   - **Ressalvas:** só chamadas **gravadas** têm transcrição; verificar
     cobertura (nem todas terão `record`/transcrição) e o `transcription_status`
     (pode estar pendente em chamadas recentes). Tratar 404/vazio com fallback
     para o `note`.
   - **A FAZER:** método `getTranscription(callId)` no cliente Ringover +
     concatenador; alimentar a transcrição (em vez do `note`) ao grupo/legs.

**Onde mexe (quando for feito):**
- `lib/ringover/` — cliente + tipos (novo campo/endpoint de transcrição, ou
  cliente de áudio + STT).
- `artifacts/api-server/src/grouping/conversations.ts` — `ringoverSummary` da
  leg passaria a conter a transcrição completa em vez do resumo.
- Os prompts (`prompts.ts`, `checklist-prompt.ts`) — ajustar para "transcrição
  completa" e gerir o orçamento de tokens (transcrições são muito maiores).
- Guarda de tokens: transcrições longas podem rebentar o contexto; truncar/
  resumir por segmentos antes, se necessário.

**Impacto esperado:** menos `indeterminado`, taxa de cumprimento mais credível,
evidências (`evidencia`) mais ricas e citáveis.
