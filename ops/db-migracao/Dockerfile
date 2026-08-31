# Ferramenta de uso único para a migração Replit(Neon) → Railway.
#
# Existe porque o `startCommand` do Railway não é interpretado por uma shell:
# é partido em palavras, e qualquer `;`, `|`, `&&` ou aspas é passado
# literalmente ao executável. Um Dockerfile devolve o controlo do arranque,
# e o comando passa a ser um único invocação sem metacaracteres.
FROM alpine:3.21

# postgresql17-client traz psql, pg_dump e pg_restore. A versão 17 lê servidores
# 16 e 17, o que cobre tanto o Neon como o Postgres do Railway.
RUN apk add --no-cache postgresql17-client

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/bin/sh", "/run.sh"]
