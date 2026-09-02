# Plano: atribuição das chamadas perdidas

> Escrito depois de investigar como o n8n já resolve isto, e de medir os dados
> reais de 2026-08-28. **Plano, não implementação.** Nada aqui foi executado.

## O que se descobriu

### 1. A atribuição já existe — no n8n, não no painel

O workflow **Chamadas Perdidas** (`VbAYkchOjtsHVHIh`, ativo) faz, a cada evento
`missed` do Ringover:

1. procura o número nos contactos do Zoho Desk;
2. **contacto conhecido** → encontra o agente associado → cria o ticket
   atribuído a ele;
3. **contacto desconhecido** → round-robin pela folha de cálculo, escolhendo o
   agente com `Last Ticket Date Time` mais antigo, e atualiza-o.

O **Smart Routing** (`2UiBiV1YAUpEq0pz`) vai mais longe ainda antes da chamada
ser atendida: procura o **último ticket aberto** do contacto, tira o dono, e só
encaminha para ele se estiver online.

**Conclusão: toda a chamada perdida já é um ticket com dono.** O painel não
precisa de inventar atribuição — precisa de ler a que já foi feita.

### 2. A duplicação por múltiplas pernas NÃO acontece nestes dados

Eu tinha levantado o risco de uma chamada a tocar em vários agentes gerar várias
linhas. Medido a 2026-08-28:

```
Chamadas no total:              360
De entrada, não atendidas:       61
cdr_id distintos:                61
call_id distintos:               61
call_id com MAIS DE UMA perna:    0
```

**Zero.** Cada chamada perdida tem um `call_id` só seu.

**Ressalva importante, para não se tirar a conclusão errada:** a skill descreve
o comportamento dos **webhooks**, e eu medi a **API REST**. As duas coisas podem
ser ambas verdadeiras — o Ringover pode disparar um webhook por agente e a API
devolver um registo consolidado por chamada. Portanto:

- para o **painel**, que lê a API, o problema não existe;
- para o **n8n**, que consome webhooks, o problema pode continuar a existir e
  **não foi verificado aqui**.

### 3. Os 13 clientes repetentes são reinsistências genuínas

Todos com `call_id` distintos. Não é ruído técnico — são pessoas a ligar outra
vez porque ninguém atendeu:

```
...218111612   5 chamadas em 13 minutos   14:17 → 14:30
...917002259   5 chamadas em 33 minutos   14:45 → 15:18
...936127727   6 chamadas ao longo do dia 09:40 → 16:06
```

Isto é um problema de serviço, não de dados.

### 4. Dois terços das chamadas perdidas não têm agente

```
Perdidas COM user_id:   20
Perdidas SEM user_id:   41
```

Confirma o que já se suspeitava: ninguém atendeu, logo o Ringover não tem a quem
atribuir. A lógica atual do `computeDevolucoes` só atribui a quem **devolveu a
chamada mais tarde** — ou seja, atribui exatamente os casos **já resolvidos** e
deixa sem dono os que interessam.

### 5. As contas batem certo

61 perdidas − 30 já devolvidas no mesmo dia = **31 pendentes**, que é
exatamente o número que o balde partilhado mostrou. O cálculo está correto; o
que faltava era a atribuição e o sítio onde as pôr.

---

## O plano

### Passo 1 — Atribuir pelo dono do ticket (espelha o n8n)

Substituir a heurística atual por uma leitura do que o n8n já decidiu:

1. procurar na tabela `tickets` um ticket cujo `phone_fingerprint` bata com o
   `numero_normalizado` da devolução e cujo `created_time` seja **posterior** à
   chamada, dentro de uma janela curta (proposta: 30 minutos — o ticket é criado
   pelo webhook, portanto quase imediato);
2. o `assignee_id` desse ticket é um ZID → mapear para `colaboradores.zid`;
3. **fallback 1:** o `user_id` da própria chamada, quando existe;
4. **fallback 2:** o agente que devolveu a chamada mais tarde (regra atual);
5. sem nada disto → balde partilhado.

Isto não reimplementa o round-robin: **lê o resultado dele**. Se o n8n atribuiu
por round-robin, o painel mostra esse agente, e as duas superfícies concordam.

### Passo 2 — Guardar a ligação ao ticket

Coluna `ticket_id` em `devolucoes`. Permite:

- mostrar no painel *"já tem ticket #169559"* com link para o Desk;
- **e, sobretudo, resolver a dupla contagem** — ver passo 3.

### Passo 3 — Deixar de contar o mesmo trabalho duas vezes

Hoje uma chamada perdida de há três dias aparece **duas vezes** no painel: como
devolução e como ticket em risco. A fórmula de carga soma as duas e infla o
número do agente.

Com o `ticket_id` preenchido, a carga passa a contar **uma vez**: a devolução
cujo ticket já está no bloco de tickets em risco não soma outra vez.

> Isto muda a sugestão de redistribuição. Vale a pena rever os pesos
> (1 / 1,5 / 2) com o João Catalão depois desta correção, porque os números que
> ele vier a ver serão diferentes dos de hoje.

### Passo 4 — Agrupar reinsistências do mesmo cliente

Cinco linhas para o mesmo número em treze minutos é ruído no ecrã e esconde a
urgência. Uma linha, com *"5 tentativas, a última às 14:30"*, diz mais e ocupa
menos.

Agrupar por número normalizado dentro do mesmo dia, mantendo as linhas
individuais na base de dados (a idempotência depende do `ringover_call_id`).

### Passo 5 — Manter o balde partilhado

Continua a fazer falta: haverá sempre chamadas sem ticket correspondente. Mas
depois do passo 1 deve encolher muito — e é isso que confirma que o passo 1
funcionou.

---

## O que este plano NÃO faz, e porquê

- **Não mexe nos workflows do n8n.** A dedup por janela de tempo continua por
  implementar do lado deles, e o "Inbound/Outbound" continua a deixar cair
  chamadas atendidas de números desconhecidos. São falhas reais, registadas na
  skill, mas são outro âmbito e outro risco: mexer num workflow ativo que cria
  tickets em produção não se faz de passagem.

- **Não elimina o bloco de devoluções.** Cheguei a propor isso. O diagnóstico
  mudou-me a opinião: o bloco tem valor próprio, porque um ticket só entra em
  "risco" ao fim de 24 horas, e uma chamada perdida às 09:30 tem de aparecer às
  10:00, não no dia seguinte.

## Ordem sugerida

1. Passo 1 e 2 juntos — são a mesma consulta.
2. Passo 3 logo a seguir, senão os números pioram antes de melhorar.
3. Passos 4 e 5 com o ecrã (secção 6), que é onde se vê se ficou legível.

## Verificação

O passo 1 prova-se sozinho: hoje são 41 sem agente em 61. Depois da mudança,
esse número tem de cair muito. Se não cair, a janela de 30 minutos ou o
`phone_fingerprint` estão errados, e isso vê-se no mesmo diagnóstico.
