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

## Bloqueio 2 — a migração dos dados (secção 5)

Duas coisas em falta:

1. **O `DATABASE_URL` do Replit**, para o `pg_dump`. Não o tenho. **É o único
   bloqueio que resta nesta secção.**
2. ~~Um proxy TCP no serviço `Postgres` do Railway~~ — **feito.** Ativo em
   `sakura.proxy.rlwy.net:50707` → porta 5432. O `DATABASE_PUBLIC_URL` no serviço
   `Postgres` resolve agora corretamente, e é por aí que a restauração deve
   entrar.

Falta portanto **apenas o `DATABASE_URL` do Replit** para esta secção.

## Bloqueio 3 — o n8n (secção 7)

A tarefa 7.1 manda procurar o hostname do Replit em toda a instância n8n e listar
todos os nós que lhe chamam. **Não há ferramenta de n8n disponível nesta sessão**,
portanto não consigo nem procurar nem repontar.

Nós conhecidos pelo `design.md`, a confirmar contra a instância real:

- cron diário do Supervisor Virtual, workflow `4rx93UXKxdDdmPpY` → `POST /api/run` com `X-Cron-Secret`
- qualquer workflow que consuma `GET /api/followups/pending` (Bearer)
- qualquer workflow que consuma `GET /api/alertas-dia`
- qualquer workflow que consuma `GET /api/email/summary`

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
