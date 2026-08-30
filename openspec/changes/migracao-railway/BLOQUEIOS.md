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

O serviço `Postgres` é a imagem `postgres:16` configurada à mão, não o template
gerido do Railway: volume persistente, `PGDATA` em `/var/lib/postgresql/data/pgdata`,
e `POSTGRES_PASSWORD` gerada pelo próprio Railway com `${{secret(40)}}` — o valor
nunca passou por esta sessão nem por ficheiro nenhum. `DATABASE_URL` e
`DATABASE_PUBLIC_URL` são compostas por referência a essa variável.

### Variáveis já postas no serviço `supervisor`

`DATABASE_URL` (referência a `${{Postgres.DATABASE_URL}}`), `NODE_ENV=production`,
`BASE_PATH=/`, `SESSION_SECRET` (gerado com `${{secret(64)}}`),
`ANALYSIS_CONCURRENCY=4`, `PUBLIC_APP_URL`.

## Bloqueio 1 — segredos que só existem no Replit (tarefas 4.1 e 4.5)

Não tenho acesso aos Replit Secrets. Sem estas, o serviço arranca e serve a UI,
mas não busca chamadas, não analisa e não fala com o Desk.

| Variável | Onde está hoje | Consequência de faltar |
|---|---|---|
| `RINGOVER_API_KEY` | Replit Secrets | sem chamadas, sem análise |
| `OPENROUTER_API_KEY` | Replit Secrets | sem análise LLM |
| `CRON_WEBHOOK_SECRET` | Replit Secrets | o cron do n8n não consegue autenticar em `POST /api/run` |
| `FOLLOWUP_API_TOKEN` | Replit Secrets | `/api/followups/*` inacessível ao n8n |
| `ZOHO_DESK_CLIENT_ID` | Replit Secrets | sem tickets |
| `ZOHO_DESK_CLIENT_SECRET` | Replit Secrets | sem tickets |
| `ZOHO_DESK_REFRESH_TOKEN` | Replit Secrets | sem tickets |
| `ZOHO_DESK_ORG_ID` | Replit Secrets | sem tickets |
| `AGENT_EMAIL_MAP` | **`.replit`, secção `[userenv.shared]`** — não nos Secrets | `/api/followups/pending` fica sem o mapa agente→email |
| `VIDA_AGENT_IDS` | opcional | usa só o conjunto hardcoded |
| `FOLLOWUP_EXCLUDE_PRODUCTS` | opcional | usa o default `TVDE,Caravela` |
| `ZOHO_DESK_NAOVIDA_DEPARTMENT_ID` | opcional | usa o default no código |

O `AGENT_EMAIL_MAP` está commitado no `.replit` deste repositório, portanto esse
posso ir buscar — mas continua a ser preciso confirmar que o valor está atual.

**O que é preciso:** os valores, postos como variáveis do serviço `supervisor` no
Railway. Preferencialmente pelo Nuno diretamente na dashboard, para os segredos
não passarem por uma conversa.

## Bloqueio 2 — a migração dos dados (secção 5)

Duas coisas em falta:

1. **O `DATABASE_URL` do Replit**, para o `pg_dump`. Não o tenho.
2. **Um proxy TCP no serviço `Postgres` do Railway**, para conseguir restaurar de
   fora da rede privada. Tentei criá-lo e a ação foi **negada por permissões**
   nesta sessão. Ou se desbloqueia a permissão, ou o proxy é criado à mão na
   dashboard do Railway (serviço `Postgres` → Settings → Networking → TCP Proxy,
   porta 5432).

Sem o proxy ainda é possível restaurar, correndo o `pg_restore` a partir de um
serviço temporário dentro do próprio projeto Railway — mas o proxy é bem mais
simples.

O `DATABASE_PUBLIC_URL` já está composto no serviço `Postgres` à espera das
variáveis `RAILWAY_TCP_PROXY_DOMAIN` e `RAILWAY_TCP_PROXY_PORT`, que só existem
depois de o proxy ser criado.

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

1. Pôr os segredos (bloqueio 1) no serviço `supervisor`
2. Criar o proxy TCP (bloqueio 2)
3. `pg_dump` do Replit → restaurar no Railway
4. `pnpm --filter @workspace/db run push` contra o Railway, confirmar que não há drift
5. Verificar as contagens de linhas e a ausência do admin por defeito
6. Secção 6 inteira — verificação funcional antes do cutover
7. Só então a secção 7 (repontar o n8n, desligar o cron do Replit)
