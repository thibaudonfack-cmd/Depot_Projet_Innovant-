// src/services/verificationService.js
// Verification des jetons de seance scannes par un etudiant (RF-12, Etape 3).
//
// Ce service ferme, a lui seul, UNE moitie de la cascade de validation :
//   a) Signature RS256 (cle PUBLIQUE -- jamais la cle privee, qui ne quitte
//      jamais tokenService.js).
//   b) Expiration (exp, TTL 25s) -- ferme le vecteur V1 (partage differe
//      d'une capture d'ecran/photo du QR code par SMS ou messagerie : le
//      temps de transmission et d'ouverture depasse presque toujours la
//      fenetre de validite de 25s).
//
// La fermeture du vecteur V4 (rejeu du meme jeton) N'EST PAS traitee ici :
// elle exige une ecriture en base (consommation du jti dans la table scans),
// qui reste la responsabilite exclusive de scanController.js -- seul capable
// d'inserer ET d'intercepter le rejet de la contrainte UNIQUE de maniere
// atomique. Melanger les deux responsabilites dans un seul module rendrait
// ce service dependant de la base de donnees pour une simple verification
// cryptographique, et rendrait impossible de le tester unitairement sans
// MySQL (cf. ANALYSE_CODE.md, section Etape 3, pour la justification complete
// de cette separation).

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Meme logique de resolution que tokenService.js (JWT_PUBLIC_KEY_PATH en
// priorite, repli sur le chemin relatif au fichier depuis backend/src/services/
// vers <racine du depot>/keys/) -- volontairement dupliquee plutot que
// factorisee : la cle privee et la cle publique n'ont pas le meme cycle de
// vie ni les memes garanties (la privee ne doit jamais etre lisible par un
// code qui n'a besoin que de verifier), les garder dans deux modules
// distincts et symetriques rend cette frontiere de securite visible dans la
// structure du code, pas seulement dans un commentaire.
const PUBLIC_KEY_PATH = process.env.JWT_PUBLIC_KEY_PATH
  ? path.resolve(process.env.JWT_PUBLIC_KEY_PATH)
  : path.resolve(__dirname, '../../../keys/public.pem');

let publicKey;
try {
  publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
} catch (err) {
  throw new Error(
    `[verificationService] Impossible de lire la cle publique RS256 (${PUBLIC_KEY_PATH}) : ${err.message}. ` +
    `Executez ./generate_keys.sh a la racine du projet avant de demarrer le backend.`
  );
}

/**
 * Erreur typee, distinguant les trois causes de rejet d'un jeton -- le
 * controller appelant a besoin de ce code pour choisir le bon statut HTTP et
 * le bon message (cf. scanController.js), sans avoir a re-parser un message
 * d'erreur en texte libre.
 */
class TokenInvalideError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TokenInvalideError';
    this.code = code; // 'EXPIRE' | 'SIGNATURE_INVALIDE' | 'MALFORME'
  }
}

/**
 * Verifie un jeton de seance scanne par un etudiant.
 *
 * Cascade STRICTE, dans l'ordre impose par la mission (Etape 3) :
 *   a) puis b) ci-dessus. Ordre garanti nativement par jsonwebtoken :
 *      jwt.verify() verifie d'abord la signature cryptographique (jws.verify),
 *      et ne decode/controle les revendications temporelles (exp, nbf) que
 *      SI la signature est valide -- un jeton a la signature invalide echoue
 *      donc toujours avec JsonWebTokenError, jamais avec TokenExpiredError,
 *      meme si son exp est egalement depasse. C'est exactement l'ordre a),
 *      b) demande, obtenu sans code supplementaire.
 *
 * algorithms: ['RS256'] est EXPLICITE (jamais omis) -- meme raison
 * anti "algorithm confusion" que documentee dans tokenService.js : sans
 * cette restriction explicite, jsonwebtoken accepterait un jeton signe avec
 * n'importe quel algorithme present dans son header, y compris HS256 avec la
 * cle publique (donnee publique par construction) utilisee comme secret
 * HMAC -- ce qui permettrait a quiconque de forger un jeton valide.
 *
 * @param {string} jeton - JWT compact recu du client (contenu du QR code).
 * @returns {{ sessionId: string, salleId: string, jti: string, iat: number, exp: number }}
 * @throws {TokenInvalideError} code EXPIRE | SIGNATURE_INVALIDE | MALFORME
 */
function verifierJetonScan(jeton) {
  if (!jeton || typeof jeton !== 'string') {
    throw new TokenInvalideError('MALFORME', 'Jeton absent ou de type invalide.');
  }

  let decoded;
  try {
    decoded = jwt.verify(jeton, publicKey, { algorithms: ['RS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new TokenInvalideError('EXPIRE', `Jeton expire (V1) : ${err.message}`);
    }
    // JsonWebTokenError couvre entre autres : signature invalide, algorithme
    // absent de la liste autorisee, JSON malforme -- tout jeton qui n'a pas
    // ete emis tel quel par ce serveur avec sa cle privee RS256 actuelle.
    throw new TokenInvalideError('SIGNATURE_INVALIDE', `Signature RS256 invalide : ${err.message}`);
  }

  if (!decoded.session_id || !decoded.salle_id || !decoded.jti) {
    // Defense en profondeur : ne devrait jamais se produire pour un jeton
    // reellement genere par tokenService.js (qui remplit systematiquement
    // ces trois champs), mais un payload incomplet ne doit jamais atteindre
    // le controller sous une forme silencieusement partielle.
    throw new TokenInvalideError(
      'MALFORME',
      'Jeton valide mais payload incomplet (session_id, salle_id ou jti manquant).'
    );
  }

  return {
    sessionId: decoded.session_id,
    salleId: decoded.salle_id,
    jti: decoded.jti,
    iat: decoded.iat,
    exp: decoded.exp,
  };
}

module.exports = { verifierJetonScan, TokenInvalideError };
