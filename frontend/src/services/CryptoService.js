// src/services/CryptoService.js
// Moteur cryptographique de l'enrolement d'appareil (RF-07, Etape 4).
//
// Principe : la cle privee ECDSA de l'appareil ne doit JAMAIS pouvoir sortir
// du navigateur, sous aucune forme -- ni en clair, ni serialisee, ni exportee
// par un script quelconque (legitime ou injecte via XSS). Deux mecanismes du
// navigateur, combines, realisent cette garantie :
//
//   1. extractable: false a la generation (WebCrypto) -- le moteur
//      cryptographique du navigateur refuse categoriquement toute tentative
//      d'exporter la cle privee (crypto.subtle.exportKey leve une
//      InvalidAccessError), quel que soit le code qui le demande. La cle
//      privee ne peut etre UTILISEE (signer) que via l'objet CryptoKey
//      lui-meme, jamais LUE en tant que donnee.
//
//   2. IndexedDB comme unique mecanisme de persistance -- PAS localStorage.
//      localStorage ne sait stocker que des chaines de caracteres : un objet
//      CryptoKey non-extractable ne PEUT PAS y etre range du tout (il
//      faudrait d'abord l'exporter en chaine, ce qui exigerait
//      extractable:true et annulerait la garantie ci-dessus). IndexedDB, a
//      l'inverse, utilise l'algorithme de clonage structure (Structured
//      Clone) du navigateur pour persister les donnees -- et la
//      specification HTML etend explicitement cet algorithme aux objets
//      CryptoKey, y compris non-extractables, en preservant leur etat
//      interne (extractable, usages) a travers l'ecriture ET la relecture.
//      IndexedDB n'est donc pas ici "un stockage plus sur" parmi d'autres :
//      c'est le SEUL mecanisme natif du navigateur capable de faire
//      persister une cle non-extractable d'une session a l'autre.
//
// Cf. ANALYSE_CODE.md, section Etape 4, pour l'analyse complete de ce que
// cette double garantie protege reellement face a une attaque XSS -- et ce
// qu'elle NE protege PAS (elle limite le vol de cle, elle n'empeche pas
// l'abus de signature pendant qu'un script malveillant tourne activement
// dans la page).

import { get, set, createStore } from 'idb-keyval';

// Store IndexedDB dedie (base + object store nommes), plutot que le store
// par defaut d'idb-keyval partage entre toutes les utilisations possibles
// de la bibliotheque dans l'app -- separation explicite, coherente avec le
// soin apporte ailleurs dans ce projet a isoler les responsabilites (ex :
// db_logs / db_attestations cote backend).
const magasinAppareil = createStore('presence-appareil-db', 'cles-cryptographiques');

const CLE_PRIVEE_ID = 'appareil-cle-privee';
const CLE_PUBLIQUE_ID = 'appareil-cle-publique';
// Identifiant attribue par le serveur lors de l'enrolement. Conserve
// localement pour permettre a l'interface de detecter, AVANT toute tentative
// de scan, que cet appareil a ete dissocie au profit d'un autre.
const APPAREIL_ID = 'appareil-id-serveur';

const ALGORITHME = {
  name: 'ECDSA',
  namedCurve: 'P-256', // Courbe P-256 : cout de calcul adapte au mobile
  // (cle plus courte, signature/verification plus rapides que RSA a securite
  // equivalente) -- critere explicite de ce choix pour un usage sur
  // smartphone etudiant, cf. mission Etape 4.
};

/**
 * Genere une nouvelle paire de cles ECDSA P-256 et la persiste dans
 * IndexedDB. A appeler lors du premier enrolement de l'appareil, ou d'un
 * ré-enrolement volontaire (l'appel ecrase alors l'ancienne paire locale --
 * cote backend, POST /api/enrolements applique la regle RF-09 correspondante
 * : un seul appareil actif par etudiant, cf. enrolementController.js).
 *
 * @returns {Promise<CryptoKeyPair>} la paire generee (deja stockee)
 */
export async function generateAndStoreKeyPair() {
  // extractable = false : s'applique a la cle PRIVEE generee. Par
  // construction de la specification WebCrypto (generation de paire
  // asymetrique), la cle PUBLIQUE reste TOUJOURS extractable, quelle que
  // soit cette valeur -- une cle publique n'a rien de confidentiel, et doit
  // pouvoir etre exportee pour etre envoyee au backend (cf. exportPublicKey
  // ci-dessous). Ce n'est pas une incoherence : c'est precisement ce
  // comportement qui rend ce design possible (cle privee verrouillee, cle
  // publique librement diffusable, sans configuration separee pour chacune).
  const paireDeCles = await window.crypto.subtle.generateKey(
    ALGORITHME,
    false, // extractable
    ['sign', 'verify'] // usages combines : 'sign' s'applique a la privee, 'verify' a la publique
  );

  await set(CLE_PRIVEE_ID, paireDeCles.privateKey, magasinAppareil);
  await set(CLE_PUBLIQUE_ID, paireDeCles.publicKey, magasinAppareil);

  return paireDeCles;
}

/**
 * Recupere la cle publique precedemment generee et la formate en PEM
 * (SPKI encode en base64, avec les en-tetes standard) -- format choisi pour
 * rester coherent avec le reste du projet, ou les cles RS256 (cote backend,
 * keys/public.pem) sont deja manipulees exclusivement sous cette forme. Un
 * PEM est aussi directement inspectable (ex: `openssl ec -pubin -in ... `)
 * lors d'une demonstration, contrairement a un JWK ou un SPKI brut non decode.
 *
 * @returns {Promise<string>} la cle publique au format PEM
 * @throws {Error} si aucune cle n'a encore ete generee sur cet appareil
 */
export async function exportPublicKey() {
  const clePublique = await get(CLE_PUBLIQUE_ID, magasinAppareil);

  if (!clePublique) {
    throw new Error(
      "Aucune cle publique trouvee dans IndexedDB -- appelez generateAndStoreKeyPair() avant exportPublicKey()."
    );
  }

  const spki = await window.crypto.subtle.exportKey('spki', clePublique);
  return derVersPem(spki, 'PUBLIC KEY');
}

/**
 * Memorise l'identifiant serveur de cet appareil, retourne par l'enrolement.
 * Ce n'est PAS un secret : c'est un identifiant opaque, sans valeur pour qui
 * ne detient pas la cle privee correspondante.
 */
export async function memoriserIdAppareil(appareilId) {
  await set(APPAREIL_ID, appareilId, magasinAppareil);
}

/** Identifiant serveur memorise, ou null si cet appareil n'a jamais ete enrole. */
export async function lireIdAppareil() {
  return (await get(APPAREIL_ID, magasinAppareil)) ?? null;
}

/**
 * Signe une chaine de caracteres avec la cle privee de cet appareil
 * (Etape 5, RF-07 complet). Utilise pour prouver au serveur que le jeton de
 * seance scanne est bien presente par l'appareil ENROLE de l'etudiant, et
 * pas simplement par quelqu'un qui a obtenu une copie du jeton.
 *
 * La cle privee est relue depuis IndexedDB a chaque appel plutot que gardee
 * en variable de module : la page peut avoir ete rechargee entre
 * l'enrolement et le scan, et une cle en memoire ne survit pas a un
 * rechargement -- contrairement a IndexedDB, dont c'est precisement le role
 * ici (cf. en-tete de ce fichier). Cette relecture ne degrade pas la
 * garantie de securite : l'objet CryptoKey restitue reste non-extractable
 * (verifie explicitement, cf. ANALYSE_CODE.md, Etape 4).
 *
 * FORMAT DE LA SIGNATURE -- point d'interoperabilite critique :
 * crypto.subtle.sign() produit, pour ECDSA, une signature au format BRUT
 * (concatenation r||s, 64 octets pour P-256), dit "IEEE P1363". Ce n'est
 * PAS le format DER/ASN.1 (~70-72 octets, longueur variable) que la plupart
 * des bibliotheques serveur attendent par defaut, Node.js compris. Le
 * backend doit donc explicitement demander ce format a la verification
 * (option dsaEncoding: 'ieee-p1363', cf.
 * backend/src/services/deviceSignatureService.js) -- sans quoi il rejette
 * SILENCIEUSEMENT (sans exception, simplement en retournant false) toutes
 * les signatures pourtant parfaitement valides produites ici.
 *
 * @param {string} dataString - la chaine a signer (en pratique : le JWT de seance)
 * @returns {Promise<string>} la signature encodee en Base64
 * @throws {Error} si aucune cle privee n'existe sur cet appareil
 */
export async function signData(dataString) {
  if (typeof dataString !== 'string' || dataString.length === 0) {
    throw new Error('signData attend une chaine de caracteres non vide.');
  }

  const clePrivee = await get(CLE_PRIVEE_ID, magasinAppareil);

  if (!clePrivee) {
    throw new Error(
      "Aucune cle privee trouvee dans IndexedDB -- cet appareil n'est pas enrole. "
      + 'Appelez generateAndStoreKeyPair() (et enrolez-vous) avant de signer.'
    );
  }

  const donnees = new TextEncoder().encode(dataString);

  const signature = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    clePrivee,
    donnees
  );

  return arrayBufferVersBase64(signature);
}

/**
 * Indique si une paire de cles existe deja localement pour cet appareil --
 * utile pour distinguer, cote UI, un premier enrolement d'un ré-enrolement.
 * Ne lit jamais la cle privee elle-meme, seulement sa presence.
 */
export async function possedeDejaUneCle() {
  const clePrivee = await get(CLE_PRIVEE_ID, magasinAppareil);
  return clePrivee !== undefined;
}

/**
 * Encode un ArrayBuffer en Base64. window.btoa n'accepte qu'une chaine
 * "binaire" (un caractere par octet), d'ou la conversion prealable octet par
 * octet -- passer directement l'ArrayBuffer produirait "[object ArrayBuffer]".
 */
function arrayBufferVersBase64(buffer) {
  const octets = new Uint8Array(buffer);
  let binaire = '';
  for (let i = 0; i < octets.byteLength; i += 1) {
    binaire += String.fromCharCode(octets[i]);
  }
  return window.btoa(binaire);
}

/**
 * Encode un DER (ArrayBuffer) en PEM avec l'en-tete/pied de page standard,
 * lignes de 64 caracteres (RFC 7468) -- meme convention que
 * generate_keys.sh (OpenSSL) cote serveur.
 */
function derVersPem(derBuffer, etiquette) {
  const lignes = arrayBufferVersBase64(derBuffer).match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${etiquette}-----\n${lignes}\n-----END ${etiquette}-----\n`;
}

// En developpement uniquement, expose ces fonctions sur `window` pour
// permettre le protocole de test manuel decrit dans TESTING.md (ouvrir la
// console du navigateur et appeler directement CryptoService.generateAndStoreKeyPair()
// sans avoir a passer par un import dynamique). Jamais expose en dehors du
// mode developpement -- ce n'est pas une surface d'API destinee a la production.
if (import.meta.env && import.meta.env.DEV) {
  window.CryptoService = { generateAndStoreKeyPair, exportPublicKey, signData, possedeDejaUneCle, lireIdAppareil };
}
