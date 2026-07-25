// src/services/tokenService.js
// Generation des jetons de seance signes RS256 (RF-04).
//
// Vocabulaire : le cahier des charges de cette etape parle de "nonce", mais
// le champ est implemente ici sous la revendication JWT standard "jti"
// (RFC 7519, JWT ID) via l'option native jwtid de jsonwebtoken -- c'est le
// nom deja utilise partout ailleurs dans ce projet (chapitre 2.4.1, RF-04,
// RF-14, colonne scans.jti du schema). "nonce" et "jti" designent ici
// exactement la meme valeur ; jti est retenu pour eviter une divergence de
// vocabulaire entre le jeton emis et la colonne qui le consommera a l'etape
// suivante (cascade de validation).

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// Rotation de l'affichage (RF-05) et duree de vie du jeton (RF-04) : deux
// constantes distinctes et volontairement DIFFERENTES. Voir ANALYSE_CODE.md,
// section Etape 2, pour la justification complete du recouvrement de 5s.
const ROTATION_INTERVAL_SECONDS = 20;
const TOKEN_TTL_SECONDS = 25;

// Chemin de la cle privee : JWT_PRIVATE_KEY_PATH (.env) en priorite --
// resolu relativement au repertoire de travail du process (WORKDIR /app en
// conteneur, cf. docker-compose.yml). A defaut (execution locale sans
// variable d'environnement), on retombe sur le chemin relatif au fichier lui
// meme : backend/src/services -> (3 niveaux) -> racine du depot -> keys/.
const PRIVATE_KEY_PATH = process.env.JWT_PRIVATE_KEY_PATH
  ? path.resolve(process.env.JWT_PRIVATE_KEY_PATH)
  : path.resolve(__dirname, '../../../keys/private.pem');

// Lecture au chargement du module, pas a chaque appel : la cle ne change pas
// en cours d'execution, et une lecture disque par jeton genere (potentiellement
// toutes les 20s x N seances en parallele) serait un cout inutile. Echec
// immediat et explicite si la cle est absente -- mieux vaut un crash net au
// demarrage qu'une erreur decouverte au premier scan d'un etudiant.
let privateKey;
try {
  privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
} catch (err) {
  throw new Error(
    `[tokenService] Impossible de lire la cle privee RS256 (${PRIVATE_KEY_PATH}) : ${err.message}. ` +
    `Executez ./generate_keys.sh a la racine du projet avant de demarrer le backend.`
  );
}

/**
 * Genere un jeton de seance signe RS256.
 *
 * Payload : session_id, salle_id (revendications privees), jti (RFC 7519,
 * identifiant unique -- ferme V4 en aval), iat et exp (ajoutes automatiquement
 * par jsonwebtoken a partir de l'option expiresIn).
 *
 * @param {string} sessionId - UUID de la seance (table seances.id)
 * @param {string} salleId   - UUID de la salle (table salles.id) -- DOIT etre
 *                              la valeur lue en base, jamais une valeur fournie
 *                              par un client (cf. qrBroadcaster.js).
 * @returns {string} JWT compact (header.payload.signature)
 */
function generateSessionToken(sessionId, salleId) {
  if (!sessionId || !salleId) {
    throw new Error('generateSessionToken requiert sessionId et salleId (recus : '
      + JSON.stringify({ sessionId, salleId }) + ').');
  }

  const payload = {
    session_id: sessionId,
    salle_id: salleId,
  };

  // algorithm: 'RS256' est EXPLICITE et non optionnel -- sans cette option,
  // jsonwebtoken utilise HS256 par defaut, ce qui reviendrait a signer avec
  // la cle privee RSA traitee comme un secret HMAC partage. C'est exactement
  // la classe de vulnerabilite "algorithm confusion" documentee sur les JWT :
  // un jeton HS256 peut ensuite etre forge par quiconque connait (ou devine)
  // la cle "secrete" -- ici la cle publique RSA, qui est par definition
  // publique. Preciser l'algorithme n'est donc pas une option de style, c'est
  // la condition pour que RS256 soit reellement utilise.
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: `${TOKEN_TTL_SECONDS}s`,
    jwtid: uuidv4(),
  });
}

module.exports = {
  generateSessionToken,
  ROTATION_INTERVAL_SECONDS,
  TOKEN_TTL_SECONDS,
};
