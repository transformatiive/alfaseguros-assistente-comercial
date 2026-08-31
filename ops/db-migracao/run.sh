#!/bin/sh
# Migração Replit(Neon) → Railway.
#
# MODE=inspect  (default) — só leitura. Não escreve nada em lado nenhum.
# MODE=migrate            — copia a origem para o destino. Destrutivo NO DESTINO.
#
# Espera SOURCE_DATABASE_URL e TARGET_DATABASE_URL no ambiente.

set -u

MODE="${MODE:-inspect}"

hr() { echo "=================================================="; }

inspect_side() {
  label="$1"
  url="$2"
  hr
  echo "[$label] versão do servidor"
  psql "$url" -tAc 'select version()' || { echo "[$label] FALHOU A LIGAÇÃO"; return 1; }
  echo
  echo "[$label] tamanho da base de dados"
  psql "$url" -tAc 'select pg_size_pretty(pg_database_size(current_database()))'
  echo
  echo "[$label] tabelas e linhas (estimativa do planeador)"
  psql "$url" -tAc 'select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc'
  echo
  echo "[$label] contagem exata das tabelas que interessam"
  for t in runs conversations calls tickets ticket_comments cases case_calls case_tickets daily_summaries colaboradores users user_sessions; do
    n=$(psql "$url" -tAc "select count(*) from \"$t\"" 2>/dev/null) && echo "  $t = $n" || echo "  $t = (não existe)"
  done
}

echo "MODO: $MODE"

inspect_side ORIGEM "$SOURCE_DATABASE_URL" || exit 1
inspect_side DESTINO "$TARGET_DATABASE_URL" || exit 1

if [ "$MODE" != "migrate" ]; then
  hr
  echo "INSPEÇÃO CONCLUÍDA — nada foi escrito."
  hr
  exit 0
fi

hr
echo "A COPIAR ORIGEM → DESTINO"
echo "  --clean --if-exists  : apaga os objetos do destino antes de recriar"
echo "  --no-owner           : o dono no Neon (neonedb_owner) não existe no Railway"
echo "  --no-privileges      : idem para os GRANTs"
hr

pg_dump --clean --if-exists --no-owner --no-privileges --format=plain "$SOURCE_DATABASE_URL" \
  | psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction

echo
hr
echo "CÓPIA TERMINADA — estado do destino depois da restauração"
inspect_side "DESTINO-FINAL" "$TARGET_DATABASE_URL"
hr
