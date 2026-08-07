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
# NOTE DE REVISION : la premiere version de ce script tentait un
# REVOKE UPDATE, DELETE ON db_logs.scans FROM app_logs -- ce qui echoue en
# MySQL (ERROR 1147, "There is no such grant defined ... on table 'scans'").
# Raison : l'image officielle accorde a MYSQL_USER un privilege ALL PRIVILEGES
# au niveau BASE (db_logs.*) via MYSQL_USER/MYSQL_PASSWORD ; MySQL refuse de
# revoquer un privilege au niveau TABLE si ce privilege n'a jamais ete accorde
# a ce niveau precis -- la revocation doit matcher exactement le niveau de
# l'octroi. La strategie retenue ci-dessous inverse donc la logique : au lieu
# de "tout accorder puis revoquer etroit" (bloque par cette regle), on "reduit
# tout a zero puis accorde etroit" (GRANT n'a pas cette contrainte de niveau).
# Le resultat final est equivalent pour scans/corrections, et plus strict pour
# le reste (etudiants, uf, salles, inscriptions perdent UPDATE/DELETE aussi --
# aucune fonctionnalite du prototype n'en a besoin a ce jour ; a revoir si un
# futur RF exige de modifier ces tables depuis le pool applicatif).
#
# Deux garanties de securite mises en place ici :
#   1. Separation physique logs/attestations : un utilisateur DEDIE
#      (app_attestations) recoit SELECT+INSERT UNIQUEMENT sur db_attestations.
#      L'utilisateur applicatif standard (app_logs) ne recoit ICI AUCUN
#      privilege sur db_attestations : en MySQL, l'absence de GRANT vaut
#      refus total, il n'y a rien a revoquer explicitement pour le lui
#      interdire.
#   2. Ecriture minimale par defaut : app_logs part d'une base SELECT+INSERT
#      sur TOUTES les tables de db_logs (couvre scans et corrections, qui
#      doivent rester en ecriture seule -- RF-18/RNF-13), puis ne regagne
#      UPDATE/DELETE que sur les deux tables qui en ont reellement besoin
#      aujourd'hui : seances (cloture, RF-02) et appareils_enroles
#      (revocation de cle, RF-08).
# =============================================================================
set -euo pipefail

# -h "${MYSQL_HOST:-localhost}" : par defaut (localhost), ce script suppose
# qu'il s'execute A L'INTERIEUR du conteneur MySQL lui-meme (cas normal via
# docker-entrypoint-initdb.d, ou MYSQL_HOST n'est pas defini dans
# l'environnement du conteneur -- cf. docker-compose.yml). Si MYSQL_HOST est
# explicitement defini (cas de la CI GitLab, ou ce script est rejoue contre
# le service mysql par son nom reseau -- cf. .gitlab-ci.yml), la connexion
# cible ce host a la place. Reutilisation LITTERALE du meme script dans les
# deux contextes, sans divergence entre ce que la CI valide et ce qui tourne
# reellement en developpement/production.

mysql -h "${MYSQL_HOST:-localhost}" -uroot -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
  -- Utilisateur dedie, restreint a la seule base db_attestations.
  CREATE USER IF NOT EXISTS '${MYSQL_ATTESTATIONS_USER}'@'%' IDENTIFIED BY '${MYSQL_ATTESTATIONS_PASSWORD}';
  GRANT SELECT, INSERT ON db_attestations.* TO '${MYSQL_ATTESTATIONS_USER}'@'%';

  -- ---------------------------------------------------------------------
  -- Etape 9 : TROISIEME identite, dediee a la seule cloture RGPD.
  --
  -- Le probleme a resoudre : la minimisation exige de DETRUIRE des donnees
  -- dans db_logs.scans -- table sur laquelle l'utilisateur applicatif n'a
  -- volontairement ni UPDATE ni DELETE. C'est la garantie la plus forte de
  -- toute l'architecture : meme une injection SQL ou une dependance
  -- compromise ne peut pas reecrire l'historique des scans, parce que le
  -- refus vient du moteur et non du code.
  --
  -- Accorder UPDATE sur scans a '${MYSQL_USER}' ferait disparaitre cette
  -- garantie pour TOUTES les routes de l'application, au benefice d'une
  -- seule. Le prix serait sans commune mesure avec le gain.
  --
  -- D'ou une identite SEPAREE, utilisee par un pool distinct que seul le
  -- controleur de cloture peut emprunter (cf. backend/src/config/dbRgpd.js).
  -- La capacite d'effacement est ainsi elle-meme un privilege isole : c'est
  -- exactement ce que le RGPD attend d'une operation d'effacement, qui doit
  -- etre tracable et restreinte, jamais diffuse dans tout le code.
  --
  -- Ce compte n'a delibrement PAS de DELETE : la cloture ANONYMISE les
  -- lignes de scans (le jti est remplace), elle ne les supprime pas. Le
  -- NOMBRE de scans reste ainsi verifiable -- on peut toujours prouver
  -- qu'un etudiant a scanne deux fois -- alors que le lien avec le jeton
  -- reel, lui, a disparu. Detruire les lignes entieres detruirait aussi la
  -- preuve que la presence repose bien sur des scans.
  -- ---------------------------------------------------------------------
  CREATE USER IF NOT EXISTS '${MYSQL_RGPD_USER}'@'%' IDENTIFIED BY '${MYSQL_RGPD_PASSWORD}';
  REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${MYSQL_RGPD_USER}'@'%';
  GRANT SELECT ON db_logs.* TO '${MYSQL_RGPD_USER}'@'%';
  -- UPDATE sur la SEULE colonne jti : le compte de purge ne peut pas
  -- reattribuer un scan a un autre etudiant ni en changer l'horodatage.
  GRANT UPDATE (jti) ON db_logs.scans TO '${MYSQL_RGPD_USER}'@'%';
  GRANT UPDATE ON db_logs.presences TO '${MYSQL_RGPD_USER}'@'%';
  GRANT UPDATE ON db_logs.uf TO '${MYSQL_RGPD_USER}'@'%';
  -- La cloture doit etre consignee au journal d'audit, comme toute
  -- operation irreversible. INSERT seul : jamais UPDATE ni DELETE.
  GRANT SELECT, INSERT ON db_attestations.journal_modifications TO '${MYSQL_RGPD_USER}'@'%';

  -- 1. Remise a zero TOTALE : on retire absolument tous les privileges de l'utilisateur
  REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${MYSQL_USER}'@'%';

  -- 2. On donne le droit de lire et creer des lignes sur toutes les tables
  GRANT SELECT, INSERT ON db_logs.* TO '${MYSQL_USER}'@'%';

  -- 3. On redonne le droit de modification UNIQUEMENT aux tables qui en ont besoin
  GRANT UPDATE, DELETE ON db_logs.seances TO '${MYSQL_USER}'@'%';
  GRANT UPDATE, DELETE ON db_logs.appareils_enroles TO '${MYSQL_USER}'@'%';

  -- Etape 7a : DELETE sur sessions est indispensable pour que la
  -- deconnexion soit REELLE (suppression de la ligne) et pour purger les
  -- sessions expirees. C'est precisement l'interet d'une session cote
  -- serveur par rapport a un JWT : sans ce privilege, "se deconnecter" ne
  -- ferait qu'effacer le cookie cote navigateur tandis que la session
  -- resterait valide en base -- un jeton recupere avant la deconnexion
  -- continuerait de fonctionner.
  -- Aucun UPDATE accorde : une session ne se modifie jamais, elle est creee
  -- puis supprimee. Ne pas accorder un privilege dont on n'a pas l'usage.
  GRANT DELETE ON db_logs.sessions TO '${MYSQL_USER}'@'%';

  -- Suivi du temps : presences et demandes_rectification evoluent dans le
  -- temps (heure de depart renseignee a la cloture, statut d'une demande
  -- tranche par le formateur), d'ou UPDATE. Aucun DELETE : une presence ou
  -- une demande ne se supprime pas, elle se corrige -- et la correction
  -- laisse une trace dans le journal d'audit.
  -- Un defi doit pouvoir etre marque comme consomme (usage unique) : UPDATE
  -- est donc necessaire. Aucun DELETE : les defis expires restent en base et
  -- constituent une trace des tentatives d'enrolement, utile pour reperer une
  -- succession anormale sur un meme compte.
  GRANT UPDATE ON db_logs.defis_enrolement TO '${MYSQL_USER}'@'%';

  GRANT UPDATE ON db_logs.presences TO '${MYSQL_USER}'@'%';

  -- Etape 9 : la cloture RGPD ecrit uf.date_cloture_rgpd.
  GRANT UPDATE ON db_logs.uf TO '${MYSQL_USER}'@'%';
  GRANT UPDATE ON db_logs.demandes_rectification TO '${MYSQL_USER}'@'%';

  -- EXCEPTION DELIBEREE ET ETROITE a la separation des deux bases.
  -- L'utilisateur applicatif n'a, par principe, aucun acces a
  -- db_attestations (cf. plus haut). Le journal d'audit y reside pourtant,
  -- puisqu'il doit survivre a la purge de db_logs (RF-20) pour couvrir les
  -- cinq ans de conservation legale. L'application doit donc pouvoir l'ecrire.
  -- L'exception est reduite au strict minimum : INSERT et SELECT sur CETTE
  -- SEULE table, jamais sur attestations. Et surtout AUCUN UPDATE ni DELETE :
  -- c'est ce qui rend le journal reellement inalterable, garanti par le
  -- moteur et non par la discipline du code.
  GRANT SELECT, INSERT ON db_attestations.journal_modifications TO '${MYSQL_USER}'@'%';

  -- Aucun privilege d'ECRITURE sur utilisateurs : le pool applicatif lit les
  -- comptes pour authentifier (SELECT, deja couvert plus haut) mais ne doit
  -- jamais pouvoir en creer, en modifier ni en supprimer. La creation de
  -- comptes releve du provisionnement (02-seed.sql, execute en root), pas de
  -- l'application -- coherent avec le perimetre acte : l'administration des
  -- comptes reste hors du prototype (cf. 3.1.2), seule l'AUTHENTIFICATION
  -- est implementee.

  FLUSH PRIVILEGES;
EOSQL

echo "03-privileges.sh : privileges mis en place avec succes !"
