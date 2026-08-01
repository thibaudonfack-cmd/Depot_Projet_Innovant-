// src/services/sessionService.js
// Cycle de vie des sessions authentifiees (Etape 7a).
//
// Le jeton de session est genere ici, remis au navigateur dans un cookie, et
// n'est JAMAIS stocke en clair : seule son empreinte SHA-256 est enregistree
// (cf. commentaire de la table sessions, 01-schema.sql).

const crypto = require('crypto');
const pool = require('../config/db');

const NOM_COOKIE = 'presence_session';
// 12 h : couvre largement une journee de cours sans obliger a se reconnecter
// entre deux seances, tout en restant tres inferieur a une session
// permanente. Une valeur trop longue transformerait le vol d'un cookie en
// acces durable ; trop courte, elle deconnecterait un etudiant entre deux
// cours de la meme journee.
const DUREE_SESSION_HEURES = 12;

/** Empreinte du jeton -- la seule forme sous laquelle il touche la base. */
function empreinte(jeton) {
  return crypto.createHash('sha256').update(jeton).digest('hex');
}

/**
 * Cree une session pour un utilisateur et retourne le jeton EN CLAIR.
 * C'est la seule et unique fois ou cette valeur existe cote serveur : elle
 * est immediatement transmise au navigateur, puis oubliee.
 *
 * 32 octets aleatoires (256 bits) via randomBytes -- generateur
 * cryptographiquement sur, et non Math.random(), dont la sortie est
 * predictible a partir de quelques echantillons.
 */
async function creerSession(utilisateurId) {
  const jeton = crypto.randomBytes(32).toString('base64url');
  const expiration = new Date(Date.now() + DUREE_SESSION_HEURES * 3600 * 1000);

  await pool.query(
    'INSERT INTO sessions (id, utilisateur_id, jeton_hash, date_expiration) VALUES (?, ?, ?, ?)',
    [crypto.randomUUID(), utilisateurId, empreinte(jeton), expiration]
  );

  return { jeton, expiration };
}

/**
 * Resout un jeton de session en utilisateur, ou null.
 *
 * L'expiration est verifiee EN SQL (date_expiration > NOW()) et non en
 * JavaScript apres coup : l'horloge qui fait foi est celle de la base,
 * la meme qui a servi a poser la date de creation. Comparer avec l'heure du
 * process Node introduirait une dependance a la synchronisation entre deux
 * machines potentiellement differentes -- source classique de sessions
 * acceptees alors qu'elles sont expirees, ou l'inverse.
 */
async function resoudreSession(jeton) {
  if (typeof jeton !== 'string' || jeton.length === 0) return null;

  const [lignes] = await pool.query(
    `SELECT u.id, u.email, u.nom, u.role, u.etudiant_id, s.date_expiration
     FROM sessions s
     JOIN utilisateurs u ON u.id = s.utilisateur_id
     WHERE s.jeton_hash = ? AND s.date_expiration > NOW()
     LIMIT 1`,
    [empreinte(jeton)]
  );

  return lignes[0] || null;
}

/**
 * Supprime la session correspondant a ce jeton. Suppression REELLE (DELETE),
 * pas un simple marquage : une session revoquee ne doit plus exister. C'est
 * ce que ne permet pas un JWT auto-porteur, et la raison principale du choix
 * d'une session cote serveur (cf. ANALYSE_CODE.md, Etape 7a).
 */
async function supprimerSession(jeton) {
  if (typeof jeton !== 'string' || jeton.length === 0) return;
  await pool.query('DELETE FROM sessions WHERE jeton_hash = ?', [empreinte(jeton)]);
}

/**
 * Options du cookie de session. Chacune ferme un vecteur precis :
 *
 * - httpOnly : le cookie est INVISIBLE a JavaScript (document.cookie ne le
 *   voit pas). C'est la raison meme du choix du cookie plutot que d'un jeton
 *   en memoire ou en localStorage : une faille XSS ne permet PAS de voler la
 *   session. Coherent avec l'analyse XSS deja menee a l'Etape 4 sur la cle
 *   privee ECDSA -- meme principe, applique a la session.
 * - secure : cookie transmis uniquement en HTTPS. Sans cette option, une
 *   seule requete en clair suffirait a l'exposer sur le reseau. Le projet
 *   etant integralement servi par Caddy en HTTPS depuis l'Etape 0.2, cette
 *   contrainte n'a aucun cout ici.
 * - sameSite: 'strict' : le navigateur n'envoie PAS le cookie sur une requete
 *   declenchee depuis un autre site. C'est la protection CSRF principale : un
 *   site malveillant ne peut pas faire valider une presence a l'insu de
 *   l'etudiant, meme s'il connait l'URL de l'API. 'strict' plutot que 'lax'
 *   car aucun parcours de ce prototype n'arrive depuis un lien externe.
 * - path: '/' : le cookie accompagne aussi bien /api/* que le frontend.
 */
function optionsCookie(expiration) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    expires: expiration,
  };
}

/**
 * Extrait un cookie de l'en-tete brut.
 *
 * Analyse manuelle plutot que le paquet cookie-parser : une dependance de
 * plus pour lire une seule valeur, alors que le projet s'est justement
 * astreint a limiter ses dependances apres les incidents de lockfile
 * (cf. ANALYSE_CODE.md). Le decoupage est volontairement conservateur --
 * seule la premiere occurrence du nom recherche est retenue, et la valeur
 * est passee a decodeURIComponent puisque res.cookie() encode a l'ecriture.
 */
function lireCookie(enTeteCookie, nom) {
  if (typeof enTeteCookie !== 'string') return null;

  for (const morceau of enTeteCookie.split(';')) {
    const separateur = morceau.indexOf('=');
    if (separateur === -1) continue;
    if (morceau.slice(0, separateur).trim() !== nom) continue;

    const valeur = morceau.slice(separateur + 1).trim();
    try {
      return decodeURIComponent(valeur);
    } catch {
      // Valeur mal encodee : la renvoyer telle quelle plutot que de lever.
      // Elle ne correspondra a aucune session, donc le resultat sera un
      // simple refus d'authentification -- jamais une erreur 500.
      return valeur;
    }
  }
  return null;
}

module.exports = {
  NOM_COOKIE,
  DUREE_SESSION_HEURES,
  creerSession,
  resoudreSession,
  supprimerSession,
  optionsCookie,
  lireCookie,
};
