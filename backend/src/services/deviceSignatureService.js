// src/services/deviceSignatureService.js
// Verification de la signature produite par l'appareil enrole de l'etudiant
// (RF-07 complet, Etape 5).
//
// Complement indispensable de verificationService.js (Etape 3), qui verifie
// une chose differente :
//   - verificationService.js   : "ce JETON a-t-il ete emis par NOTRE serveur,
//                                 et est-il encore frais ?" (RS256, cle
//                                 publique du serveur)
//   - deviceSignatureService.js : "ce jeton est-il presente par L'APPAREIL
//                                 ENROLE de cet etudiant ?" (ECDSA P-256,
//                                 cle publique de l'appareil, lue en base)
// Deux questions orthogonales, deux paires de cles distinctes, deux
// frontieres de confiance differentes -- cf. ANALYSE_CODE.md, Etape 5.

const crypto = require('crypto');

/**
 * Erreur typee, distinguant les causes de rejet -- meme approche que
 * TokenInvalideError (verificationService.js) : le controller a besoin de ce
 * code pour choisir le bon statut HTTP, sans re-parser un message texte.
 */
class SignatureAppareilInvalideError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SignatureAppareilInvalideError';
    this.code = code; // 'AUCUN_APPAREIL' | 'SIGNATURE_INVALIDE' | 'CLE_ILLISIBLE'
  }
}

/**
 * Verifie qu'une signature ECDSA correspond bien aux donnees signees et a la
 * cle publique fournie.
 *
 * POINT D'INTEROPERABILITE CRITIQUE -- verifie empiriquement, pas suppose :
 * `dsaEncoding: 'ieee-p1363'` n'est PAS optionnel ici.
 *
 * WebCrypto (crypto.subtle.sign, cote navigateur) produit pour ECDSA une
 * signature au format BRUT r||s -- exactement 64 octets pour P-256, dit
 * "IEEE P1363". Node.js, lui, attend par DEFAUT le format DER/ASN.1
 * (~70-72 octets, longueur variable). Sans cette option, crypto.createVerify
 * ne leve AUCUNE exception : il retourne simplement `false`. Consequence
 * concrete si on l'omet : *toutes* les signatures legitimes produites par le
 * frontend sont rejetees en 401, et le symptome ("la signature est toujours
 * invalide") ne pointe vers aucune cause evidente -- le code a l'air correct,
 * les cles sont les bonnes, et pourtant rien ne passe jamais.
 *
 * Mesure en conditions reelles (Node + WebCrypto, avant ecriture de ce
 * fichier) : signature WebCrypto = 64 octets, signature Node par defaut =
 * 71 octets ; verification de la premiere SANS l'option = rejetee, AVEC
 * l'option = acceptee.
 *
 * @param {string} donneesSignees - la chaine exacte qui a ete signee (le JWT)
 * @param {string} signatureBase64 - la signature, encodee en Base64 par le client
 * @param {string} clePubliquePem - la cle publique de l'appareil (PEM SPKI, lue en base)
 * @throws {SignatureAppareilInvalideError}
 */
function verifierSignatureAppareil(donneesSignees, signatureBase64, clePubliquePem) {
  let clePublique;
  try {
    clePublique = crypto.createPublicKey(clePubliquePem);
  } catch (err) {
    // La cle stockee en base est illisible/malformee. Distinguee d'une
    // simple signature invalide : ce n'est pas une tentative de fraude,
    // c'est une donnee corrompue cote serveur (ou un enrolement effectue
    // avec une cle malformee -- l'endpoint d'enrolement ne validait pas le
    // format a l'Etape 4, limitation qui devient visible ici).
    throw new SignatureAppareilInvalideError(
      'CLE_ILLISIBLE',
      `Cle publique de l'appareil illisible : ${err.message}`
    );
  }

  let signature;
  try {
    signature = Buffer.from(signatureBase64, 'base64');
  } catch (err) {
    throw new SignatureAppareilInvalideError(
      'SIGNATURE_INVALIDE',
      `Signature non decodable en Base64 : ${err.message}`
    );
  }

  const verificateur = crypto.createVerify('SHA256');
  verificateur.update(donneesSignees);
  verificateur.end();

  let valide;
  try {
    valide = verificateur.verify(
      { key: clePublique, dsaEncoding: 'ieee-p1363' },
      signature
    );
  } catch (err) {
    // Certaines signatures malformees (longueur aberrante) font lever une
    // exception plutot que retourner false -- traitees comme un rejet, pas
    // comme une panne serveur.
    throw new SignatureAppareilInvalideError(
      'SIGNATURE_INVALIDE',
      `Signature rejetee a la verification : ${err.message}`
    );
  }

  if (!valide) {
    throw new SignatureAppareilInvalideError(
      'SIGNATURE_INVALIDE',
      "La signature ne correspond pas au jeton et a la cle publique de l'appareil enrole."
    );
  }
}

module.exports = { verifierSignatureAppareil, SignatureAppareilInvalideError };
