#!/usr/bin/env bash
# ==============================================================
# generate_keys.sh
# Génère la paire de clés RS256 (RSA 2048 bits) utilisée pour signer :
#   - les JWT de séance (RF-04, TTL 25s / rotation 20s)
#   - les attestations de présence (RF-19, vérifiables par un tiers)
#
# La clé privée ne quitte jamais le dossier keys/ (gitignoré) et n'est
# jamais transmise au client. Seule la clé publique est diffusable.
# ==============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS_DIR="$SCRIPT_DIR/keys"
PRIVATE_KEY="$KEYS_DIR/private.pem"
PUBLIC_KEY="$KEYS_DIR/public.pem"

mkdir -p "$KEYS_DIR"

if [[ -f "$PRIVATE_KEY" ]]; then
  echo "ERREUR : une clé privée existe déjà dans $PRIVATE_KEY."
  echo "Suppression manuelle requise avant régénération (évite l'écrasement"
  echo "accidentel d'une clé déjà utilisée pour signer des jetons/attestations)."
  exit 1
fi

echo "Génération de la clé privée RSA 2048 bits (RS256)..."
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$PRIVATE_KEY"

echo "Extraction de la clé publique correspondante..."
openssl rsa -pubout -in "$PRIVATE_KEY" -out "$PUBLIC_KEY"

chmod 600 "$PRIVATE_KEY"
chmod 644 "$PUBLIC_KEY"

echo ""
echo "Clés générées avec succès :"
echo "  Privée  : $PRIVATE_KEY (permissions 600, exclue de Git par .gitignore)"
echo "  Publique : $PUBLIC_KEY (permissions 644, diffusable aux vérificateurs tiers)"
