#!/bin/sh
# Tägliche Sicherung von stneuro: ein Datenbank-Dump.
#
# Die Zugangsdaten kommen aus /etc/stneuro.env — hier steht kein Passwort.
# Die Datei wird bewusst NICHT als Ganzes ge-sourcet: Werte mit Leerzeichen
# würde die Shell als Befehl deuten. Stattdessen wird jeder Schlüssel einzeln
# herausgelesen (CRLF-fest).
#
# Aufbewahrung: TAGE Tage, danach räumt der Lauf alte Stände selbst weg.
# Die Sicherungen enthalten Passwort-Hashes und Sitzungskennungen — das
# Zielverzeichnis gehört root und ist für niemanden sonst lesbar (umask).
set -eu

ENV_DATEI=/etc/stneuro.env
ZIEL=/var/backups/stneuro
TAGE=14

wert() {
  sed -n "s/^$1=//p" "$ENV_DATEI" | tail -n 1 | tr -d '\r'
}

DB_HOST=$(wert DB_HOST)
DB_PORT=$(wert DB_PORT)
DB_NAME=$(wert DB_NAME)
DB_USER=$(wert DB_USER)
DB_PASSWORD=$(wert DB_PASSWORD)

umask 077
mkdir -p "$ZIEL"

STEMPEL=$(date +%F)

mariadb-dump --single-transaction \
  -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" \
  -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
  | gzip > "$ZIEL/db-$STEMPEL.sql.gz"

find "$ZIEL" -name 'db-*.sql.gz' -mtime +"$TAGE" -delete
