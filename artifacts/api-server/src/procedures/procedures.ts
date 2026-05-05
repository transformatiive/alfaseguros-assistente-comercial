/**
 * Procedimentos da equipa Não Vida / 360 — Alfaseguros (strawman).
 *
 * Este texto alimenta o system prompt do analisador. Será substituído pela
 * versão revista da Soraia. Quando isso acontecer, reinicia o servidor e
 * força uma re-análise completa do dia (`force: true`) para que o modelo
 * passe a usar as novas regras.
 *
 * Mantemos o conteúdo num módulo TypeScript (em vez de um .md à parte) para
 * que o esbuild o inclua automaticamente no bundle CJS de produção.
 */
export const PROCEDURES_TEXT = `
# Procedimentos da equipa Não Vida / 360 — Alfaseguros

## Princípios gerais

1. **O cliente é o ponto de partida.** Não desperdiçar o tempo dele com
   recapitulações desnecessárias. Confirmar identidade no início de chamadas
   outbound. Nunca cumprimentar de forma vazia ou genérica.
2. **EU-PT em todas as comunicações.** Sem brasileirismos. Sem misturas.
3. **Tom coaching, não vigilância.** O feedback ao operador é para ele
   conseguir fechar mais — não para policiar. Mas seja específico.

## Abertura da chamada

- **Inbound**: identificar a Alfaseguros e o operador. Perguntar como pode
  ajudar.
- **Outbound**: identificar-se, identificar a Alfaseguros, **confirmar a
  identidade do cliente** antes de revelar dados, perguntar se é boa altura
  para falar.

## Qualificação

- Confirmar o produto pretendido (TVDE, Multirriscos, Auto, Saúde, etc.).
- Recolher dados mínimos para simulação: NIF, morada/CP, dados do bem
  (matrícula para auto, área para multirriscos, etc.).
- Em TVDE: confirmar a plataforma (Uber/Bolt/Free Now), idade, carta de
  condução, sinistros nos últimos 5 anos.
- Em Multirriscos: confirmar tipo de imóvel, regime (próprio/arrendado),
  área bruta privativa, número de casas de banho.

## Apresentação da proposta

- Apresentar pelo menos uma seguradora; se houver tempo, dar 2 opções.
- Explicar coberturas principais (não ler tudo) e as exclusões críticas.
- Dar valor anual + opções de fracionamento.
- **Nunca prometer** algo que dependa da seguradora aceitar (ex: aceitação
  imediata de um cliente com sinistralidade).

## Objeções comuns

- **Preço**: pedir o que está a comparar e em que termos. Reposicionar
  cobertura, não baixar preço sem motivo.
- **Vou pensar**: aceitar, mas combinar **um próximo passo concreto com
  data** ("posso ligar-lhe na quinta de manhã para confirmar?").
- **Já tenho seguro**: pedir data de renovação e proposta cega.

## Fecho e follow-up

- Combinar próximo passo **com data específica** (não "quando tiver
  disponibilidade").
- Enviar simulação por email logo após a chamada quando possível.
- Marcar tarefa de follow-up no Desk.

## Sinais que devem disparar alertas

- Cliente promete responder e não há follow-up agendado → risco de lead frio
- Operador desconhece campo do produto → registar para formação
- Cliente já chamou múltiplas vezes pela mesma questão → escalação ao
  supervisor
`.trim();
