# Bloqueios — o que falta para completar a migração

> Estado em 2026-08-30. As secções 1, 2 e a parte de código da 3 estão feitas e
> integradas no `main`. O que está abaixo não pode ser feito por dentro desta
> sessão: ou são segredos que só existem no Replit, ou são permissões, ou são
> sistemas a que não tenho acesso.

## Infraestrutura já criada no Railway

| Item | Valor |
|---|---|
| Projeto | `alfaseguros-supervisor` (`62cc6048-d7fa-424c-a418-5662ccae0ee6`) |
| Workspace | `transformatiive's Projects` |
| Ambiente | `production` (`81191daf-5591-45ef-af0b-ce44bda50921`) |
| Serviço app | `supervisor` (`6fdd6575-eece-45a8-9fdf-cfefb004a678`) |
| Serviço BD | `Postgres` (`2aa08612-8889-40cd-86f8-3dfd8726c692`) |
| Domínio | `supervisor-production-f030.up.railway.app` |
| Volume da BD | `postgres-volume`, montado em `/var/lib/postgresql/data` |

O serviço `Postgres` corre a **imagem oficial do Railway**,
`ghcr.io/railwayapp-templates/postgres-ssl:16`, com volume persistente,
`PGDATA` em `/var/lib/postgresql/data/pgdata`, e `POSTGRES_PASSWORD` gerada pelo
próprio Railway com `${{secret(40)}}` — o valor nunca passou por esta sessão nem
por ficheiro nenhum. `DATABASE_URL` e `DATABASE_PUBLIC_URL` são compostas por
referência a essa variável, e as variáveis de conveniência `PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD` e `PGDATABASE` estão expostas como no template oficial.

A imagem oficial não é um detalhe cosmético. A documentação do Railway é
explícita: *"PITR and HA require an official Railway PostgreSQL image"*, e a
conversão para alta disponibilidade só aceita
`ghcr.io/railwayapp-templates/postgres-ssl` ou
`ghcr.io/railwayapp-templates/postgres-ha/postgres-patroni`. A tag tem também de
estar **fixada numa versão maior** — o `:latest` não é suportado para HA. Está
fixada em `:16`, a mesma versão que o Replit corre (`.replit`, `postgresql-16`).

Uma primeira tentativa usou a imagem `postgres:16` do Docker Hub, configurada à
mão. Funcionava, mas ficava sem point-in-time recovery, sem caminho de conversão
para HA, e sem os backups do template. Foi substituída antes de qualquer dado
real lá entrar; o volume foi apagado e recriado para a imagem oficial
inicializar de raiz.

Fontes: https://docs.railway.com/databases/postgresql-ha e
https://docs.railway.com/cli/postgres

### Variáveis já postas no serviço `supervisor`

`DATABASE_URL` (referência a `${{Postgres.DATABASE_URL}}`), `NODE_ENV=production`,
`BASE_PATH=/`, `SESSION_SECRET` (gerado com `${{secret(64)}}`),
`ANALYSIS_CONCURRENCY=4`, `PUBLIC_APP_URL`.

## ~~Bloqueio 1 — segredos~~ — RESOLVIDO (2026-08-31)

O Nuno pôs as oito variáveis no Railway. Confirmado no serviço:
`RINGOVER_API_KEY`, `OPENROUTER_API_KEY`, `CRON_WEBHOOK_SECRET`,
`FOLLOWUP_API_TOKEN`, `ZOHO_DESK_CLIENT_ID`, `ZOHO_DESK_CLIENT_SECRET`,
`ZOHO_DESK_REFRESH_TOKEN`, `ZOHO_DESK_ORG_ID`. O `AGENT_EMAIL_MAP` já lá estava.

### Verificado a funcionar, não apenas presente

| Credencial | Como foi testada | Resultado |
|---|---|---|
| Zoho Desk (as quatro) | `GET /leads` no domínio real | **200**, 38 653 bytes, 51 linhas de dados reais. Antes dava 503 com "Zoho Desk não configurado". A cadeia Railway → OAuth Zoho → Desk API → HTML renderizado funciona ponta a ponta. |
| `CRON_WEBHOOK_SECRET` | `POST /api/run` com `source:"cron"` e segredo errado | **401 `Invalid X-Cron-Secret`**. A mensagem prova que a variável está lá — se faltasse, o código devolveria 503 `Cron secret not configured on server`. |
| `FOLLOWUP_API_TOKEN` | `GET /api/followups/pending` sem token e com token errado | **401** em ambos |
| `RINGOVER_API_KEY` | — | **Não testada.** Só é exercitada por uma análise real, que custa dinheiro e que não deve correr antes da restauração dos dados. |
| `OPENROUTER_API_KEY` | — | **Não testada**, pela mesma razão. |

### Achado de segurança encontrado durante estes testes

**`POST /api/run` não exige autenticação nenhuma a menos que o corpo traga
`source: "cron"`.**

Em `routes/runs.ts` a verificação do `X-Cron-Secret` está dentro de
`if (isCron)`, e `isCron` é `body.source === "cron"`. Um pedido como
`{"date":"2026-08-01"}`, sem `source`, salta a guarda por completo e segue para
a análise.

Isto **não foi introduzido pela migração** — é comportamento que já existia no
Replit, que também está num URL público. Mas a migração torna-o alcançável num
segundo domínio público, e os dois estão vivos ao mesmo tempo durante o período
de rollback.

Neste momento é inofensivo por acidente: a base de dados não tem schema, e o
pedido morre num `select ... from "runs"` antes de chegar ao `analyzeDay`. Foi
o que aconteceu nos testes — **nenhuma análise arrancou e nada foi gasto**.

**Passa a ser explorável exatamente no momento em que os dados forem
restaurados.** Qualquer pessoa que saiba o URL pode disparar uma análise
completa, que chama o Ringover e o OpenRouter e custa dinheiro.

Não foi corrigido: exigir o segredo em todos os caminhos é uma alteração de
comportamento, e esta change proíbe-as sem decisão do utilizador. **Decidir
antes da secção 5**, não depois.

### Variáveis opcionais por confirmar contra o Replit

Estas não estão no Railway e têm defaults no código. Se o Replit tiver valores
diferentes, o comportamento **muda** — o que viola a regra desta migração:

| Variável | Default no código | Risco se o Replit tiver outro valor |
|---|---|---|
| `OPENROUTER_MODEL` | `anthropic/claude-sonnet-4-6` | as análises passam a correr noutro modelo, com custo e output diferentes |
| `ZOHO_DESK_NAOVIDA_DEPARTMENT_ID` | `367662000000006907` | o `/leads` mostra outro departamento |
| `VIDA_AGENT_IDS` | vazio | agentes da equipa Vida deixam de ser excluídos |
| `FOLLOWUP_EXCLUDE_PRODUCTS` | `TVDE,Caravela` | os follow-ups passam a incluir produtos que hoje exclui |

**Confirmar nos Replit Secrets se algum destes está definido** e, se estiver,
copiar o valor.

## ~~Bloqueio 2 — migração dos dados~~ — DECIDIDO: começar do zero

**Decisão do Nuno, 2026-08-31:** não se migram dados. *"O supervisor neste
momento não é utilizado de forma consistente"* — o histórico não justifica o
risco nem o trabalho.

### O que isto perde, verificado contra o modelo de dados

| Tabela | Reconstrói-se? |
|---|---|
| `tickets`, `ticket_comments`, `ticket_sync_state` | sim — re-sincroniza do Zoho Desk |
| `cases` | sim — derivadas de chamadas + tickets |
| `runs` | sim — histórico de execuções, descartável |
| `conversations`, `daily_summaries`, `operator_summaries` | sim, mas **paga LLM outra vez** e o Ringover pode já não ter as chamadas antigas |
| `checklist_categories`, `checklist_items` | sim — `lib/db/src/seed/vida-fase1.ts`, idempotente |
| `colaboradores` | **parcialmente** — o seed só tem a equipa Vida (11 operadores). Os seis agentes da 360 (`23275673`–`23275679`) **não estão lá** |
| `users`, `recovery_codes` | não — mas o `seedAdminUser()` recria um admin, e o 2FA volta a configurar-se |

### Porque é que a lacuna do `colaboradores` não bloqueia

Levantei isto como risco e fui verificar. O `colaboradores` só é lido por
`jobs/vida-checklist.ts`, `routes/alertas.ts`, `routes/stats.ts` e
`analysis/category-stats.ts` — **tudo o fluxo da checklist Vida**, que é
exatamente o que o seeder cobre.

O fluxo principal do supervisor 360 (`/api/run` → conversas → follow-ups →
resumo por email) identifica agentes pelo **`AGENT_EMAIL_MAP`**, que é variável
de ambiente e já está posta no Railway. Não depende da tabela.

**Conclusão: começar do zero não parte nada que esteja em uso.**

### E é mais seguro do que uma cópia parcial

O `/api/followups/pending` lê de `conversations`. Com a tabela vazia devolve
nada, e o n8n não cria tarefas nenhumas no Desk. Uma cópia que trouxesse as
conversas mas não os `follow_up_acks` faria o n8n **duplicar tarefas** no
helpdesk para follow-ups já tratados. O zero evita isso por construção.

### O que fica por fazer

1. Aplicar o schema ao Postgres do Railway (`drizzle-kit push`), uma vez
2. ~~Correr o seed da Vida~~ — **não fazer.** O Nuno confirmou que a equipa Vida
   **ainda não usa o Zoho Desk**, e os workflows de checklist Vida no n8n estão
   inativos. Semear dados de uma equipa que não está a usar o sistema só cria
   ruído. Fica disponível em `lib/db/src/seed/vida-fase1.ts` (idempotente) para
   quando a Vida entrar.
3. Apagar o serviço `db-migracao` do Railway
4. **Rodar a password do Neon** — foi partilhada numa conversa

### A ferramenta de migração foi removida

`ops/db-migracao/` (Dockerfile + script de dump/restore) foi escrita e depois
apagada, porque deixou de ser precisa. As lições sobre o Railway ficam aqui:

- A imagem `postgres:16` não serve para correr comandos: o entrypoint quer
  arrancar um servidor e exige `POSTGRES_PASSWORD`.
- **O `startCommand` não é interpretado por uma shell.** É partido em palavras;
  `;`, `|`, `&&` e aspas chegam literalmente ao executável. Quatro tentativas
  falharam por isto, incluindo uma sugerida pelo agente do próprio Railway.
- **`redeploy` reutiliza a especificação antiga do contentor.** Mudar o
  `startCommand` e fazer `redeploy` continua a correr o comando anterior.
- O que funciona: um Dockerfile com `CMD ["/bin/sh", "/run.sh"]`, ou um
  `startCommand` sem nenhum metacaractere.

### Nota de rede, para o futuro

Esta sessão só tem saída HTTPS através de um proxy. **O protocolo do Postgres
não passa** — o DNS resolve e a ligação expira. Qualquer trabalho direto de base
de dados a partir daqui tem de correr do lado do Railway.

O proxy TCP do Postgres (`sakura.proxy.rlwy.net:50707`) existe e está ativo, mas
também não é alcançável daqui pela mesma razão. Serve para acesso a partir de
uma máquina normal.

## ~~Bloqueio 3 — o n8n~~ — RESOLVIDO (tarefa 7.1 feita)

O MCP do n8n não liga, mas a **API REST funciona**
(`https://trnsf.up.railway.app/api/v1/...`, header `X-N8N-API-KEY`). Varridos os
**464 workflows** da instância.

Resultado completo em **`N8N-INVENTARIO.md`**. Resumo:

- 48 workflows referem `.replit.`
- **Só 8 são desta aplicação.** Os outros 40 apontam para aplicações Replit
  completamente diferentes (Unicenter, AI Travel Find, To Be., Zoho-Moloni,
  AILE, AuditConsult, CJ Seguros). **Repontá-los partiria outros clientes.**
- 4 dos 8 estão **ativos**: o cron diário (`4rx93UXKxdDdmPpY`), os follow-ups
  (`NLE1zb5d0QgkMn4A`), o resumo por equipa (`rcycpfaZf9wRY9EH`) e o email de
  leads do Rui (`3MXCukLS8jqcXzIy`).

**O `design.md` estava incompleto.** Listava quatro chamadores; a varredura
encontrou mais quatro endpoints que ninguém tinha registado: `/api/leads` (num
workflow **ativo**), `/api/resumo-checklist-dia`, `/api/followups/{{id}}` (o ack)
e `/api/alertas-dia/confirmar`.

A tarefa **7.2 (repontar) não foi executada de propósito** — mandaria tráfego de
produção para uma base de dados vazia. Vem depois das secções 5 e 6.

## Bloqueio 4 — decisões que continuam em aberto

### O caminho do healthcheck

A delta-spec e a tarefa 3.4 dizem `/api/health`. A rota real é `/api/healthz`.
Apontei o Railway a `/api/healthz`, que é a opção sem alteração de comportamento.
**O texto da spec continua por corrigir** e vai contradizer a realidade quando a
delta for fundida no spec canónico.

### O utilizador admin por defeito

`seedAdminUser()` cria `admin` / `admin123` sempre que a tabela `users` está
vazia. Numa base de dados Railway nova e vazia isto **vai** acontecer, agora num
domínio público. Se a restauração dos dados (secção 5) correr antes de o serviço
arrancar, a tabela não estará vazia e o seed não dispara. Pela ordem atual, o
serviço arranca primeiro. **A verificar e, se preciso, a apagar depois da
restauração.**

### O `SESSION_SECRET` é novo

Gerei um em vez de copiar o do Replit. É o correto do ponto de vista de segurança,
mas significa que **todas as sessões abertas no Replit ficam inválidas** — o Nuno
e o Rui têm de voltar a autenticar-se depois do cutover. Se isso for indesejável,
copia-se o valor do Replit em vez do gerado.

## Ordem sugerida quando os bloqueios caírem

1. ~~Pôr os segredos~~ — feito
2. ~~Criar o proxy TCP~~ — feito
3. Decidir o achado de segurança do `POST /api/run` (ver bloqueio 1) e confirmar
   as quatro variáveis opcionais contra o Replit — **antes** de restaurar
4. `pg_dump` do Replit → restaurar no Railway
4. `pnpm --filter @workspace/db run push` contra o Railway, confirmar que não há drift
5. Verificar as contagens de linhas e a ausência do admin por defeito
6. Secção 6 inteira — verificação funcional antes do cutover
7. Só então a secção 7 (repontar o n8n, desligar o cron do Replit)
