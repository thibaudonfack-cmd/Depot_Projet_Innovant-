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
 * Indique si une paire de cles existe deja localement pour cet appareil --
 * utile pour distinguer, cote UI, un premier enrolement d'un ré-enrolement.
 * Ne lit jamais la cle privee elle-meme, seulement sa presence.
 */
export async function possedeDejaUneCle() {
  const clePrivee = await get(CLE_PRIVEE_ID, magasinAppareil);
  return clePrivee !== undefined;
}

/**
 * Encode un DER (ArrayBuffer) en PEM avec l'en-tete/pied de page standard,
 * lignes de 64 caracteres (RFC 7468) -- meme convention que
 * generate_keys.sh (OpenSSL) cote serveur.
 */
function derVersPem(derBuffer, etiquette) {
  const octets = new Uint8Array(derBuffer);
  let binaire = '';
  for (let i = 0; i < octets.byteLength; i += 1) {
    binaire += String.fromCharCode(octets[i]);
  }
  const base64 = window.btoa(binaire);
  const lignes = base64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${etiquette}-----\n${lignes}\n-----END ${etiquette}-----\n`;
}

// En developpement uniquement, expose ces fonctions sur `window` pour
// permettre le protocole de test manuel decrit dans TESTING.md (ouvrir la
// console du navigateur et appeler directement CryptoService.generateAndStoreKeyPair()
// sans avoir a passer par un import dynamique). Jamais expose en dehors du
// mode developpement -- ce n'est pas une surface d'API destinee a la production.
if (import.meta.env && import.meta.env.DEV) {
  window.CryptoService = { generateAndStoreKeyPair, exportPublicKey, possedeDejaUneCle };
}
