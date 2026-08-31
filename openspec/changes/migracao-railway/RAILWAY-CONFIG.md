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
