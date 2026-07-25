#!/usr/bin/env bash
# =============================================================================
# 03-privileges.sh
# Provisionnement des privileges separes -- s'execute APRES 01-schema.sql et
# 02-seed.sql (ordre alphabetique impose par l'entrypoint MySQL officiel).
#
# Pourquoi un .sh et pas un .sql pur : ce script a besoin d'interpoler des
# variables d'environnement (mot de passe du nouvel utilisateur attestations),
# ce que les fichiers .sql executes par l'entrypoint ne font PAS nativement
# (ils sont passes tels quels au client mysql, sans substitution de shell).
# Les fichiers .sh, eux, sont executes par bash et heritent de l'environnement
# du conteneur -- c'est le mecanisme documente de l'image officielle pour tout
# provisioning necessitant un secret.
#
# Deux garanties de securite mises en place ici :
#   1. Separation physique logs/attestations : un utilisateur DEDIE
#      (app_attestations) recoit SELECT+INSERT UNIQUEMENT sur db_attestations.
#      L'utilisateur applicatif standard (app_logs, deja cree par l'image
#      officielle via MYSQL_USER) ne recoit ICI AUCUN privilege sur
#      db_attestations : en MySQL, l'absence de GRANT vaut refus total, il n'y
#      a rien a revoquer explicitement pour le lui interdire.
#   2. Journal en ecriture seule (RF-18, RNF-13) : app_logs perd les droits
#      UPDATE et DELETE sur les tables scans et corrections. Meme un bug
#      applicatif ne peut donc pas modifier ou supprimer une ligne de ces deux
#      tables -- seul INSERT (et SELECT) restent possibles.
# =============================================================================
set -euo pipefail

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
  -- Utilisateur dedie, restreint a la seule base db_attestations.
  CREATE USER IF NOT EXISTS '${MYSQL_ATTESTATIONS_USER}'@'%' IDENTIFIED BY '${MYSQL_ATTESTATIONS_PASSWORD}';
  GRANT SELECT, INSERT ON db_attestations.* TO '${MYSQL_ATTESTATIONS_USER}'@'%';

  -- Journal en ecriture seule : retrait explicite d'UPDATE/DELETE pour
  -- l'utilisateur applicatif standard, uniquement sur les deux tables
  -- journal (scans, corrections). Les autres tables (seances,
  -- appareils_enroles...) conservent leurs droits complets : elles ont
  -- legitimement besoin d'UPDATE (cloture de seance, revocation de cle).
  REVOKE UPDATE, DELETE ON db_logs.scans FROM '${MYSQL_USER}'@'%';
  REVOKE UPDATE, DELETE ON db_logs.corrections FROM '${MYSQL_USER}'@'%';

  FLUSH PRIVILEGES;
EOSQL

echo "03-privileges.sh : utilisateur ${MYSQL_ATTESTATIONS_USER} cree (db_attestations uniquement) ; scans/corrections passees en ecriture seule pour ${MYSQL_USER}."
