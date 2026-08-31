# Configuração do serviço no Railway — o `railway.json` não chega

> Descoberto em 2026-08-31, a meio da secção 5.

## O que aconteceu

Um deploy falhou na fase de build com:

```
Railpack 0.38.0
  ↳ Detected Node
  ↳ Using pnpm package manager
  ↳ Found workspace with 12 packages
  ✖ No start command detected.
```

O diagnóstico do deployment mostrou `"builder": "RAILPACK"` e
`"startCommand": null` — apesar de o `railway.json` na raiz do repositório
declarar `"builder": "NIXPACKS"` e um `startCommand`.

**Conclusão: o `railway.json` não estava a ser aplicado.**

## Porque é que isto passou despercebido

Os deploys anteriores funcionaram, o que deu a impressão de que o ficheiro
estava a ser lido. Não estava — o Railpack conseguia inferir o arranque sozinho
nesse momento, e o serviço subia à mesma. O erro só apareceu quando um
`update-service` reescreveu a configuração e o Railpack deixou de conseguir
inferir.

## Correção do que foi afirmado antes

Na secção 3 escrevi que o healthcheck estava apontado a `/api/healthz` via
`railway.json`. **Isso estava errado.** O que verifiquei de facto foi que
`GET /api/healthz` responde 200 — o que é verdade e continua a ser. Mas o
Railway não estava a sondá-lo, porque não tinha healthcheck configurado de todo.
Um serviço em mau estado teria continuado a receber tráfego.

## A causa real: o Railpack lê o *repositório*, não o serviço

Definir `startCommand` na configuração do serviço **não resolveu**. O build
continuou a falhar com a mesma mensagem, agora com
`"startCommand": "node artifacts/api-server/dist/index.mjs"` visível no
diagnóstico.

A razão está no comando que o Railway corre:

```
railpack prepare /app --error-missing-start ...
```

A fase de *prepare* do Railpack acontece **antes** de a configuração do serviço
entrar em jogo, e a flag `--error-missing-start` aborta o build se não encontrar
um comando de arranque **no repositório**. A documentação do próprio Railpack
diz o que ele procura, por ordem: um script `start` no `package.json`, um campo
`main`, um `index.js`/`index.ts` na raiz.

**A correção é um script `start` na raiz do `package.json`:**

```json
"start": "node artifacts/api-server/dist/index.mjs"
```

É a primeira coisa que o Railpack procura, e é idiomático num monorepo com um
único serviço deployável.

## O que passou a ser feito

A configuração passa a estar **no serviço**, não só no ficheiro:

| Definição | Valor |
|---|---|
| `buildCommand` | `pnpm install --frozen-lockfile && pnpm run build` |
| `startCommand` | `node artifacts/api-server/dist/index.mjs` |
| `healthcheckPath` | `/api/healthz` |
| `healthcheckTimeout` | 300 |

O `railway.json` foi mantido e **alinhado** com estes valores, menos o
`"builder": "NIXPACKS"`, que foi **removido** — o Railway usa Railpack e o pin
ao Nixpacks era, na melhor das hipóteses, ignorado.

O ficheiro fica como documentação da intenção e para o caso de o serviço ser
recriado. **Mas a fonte de verdade é a configuração do serviço.** Quem recriar o
serviço tem de repor estas quatro definições à mão.

## Verificar

```
GET https://supervisor-production-f030.up.railway.app/api/healthz  →  200 {"status":"ok"}
```

E, na dashboard do Railway, confirmar que o serviço mostra o healthcheck em
`/api/healthz` — não basta o endpoint responder.

## Como se aplica o schema no Railway (2026-08-31)

**Conclusão: o `preDeployCommand` do Railway não funciona neste serviço, e o
`railway.json` está deprecado. O schema é aplicado por um serviço dedicado.**

### O que falhou, e o que se aprendeu

O schema da fase 3 (`devolucoes`, `colaboradores.papel`,
`colaboradores.crm_user_id`) não entrou, e a app passou a devolver 500 em
`/api/agente/sessao`:

```
Error: Failed query: select "id", "nome", "ringover_user_id", "zid",
"crm_user_id", "email", "telefone", "equipa", "papel", "ativo", ...
from "colaboradores" where (lower("colaboradores"."email") = $1 ...)
```

Três tentativas, e o que cada uma ensinou:

1. **`preDeployCommand` na configuração do serviço** — a configuração
   *persiste* (uma leitura posterior mostra
   `"preDeployCommand": ["pnpm --filter @workspace/db run push"]` e
   `"preDeployTimeoutSeconds": 600`), mas **o passo nunca corre**.

   > **Correção.** Numa versão anterior deste documento escrevi que a
   > definição "não persiste", porque uma leitura intermédia devolveu
   > `"preDeployCommand": []`. Isso era um efeito de temporização da escrita,
   > não a causa. A causa é a mesma do ponto 2: o passo não é criado.

2. **`preDeployCommand` no `railway.json`** — a configuração *é lida* (o
   `propertyFileMapping` do deploy mostra
   `"deploy.preDeployCommand": "$.deploy.preDeployCommand"`), mas o passo
   **nunca é criado**. A lista de passos do deploy é:

   ```
   SNAPSHOT_CODE → BUILD_IMAGE → PUBLISH_IMAGE → CREATE_CONTAINER
   → HEALTHCHECK → CONFIGURE_NETWORK → DRAIN_INSTANCES
   ```

   Não há passo de pre-deploy nenhum. Não é a forma do comando.

3. **Serviço dedicado `db-schema-push`** — funciona. Repo `main`,
   `startCommand` = `pnpm --filter @workspace/db run push`, política de
   reinício `NEVER`, `DATABASE_URL` por referência ao Postgres, e
   `BASE_PATH=/`.

### Duas coisas que estavam mal registadas antes

- **A configuração ao nível do serviço persiste.** O que não acontece é o
  passo de pre-deploy ser criado — em nenhuma das três tentativas, e
  independentemente de a configuração vir do serviço ou do ficheiro.

- **O `railway.json` NÃO é apenas documentação.** É aplicado: o build do
  `db-schema-push` usou o `buildCommand` do ficheiro
  (`pnpm install --frozen-lockfile && pnpm run build`) e ignorou o que
  estava definido no serviço. Só o `preDeployCommand` é inerte — e foi por
  isso removido do ficheiro, para não dar a impressão falsa de que o schema
  se aplica sozinho no deploy.

- **O `BASE_PATH` é obrigatório em qualquer serviço que construa este repo**,
  mesmo um que nunca sirva frontend, porque o `buildCommand` do
  `railway.json` corre sempre o `pnpm run build` e o `vite.config.ts` do
  `mockup-sandbox` exige a variável. Foi assim que o primeiro deploy do
  `db-schema-push` falhou.

### Config as Code está deprecada

Ao tentar apontar um ficheiro de configuração alternativo, a API do Railway
responde:

> Config as Code (railway.json / railway.toml) is deprecated. Use
> Infrastructure as Code (.railway/railway.ts) instead.

O `railway.json` continua a ser aplicado hoje, mas está em fim de vida.
Migrar para `.railway/railway.ts` fica como trabalho futuro; não é urgente
enquanto a configuração do serviço for a fonte de verdade.

### Aviso sobre o `drizzle-kit push`

O `tablesFilter: ["*", "!user_sessions"]` da `drizzle.config.ts` não é
opcional. Sem ele, o push pergunta interativamente se a `runs` é um rename
da `user_sessions`, e num contentor não há ninguém para responder — fica
pendurado. Pior: responder "rename", ou passar `--force`, destrói a tabela
de sessões viva.

### Estado atual e limpeza pendente

O serviço da app mantém um `preDeployCommand` configurado, com timeout de
600s. É inofensivo — o push do Drizzle é idempotente, e hoje o passo nem
sequer corre. Se um dia o Railway passar a criá-lo, duplica o trabalho do
`db-schema-push` sem consequência.

**Por apagar à mão, no dashboard:** os serviços `db-migracao` e
`db-migration-oneshot`, mortos e sem referências. A remoção foi pedida por
API e ficou *staged*, mas o Railway exige verificação em dois passos para a
aplicar, o que não é possível por token de API/MCP. Ambos guardam o URL do
Neon em variáveis, o que é mais uma razão para desaparecerem.

### Nota operacional

O `db-schema-push` faz deploy a cada push para `main`. Como o push do
Drizzle é idempotente, isso é aceitável e faz dele o aplicador de schema do
projeto. Ficam também dois serviços mortos de trabalho abandonado —
`db-migracao` e `db-migration-oneshot` — que podem ser apagados.
