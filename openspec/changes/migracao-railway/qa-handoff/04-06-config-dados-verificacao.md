# QA HANDOFF — Secções 4, 5 e 6

Change: `openspec/changes/migracao-railway`
Skill: `.claude/skills/implementation-qa-handoff/SKILL.md`

## Summary

A aplicação está funcional no Railway com base de dados própria, schema aplicado
e autenticação a funcionar. **Sem dados migrados — por decisão do utilizador.**

## Estado por secção

**4 (configuração)** — completa. As oito credenciais externas estão postas e
verificadas. `OPENROUTER_MODEL` passou a explícito (`anthropic/claude-sonnet-5`),
registado como alteração de comportamento em `DECISOES-COMPORTAMENTO.md`.

**5 (dados)** — **não aplicável.** Decidido começar do zero. Só a 5.3 (aplicar o
schema) e a 5.5 (`user_sessions`) foram feitas.

**6 (verificação)** — parcial. O que depende de dados não é verificável.

## Requirement coverage

| Cenário da delta-spec | Estado |
|---|---|
| API and UI on one origin | **exercitado — passa** (login + `/api/auth/me` no domínio real, HTTPS, sem CORS) |
| Existing server-rendered routes are unaffected | **exercitado — passa** (`/leads` 200 com 38 663 bytes de dados reais do Zoho) |
| Health check | **exercitado — passa** |
| Cron trigger after cutover | **não exercitado** — ver "Não verificado" |
| Same day analysed on both platforms | **NÃO APLICÁVEL** — sem histórico para comparar, e o modelo mudou |

## Tests executed

Schema, contra o Railway:

```
[✓] Pulling schema from database...
[✓] Changes applied
```

Autenticação, no domínio real sobre HTTPS:

| Passo | Resultado |
|---|---|
| `POST /api/auth/login` (`admin`) | 200 `{"id":1,"username":"admin","role":"admin"}` |
| `GET /api/auth/me` com o cookie | 200, mesma identidade |
| Repetido | 200 — a sessão sobrevive |

Rotas autenticadas, com a base de dados vazia (data de teste: 2026-08-28):

| Rota | Resultado | Correto? |
|---|---|---|
| `GET /api/run/:date` | 404 `{"error":"No run found for this date"}` | sim — não há run |
| `GET /api/operators/:date` | 200 `[]` | sim — vazio, não erro |
| `GET /api/conversations/:date` | 200 `[]` | sim |
| `GET /api/cases/:date` | 200 `[]` | sim |
| `GET /api/actions/:date` | 200 `[]` | sim |
| `GET /api/summary/:date` | 404 `{"error":"No summary found for this date"}` | sim |
| `GET /api/admin/users` | 200, devolve o admin | **sim — prova que o schema e as queries funcionam** |
| `GET /api/stats/equipa` | 400 `{"error":"Parâmetros 'de' e 'ate' ... são obrigatórios"}` | sim — validação a funcionar |

`GET /leads` 200, 38 663 bytes. `GET /` 200.

**Nota metodológica:** as primeiras tentativas usaram `/api/runs` e
`/api/operators` e deram 404. Não era a app — eram nomes de rota que eu inventei.
As reais levam `:date`. Verificado contra `artifacts/api-server/src/routes/`.

## ⚠️ Risco a tratar antes de qualquer outra coisa

**Existe um utilizador `admin` com a password `admin123` num domínio público.**

O `seedAdminUser()` cria-o sempre que a tabela `users` está vazia. Com a base de
dados nova, correu. Confirmei a existência entrando com essas credenciais.

Isto já tinha sido sinalizado na secção 3 como risco teórico. **Deixou de ser
teórico.** A password tem de ser mudada antes de o serviço ser divulgado.

## Segundo risco, por decidir

`POST /api/run` **não exige autenticação** a menos que o corpo traga
`source: "cron"` — a verificação do `X-Cron-Secret` está dentro de `if (isCron)`
em `routes/runs.ts`.

Antes era inofensivo porque a base de dados não tinha schema e o pedido morria
antes de chegar ao `analyzeDay`. **Agora o schema existe.** Qualquer pessoa que
saiba o URL pode disparar uma análise completa, que chama o Ringover e o
OpenRouter e custa dinheiro.

Não corrigido: exigir o segredo em todos os caminhos é alteração de
comportamento. **Precisa de decisão.**

## Não verificado

- **Uma análise real.** Nunca correu. Portanto `RINGOVER_API_KEY`,
  `OPENROUTER_API_KEY` e o identificador `anthropic/claude-sonnet-5` continuam
  por provar. Se o nome do modelo estiver errado no OpenRouter, falha aí.
- **`POST /api/run` com o segredo correto.** Não tenho o valor, e dispararia uma
  análise real com custo.
- **`/api/followups/pending` e `/api/alertas-dia` com o Bearer token.** Não tenho
  o valor do `FOLLOWUP_API_TOKEN`. Só confirmei que devolvem 401 sem ele.
- **O SPA num browser.** Tudo foi `curl`, sem executar JavaScript.
- **2FA.**
- **A comparação com o Replit.** Não aplicável.

## Suggested evidence for QA

- Sessão de browser no domínio real, com devtools: dashboard a carregar, sem
  erros de consola, assets todos 200.
- `psql` no Railway a confirmar as 20 tabelas e que `user_sessions` sobreviveu.
- Depois da primeira análise: o custo por conversa registado, para comparar com o
  Sonnet 4.6.

## Final status

**READY FOR INDEPENDENT QA**
