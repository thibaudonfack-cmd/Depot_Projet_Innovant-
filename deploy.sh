#!/usr/bin/env bash
#
# deploy.sh - Deploiement sur le VPS de production.
#
# Usage, depuis le repertoire du projet sur le serveur :
#     ./deploy.sh
#
# CE QUE CE SCRIPT NE FAIT JAMAIS
#
#   - Il n'execute JAMAIS `docker compose down -v`. Cette commande, repetee
#     partout dans TESTING.md pour le developpement, detruirait ici la base de
#     donnees ET les certificats Let's Encrypt. Elle n'a pas sa place dans un
#     script de deploiement.
#   - Il ne monte pas 02-seed.sql : les comptes de demonstration ont des mots
#     de passe documentes en clair dans le depot (cf. docker-compose.prod.yml).
#   - Il ne touche pas a keys/ ni a .env : ces fichiers vivent sur le serveur,
#     hors de Git, et un deploiement ne doit pas pouvoir les ecraser.

set -euo pipefail

# set -e seul ne suffit pas : sans -o pipefail, `cmd_qui_echoue | tee` renvoie
# le code de tee (0) et le script continuerait sur une erreur. -u attrape les
# variables non definies, cause classique d'un `rm -rf "$CHEMIN"/` devastateur.

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
BRANCHE="${BRANCHE:-main}"

bleu()  { printf '\033[1;34m==> %s\033[0m\n' "$1"; }
vert()  { printf '\033[1;32m    %s\033[0m\n' "$1"; }
rouge() { printf '\033[1;31m!!! %s\033[0m\n' "$1" >&2; }

# ---------------------------------------------------------------------------
# 0. Verifications prealables
#
# Echouer AVANT de toucher a quoi que ce soit. Un deploiement interrompu au
# milieu laisse un systeme dans un etat intermediaire bien plus penible a
# diagnostiquer qu'un refus net au demarrage.
# ---------------------------------------------------------------------------
bleu "Verifications prealables"

[[ -f docker-compose.yml ]] || { rouge "A lancer depuis la racine du projet."; exit 1; }
[[ -f .env ]]               || { rouge ".env absent. Copier .env.example et le renseigner."; exit 1; }
[[ -f keys/private.pem ]]   || { rouge "keys/private.pem absent. Lancer : bash ./generate_keys.sh"; exit 1; }
[[ -f Caddyfile.prod ]]     || { rouge "Caddyfile.prod absent."; exit 1; }

# Le Caddyfile de production est livre avec un domaine d'exemple. Le deployer
# tel quel produirait un echec ACME silencieux, et le site resterait
# inaccessible en HTTPS sans message evident.
if grep -q 'presence\.example\.org' Caddyfile.prod; then
  rouge "Caddyfile.prod contient encore le domaine d'exemple 'presence.example.org'."
  rouge "Remplacez-le par votre domaine reel avant de deployer."
  exit 1
fi

# Les mots de passe d'exemple ne doivent jamais atteindre la production.
if grep -qE '^MYSQL_(ROOT_)?PASSWORD=changeme' .env 2>/dev/null; then
  rouge ".env contient encore un mot de passe 'changeme'. Corrigez-le."
  exit 1
fi
vert "Configuration coherente."

# ---------------------------------------------------------------------------
# 1. Recuperation du code
# ---------------------------------------------------------------------------
bleu "Recuperation de la branche ${BRANCHE}"

# Refus de deployer par-dessus des modifications locales : elles seraient
# perdues, ou pire, deployees sans avoir ete relues.
if ! git diff --quiet || ! git diff --cached --quiet; then
  rouge "Modifications locales non commitees. Deploiement interrompu."
  git status --short
  exit 1
fi

git fetch --prune origin
git checkout "${BRANCHE}"
AVANT="$(git rev-parse --short HEAD)"
git pull --ff-only origin "${BRANCHE}"
APRES="$(git rev-parse --short HEAD)"
vert "${AVANT} -> ${APRES}"

# --ff-only : refuse de creer un commit de fusion sur le serveur. Un historique
# divergent en production signale un probleme a regler ailleurs, pas a
# resoudre a la volee sur la machine de prod.

# ---------------------------------------------------------------------------
# 2. Sauvegarde de la base AVANT toute migration
#
# Le point le plus important du script. Un schema modifie ne se defait pas, et
# la seule question qui compte a 3 h du matin est : "de quand date la
# derniere sauvegarde ?".
# ---------------------------------------------------------------------------
bleu "Sauvegarde de la base"

mkdir -p sauvegardes
HORODATAGE="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="sauvegardes/db-${HORODATAGE}.sql.gz"

if $COMPOSE ps --status running --quiet mysql | grep -q .; then
  # --single-transaction : sauvegarde coherente sans verrouiller les tables,
  # donc sans interrompre le service pendant l'operation (InnoDB).
  # shellcheck disable=SC2016
  $COMPOSE exec -T mysql sh -c \
    'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction \
       --routines --databases db_logs db_attestations' \
    | gzip > "${ARCHIVE}"
  vert "Sauvegarde : ${ARCHIVE} ($(du -h "${ARCHIVE}" | cut -f1))"

  # Rotation : les 14 dernieres. Une sauvegarde qui remplit le disque finit
  # par arreter le service qu'elle etait censee proteger.
  ls -1t sauvegardes/db-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
else
  vert "MySQL n'est pas demarre (premier deploiement) : rien a sauvegarder."
fi

# ---------------------------------------------------------------------------
# 3. Construction et redemarrage
# ---------------------------------------------------------------------------
bleu "Construction des images"
$COMPOSE build --pull

bleu "Redemarrage des services"
# --remove-orphans : supprime les conteneurs d'un service retire du fichier
# compose, qui continueraient sinon a tourner indefiniment.
$COMPOSE up -d --remove-orphans

# Le service frontend construit puis s'arrete : c'est le comportement voulu.
$COMPOSE up frontend
vert "Frontend publie."

# ---------------------------------------------------------------------------
# 4. Verification de sante
#
# Un deploiement qui se termine sans erreur n'est pas un deploiement reussi.
# ---------------------------------------------------------------------------
bleu "Verification de sante"

for tentative in $(seq 1 20); do
  if $COMPOSE exec -T backend node -e \
      "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      2>/dev/null; then
    vert "Backend operationnel (tentative ${tentative})."
    break
  fi
  [[ ${tentative} -eq 20 ]] && { rouge "Backend injoignable apres 20 tentatives."; $COMPOSE logs --tail=50 backend; exit 1; }
  sleep 3
done

# ---------------------------------------------------------------------------
# 5. Nettoyage
# ---------------------------------------------------------------------------
bleu "Nettoyage des images orphelines"

# image prune -f SANS --all : ne supprime que les images sans tag, laissees
# par les reconstructions successives. Avec --all, la commande supprimerait
# aussi les images taguees non utilisees a cet instant -- y compris celles de
# la version precedente, qui sont precisement ce dont on a besoin pour revenir
# en arriere rapidement.
docker image prune -f
docker builder prune -f --filter 'until=168h'
vert "Termine."

echo
bleu "Deploiement termine : ${AVANT} -> ${APRES}"
echo "    Journaux    : ${COMPOSE} logs -f"
echo "    Etat        : ${COMPOSE} ps"
echo "    Retour arriere : git checkout ${AVANT} && ./deploy.sh"
