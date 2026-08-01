// src/services/passwordService.js
// Hachage et verification des mots de passe (Etape 7a).
//
// scrypt, PAS bcrypt ni argon2. Ce n'est pas un choix par defaut : bcrypt et
// argon2 sont d'excellents KDF, mais leurs implementations Node sont des
// MODULES NATIFS a compiler a l'installation. Ce projet a deja perdu
// plusieurs allers-retours de pipeline sur des problemes de dependances
// liees a la plateforme (cf. ANALYSE_CODE.md, "Fix CI : package-lock.json
// desynchronise" et "Recidive et durcissement definitif") ; introduire un
// binaire a compiler, qui differe entre l'hote Windows du developpeur, le
// conteneur Linux et le runner de CI, rouvrirait exactement cette classe de
// probleme. scrypt est fourni PAR NODE lui-meme (module crypto), sans
// aucune dependance a installer -- meme raisonnement que crypto.randomUUID()
// a l'Etape 2 et que crypto.subtle a l'Etape 4.
//
// scrypt n'est pas un repli au rabais : c'est un KDF normalise (RFC 7914),
// concu pour resister au calcul massivement parallele (GPU/ASIC) par son
// cout MEMOIRE, la meme propriete qui fait la valeur d'argon2. Il est
// explicitement recommande par l'OWASP comme alternative acceptable quand
// argon2id n'est pas disponible.

const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

// Parametres de cout. N=2^15 (32768) est au-dessus du minimum OWASP
// (N=2^14 avec r=8, p=1) -- marge deliberee, le cout d'une authentification
// n'etant paye qu'une fois par connexion, pas a chaque requete (c'est
// precisement l'interet d'une session : le mot de passe n'est verifie
// qu'au login).
const COUT_N = 32768;
const TAILLE_BLOC_R = 8;
const PARALLELISME_P = 1;
const LONGUEUR_CLE = 64;
const LONGUEUR_SEL = 16;

// maxmem doit etre releve explicitement : la valeur par defaut de Node
// (32 Mio) est INFERIEURE a ce que N=32768 exige (~128 * N * r = 32 Mio, plus
// la marge interne), et scrypt echouerait avec une erreur peu explicite
// ("Invalid scrypt params"). Formule officielle : 128 * N * r, doublee ici
// pour la marge.
const MAXMEM = 2 * 128 * COUT_N * TAILLE_BLOC_R;

/**
 * Hache un mot de passe. Le resultat encode TOUT ce qui est necessaire a sa
 * verification ulterieure : algorithme, parametres de cout, sel et empreinte.
 *
 * Format : scrypt$N$r$p$<sel base64>$<empreinte base64>
 *
 * Encoder les parametres DANS la chaine stockee (plutot que de les figer
 * dans le code) permet de durcir le cout plus tard sans invalider les
 * comptes existants : les anciens hachages restent verifiables avec leurs
 * propres parametres, et peuvent etre re-haches au prochain login reussi.
 * Un code qui suppose des parametres constants rend toute evolution
 * impossible sans reinitialiser tous les mots de passe.
 *
 * @param {string} motDePasse
 * @returns {Promise<string>}
 */
async function hacherMotDePasse(motDePasse) {
  if (typeof motDePasse !== 'string' || motDePasse.length === 0) {
    throw new Error('hacherMotDePasse attend une chaine non vide.');
  }

  // Sel aleatoire PAR MOT DE PASSE : deux utilisateurs ayant choisi le meme
  // mot de passe obtiennent des empreintes differentes. Sans sel, une seule
  // table precalculee permettrait de casser tous les comptes a la fois.
  const sel = crypto.randomBytes(LONGUEUR_SEL);
  const empreinte = await scryptAsync(motDePasse, sel, LONGUEUR_CLE, {
    N: COUT_N, r: TAILLE_BLOC_R, p: PARALLELISME_P, maxmem: MAXMEM,
  });

  return [
    'scrypt', COUT_N, TAILLE_BLOC_R, PARALLELISME_P,
    sel.toString('base64'), empreinte.toString('base64'),
  ].join('$');
}

/**
 * Verifie un mot de passe contre une empreinte stockee.
 *
 * Ne leve JAMAIS d'exception pour un hachage malforme : retourne false. Une
 * exception ici remonterait en 500 et distinguerait, du point de vue d'un
 * attaquant, un compte a hachage corrompu d'un simple mot de passe errone --
 * une fuite d'information inutile.
 *
 * @returns {Promise<boolean>}
 */
async function verifierMotDePasse(motDePasse, hachageStocke) {
  if (typeof motDePasse !== 'string' || typeof hachageStocke !== 'string') {
    return false;
  }

  const parties = hachageStocke.split('$');
  if (parties.length !== 6 || parties[0] !== 'scrypt') return false;

  const [, nTexte, rTexte, pTexte, selB64, empreinteB64] = parties;
  const N = Number(nTexte);
  const r = Number(rTexte);
  const p = Number(pTexte);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let sel;
  let empreinteAttendue;
  try {
    sel = Buffer.from(selB64, 'base64');
    empreinteAttendue = Buffer.from(empreinteB64, 'base64');
  } catch {
    return false;
  }
  if (sel.length === 0 || empreinteAttendue.length === 0) return false;

  let empreinteCalculee;
  try {
    empreinteCalculee = await scryptAsync(motDePasse, sel, empreinteAttendue.length, {
      N, r, p, maxmem: 2 * 128 * N * r,
    });
  } catch {
    return false;
  }

  // timingSafeEqual, et non === : une comparaison classique s'arrete au
  // premier octet different, si bien que la DUREE de la comparaison revele
  // combien d'octets initiaux etaient corrects. Repete, ce signal permet de
  // reconstituer l'empreinte octet par octet. timingSafeEqual compare en
  // temps constant. Il exige des longueurs egales, d'ou le controle
  // prealable (lui-meme sans risque : la longueur de l'empreinte n'est pas
  // un secret).
  if (empreinteCalculee.length !== empreinteAttendue.length) return false;
  return crypto.timingSafeEqual(empreinteCalculee, empreinteAttendue);
}

module.exports = { hacherMotDePasse, verifierMotDePasse };
