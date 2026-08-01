// src/controllers/authController.js
// Authentification par mot de passe et gestion de la session (Etape 7a).

const pool = require('../config/db');
const { verifierMotDePasse, hacherMotDePasse } = require('../services/passwordService');
const {
  NOM_COOKIE, creerSession, supprimerSession, optionsCookie, lireCookie,
} = require('../services/sessionService');

// Empreinte scrypt d'une valeur sans interet, calculee UNE FOIS au demarrage.
// Elle sert de leurre quand l'email fourni ne correspond a aucun compte :
// voir l'explication detaillee dans connexion() ci-dessous.
let hachageLeurre = null;
const hachageLeurrePret = hacherMotDePasse(`leurre-${Date.now()}-${Math.random()}`)
  .then((h) => { hachageLeurre = h; })
  .catch((err) => { console.error('[auth] Echec de preparation du leurre :', err.message); });

/**
 * POST /api/auth/login
 * Corps attendu : { email: string, mot_de_passe: string }
 */
async function connexion(req, res) {
  const { email, mot_de_passe: motDePasse } = req.body || {};

  if (!email || !motDePasse) {
    return res.status(400).json({
      status: 'error',
      message: 'email et mot_de_passe sont obligatoires.',
    });
  }

  try {
    const [lignes] = await pool.query(
      'SELECT id, email, nom, role, etudiant_id, mot_de_passe_hash FROM utilisateurs WHERE email = ? LIMIT 1',
      [email]
    );
    const utilisateur = lignes[0];

    // ANTI-ENUMERATION DE COMPTES. Si l'email est inconnu, on ne retourne pas
    // immediatement : on verifie le mot de passe contre une empreinte leurre.
    // Sans cette precaution, un email inexistant repondrait en ~1 ms (simple
    // SELECT) tandis qu'un email valide repondrait en ~130 ms (le cout de
    // scrypt). Cet ecart, parfaitement mesurable a distance, permettrait de
    // tester une liste d'adresses et de determiner lesquelles ont un compte --
    // information exploitable pour du hameconnage cible, et donnee personnelle
    // au sens du RGPD. Le leurre egalise les deux chemins.
    await hachageLeurrePret;
    const empreinteAComparer = utilisateur ? utilisateur.mot_de_passe_hash : hachageLeurre;
    const motDePasseValide = await verifierMotDePasse(motDePasse, empreinteAComparer);

    if (!utilisateur || !motDePasseValide) {
      // Message VOLONTAIREMENT identique dans les deux cas (compte inconnu /
      // mot de passe errone), pour la meme raison que ci-dessus : distinguer
      // les deux reviendrait a confirmer l'existence d'un compte.
      return res.status(401).json({
        status: 'error',
        code: 'IDENTIFIANTS_INVALIDES',
        message: 'Email ou mot de passe incorrect.',
      });
    }

    const { jeton, expiration } = await creerSession(utilisateur.id);
    res.cookie(NOM_COOKIE, jeton, optionsCookie(expiration));

    // Le jeton de session n'apparait JAMAIS dans le corps de la reponse : il
    // ne doit exister que dans le cookie httpOnly, hors de portee de
    // JavaScript. Le renvoyer ici annulerait tout l'interet du httpOnly.
    return res.status(200).json({
      status: 'ok',
      utilisateur: {
        id: utilisateur.id,
        email: utilisateur.email,
        nom: utilisateur.nom,
        role: utilisateur.role,
        etudiant_id: utilisateur.etudiant_id,
      },
    });
  } catch (error) {
    console.error('[authController] Erreur POST /api/auth/login :', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Erreur serveur lors de la connexion.',
    });
  }
}

/**
 * POST /api/auth/logout
 *
 * Supprime reellement la session en base, puis efface le cookie. L'ordre
 * importe peu, mais les DEUX sont necessaires : effacer le seul cookie
 * laisserait une session valide en base, exploitable par quiconque aurait
 * intercepte le jeton avant la deconnexion.
 *
 * Repond 200 meme si aucune session n'existait : la deconnexion est
 * idempotente. Repondre 401 a quelqu'un qui se deconnecte n'aurait aucun
 * sens -- le resultat souhaite (ne plus etre connecte) est atteint.
 */
async function deconnexion(req, res) {
  const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);

  try {
    if (jeton) await supprimerSession(jeton);
  } catch (error) {
    console.error('[authController] Erreur lors de la suppression de session :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur lors de la deconnexion.' });
  }

  // clearCookie doit recevoir les MEMES attributs que ceux poses a la
  // creation (path, sameSite, secure) : un navigateur qui ne retrouve pas un
  // cookie strictement equivalent refuse de le supprimer, et la session
  // resterait affichee comme active cote client.
  res.clearCookie(NOM_COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  return res.status(200).json({ status: 'ok' });
}

/**
 * GET /api/auth/moi
 * Route protegee : renvoie l'utilisateur de la session courante. Permet au
 * frontend de savoir, au chargement, s'il existe une session valide -- il ne
 * peut pas lire le cookie lui-meme, puisqu'il est httpOnly.
 */
async function moi(req, res) {
  return res.status(200).json({
    status: 'ok',
    utilisateur: {
      id: req.utilisateur.id,
      email: req.utilisateur.email,
      nom: req.utilisateur.nom,
      role: req.utilisateur.role,
      etudiant_id: req.utilisateur.etudiant_id,
    },
  });
}

module.exports = { connexion, deconnexion, moi };
