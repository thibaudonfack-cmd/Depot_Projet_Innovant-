#!/usr/bin/env bash
# =============================================================================
# verifier-avant-push.sh
#
# Rejoue EN LOCAL les etapes de la pipeline GitLab qui echouent le plus
# souvent, dans la MEME image Docker que la CI (node:20). Objectif : ne plus
# jamais decouvrir une erreur d'installation apres un aller-retour de
# pipeline, alors qu'une commande de 20 secondes l'aurait revelee avant.
#
# A lancer depuis la racine du projet, dans Git Bash (Windows), un terminal
# Linux ou macOS :
#     ./verifier-avant-push.sh
#
# Prerequis : Docker Desktop demarre. Aucune installation Node sur l'hote
# n'est necessaire -- c'est meme tout l'interet : la verification se fait
# dans Linux, comme la CI, et jamais dans l'environnement Windows local.
#
# Ce script ne modifie RIEN : il ne touche ni package-lock.json, ni
# node_modules, ni l'etat Git. Il se contente de constater et de repondre
# par un code de sortie (0 = tout va bien, 1 = ne pas pousser en l'etat).
# =============================================================================
set -uo pipefail

IMAGE_CI="node:20"   # doit rester identique a l'image du job .gitlab-ci.yml
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ECHECS=0

vert()  { printf '\033[0;32m%s\033[0m\n' "$1"; }
rouge() { printf '\033[0;31m%s\033[0m\n' "$1"; }
jaune() { printf '\033[0;33m%s\033[0m\n' "$1"; }
titre() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# -----------------------------------------------------------------------------
# 0. Docker est-il disponible ?
# -----------------------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  rouge "Docker n'est pas accessible. Demarre Docker Desktop puis relance ce script."
  exit 1
fi

# -----------------------------------------------------------------------------
# 1. npm ci -- LA verification critique
#
# Reproduit exactement ce que fait la CI. Methode : monter le dossier en
# LECTURE SEULE, copier uniquement package.json + package-lock.json dans un
# repertoire vierge du conteneur, et y lancer npm ci. Consequences voulues :
#   - le node_modules de l'hote (potentiellement Windows, ou absent) ne peut
#     pas fausser le resultat : il n'est jamais copie ;
#   - rien n'est ecrit sur l'hote (montage :ro), donc aucun risque de
#     "polluer" le lockfile pendant une simple verification ;
#   - l'arbre de dependances est reconstruit a partir de zero, comme sur un
#     runner CI qui repart toujours d'une machine vierge.
# -----------------------------------------------------------------------------
verifier_npm_ci() {
  local dossier="$1"
  titre "npm ci -- $dossier/ (image $IMAGE_CI, comme la CI)"

  if [ ! -f "$RACINE/$dossier/package-lock.json" ]; then
    jaune "Pas de package-lock.json dans $dossier/ -- ignore."
    return 0
  fi

  local sortie
  sortie=$(docker run --rm \
    -v "$RACINE/$dossier:/src:ro" \
    "$IMAGE_CI" \
    sh -c 'mkdir -p /verif && cp /src/package.json /src/package-lock.json /verif/ && cd /verif && npm ci --no-audit --no-fund' 2>&1)
  local code=$?

  if [ $code -eq 0 ]; then
    vert "OK -- npm ci reussit ($(echo "$sortie" | grep -oE '[0-9]+ packages' | head -1))"
  else
    rouge "ECHEC -- npm ci echouerait EXACTEMENT de la meme facon en CI :"
    echo "$sortie" | grep -E 'npm error' | head -12 | sed 's/^/    /'
    echo ""
    jaune "  Correction (regenere le lockfile DANS Linux, pas sur Windows) :"
    echo "      docker run --rm -v \"\$(pwd)/$dossier:/app\" -w /app $IMAGE_CI npm install"
    echo "      git add $dossier/package-lock.json && git commit -m 'chore: resync lockfile'"
    ECHECS=$((ECHECS + 1))
  fi
}

verifier_npm_ci "backend"
verifier_npm_ci "frontend"

# -----------------------------------------------------------------------------
# 2. Etat Git : la branche locale est-elle poussee sur TOUS les remotes ?
#
# Raison d'etre : ce projet a plusieurs depots distants (GitHub personnel +
# GitLab de l'ecole). Un correctif pousse sur un seul des deux laisse l'autre
# -- et donc, potentiellement, la pipeline qui compte -- sur une version
# ancienne. Symptome vecu : une erreur "qui persiste" alors qu'elle est
# corrigee depuis longtemps, mais ailleurs.
# -----------------------------------------------------------------------------
titre "Synchronisation des depots distants"

BRANCHE=$(git -C "$RACINE" rev-parse --abbrev-ref HEAD 2>/dev/null)
LOCAL=$(git -C "$RACINE" rev-parse HEAD 2>/dev/null)
echo "Branche courante : $BRANCHE  (HEAD ${LOCAL:0:8})"

if ! git -C "$RACINE" diff-index --quiet HEAD -- 2>/dev/null; then
  jaune "Des modifications ne sont pas encore commitees -- elles ne partiront pas au push."
fi

REMOTES=$(git -C "$RACINE" remote)
if [ -z "$REMOTES" ]; then
  jaune "Aucun depot distant configure."
else
  for remote in $REMOTES; do
    git -C "$RACINE" fetch "$remote" "$BRANCHE" --quiet 2>/dev/null
    DISTANT=$(git -C "$RACINE" rev-parse "$remote/$BRANCHE" 2>/dev/null)
    if [ -z "$DISTANT" ]; then
      jaune "  $remote : branche '$BRANCHE' absente (jamais poussee ?)"
      ECHECS=$((ECHECS + 1))
    elif [ "$DISTANT" = "$LOCAL" ]; then
      vert  "  $remote : a jour (${DISTANT:0:8})"
    else
      RETARD=$(git -C "$RACINE" rev-list --count "$remote/$BRANCHE".."$BRANCHE" 2>/dev/null || echo '?')
      rouge "  $remote : EN RETARD de $RETARD commit(s) (${DISTANT:0:8})"
      echo  "      -> git push $remote $BRANCHE"
      ECHECS=$((ECHECS + 1))
    fi
  done
fi

# -----------------------------------------------------------------------------
# 3. Verdict
# -----------------------------------------------------------------------------
titre "Verdict"
if [ $ECHECS -eq 0 ]; then
  vert "Tout est bon. La pipeline devrait passer au vert."
  exit 0
fi
rouge "$ECHECS probleme(s) a regler AVANT de pousser (voir ci-dessus)."
exit 1
