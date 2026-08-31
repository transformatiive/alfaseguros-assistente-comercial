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

## Bloqueio 2 — a migração dos dados (secção 5) — EM CURSO

O Nuno deu o `DATABASE_URL` do Replit. A base de dados de origem é **Neon**
(`ep-shy-bonus-al8zijz...eu-central-1.aws.neon.tech`, base `neondb`), não um
Postgres do próprio Replit.

**Nota:** o endereço colado tinha `eu-central1`; o correto é `eu-central-1`.
Confirmado por DNS antes de o usar.

### O ambiente desta sessão não chega ao Neon

A rede desta sessão encaminha **só HTTPS** através de um proxy. O protocolo do
Postgres (TCP 5432) não passa: o DNS resolve mas a ligação expira. Confirmado
contra três endereços IP do Neon.

Portanto **o `pg_dump` não pode correr a partir daqui.**

### A solução: correr a migração dentro do Railway

Foi criado um serviço temporário **`db-migracao`** no próprio projeto Railway,
com duas variáveis:

- `SOURCE_DATABASE_URL` — o Neon
- `TARGET_DATABASE_URL` — `${{Postgres.DATABASE_URL}}`, por referência

O Railway resolve as duas do lado dele e tem saída de rede sem restrições. Os
dados vão do Neon para o Postgres do Railway **diretamente**, sem passar por esta
sessão nem por disco local.

Isto tem uma segunda vantagem importante: a palavra-passe do Postgres do Railway
**continua a nunca ser vista por mim**, porque é resolvida como referência dentro
da plataforma.

### Percalços do Railway, para quem vier a seguir

Três tentativas falhadas antes de acertar. Vale a pena registar:

1. **Imagem `postgres:16`** — o entrypoint da imagem tenta arrancar um servidor
   Postgres e exige `POSTGRES_PASSWORD`. Não serve para correr comandos.
   Trocada por `alpine` com o cliente instalado em arranque.
2. **`redeploy` reutiliza a especificação antiga do contentor.** Depois de mudar
   o `startCommand`, um `redeploy` continuava a falhar com o erro do comando
   *original*. Foi preciso **criar um serviço novo**, com o `startCommand`
   definido **antes** do primeiro deploy.
3. **O `startCommand` não é interpretado por uma shell** ao nível de topo.
   A forma que funciona é pôr o script inteiro numa variável e usar
   `sh -c "$SCRIPT"` como comando de arranque.

### Ordem de execução

Primeiro uma **inspeção só de leitura** — versões, tabelas, contagens de linhas
dos dois lados — para ter a linha de base da tarefa 5.4 e confirmar as ligações
**antes** de escrever seja o que for. Só depois o dump e a restauração.

### O proxy TCP

Criado e ativo em `sakura.proxy.rlwy.net:50707` → 5432. Deixa de ser necessário
para esta migração (que corre por dentro), mas fica útil para inspeção manual e
para a tarefa 5.4.

### ⚠️ Rodar a credencial do Neon depois

O `DATABASE_URL` do Neon foi colado numa conversa e está guardado como variável
no serviço `db-migracao`. **Depois da migração terminar:** apagar o serviço
`db-migracao` e **rodar a password no Neon**.

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
