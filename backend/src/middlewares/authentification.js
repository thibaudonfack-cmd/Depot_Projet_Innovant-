// src/middlewares/authentification.js
// Middleware d'authentification par cookie de session (Etape 7a).

const { NOM_COOKIE, resoudreSession, lireCookie } = require('../services/sessionService');

/**
 * Exige une session valide. En cas de succes, place l'utilisateur resolu
 * dans req.utilisateur -- SEULE source d'identite autorisee pour les
 * controleurs a partir de l'Etape 7c. Aucun controleur ne doit plus lire un
 * identifiant d'utilisateur depuis req.body : c'est precisement ce que cette
 * etape corrige.
 */
async function exigerAuthentification(req, res, next) {
  const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);

  if (!jeton) {
    return res.status(401).json({
      status: 'error',
      code: 'NON_AUTHENTIFIE',
      message: 'Authentification requise.',
    });
  }

  let utilisateur;
  try {
    utilisateur = await resoudreSession(jeton);
  } catch (error) {
    // Panne de base : 500, jamais 401. Repondre 401 sur une indisponibilite
    // ferait croire au client que sa session est invalide et l'inciterait a
    // se reconnecter en boucle, masquant l'incident reel.
    console.error('[auth] Erreur lors de la resolution de session :', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Erreur serveur lors de la verification de la session.',
    });
  }

  if (!utilisateur) {
    // Session inconnue OU expiree -- volontairement indistinguables dans la
    // reponse : le client n'a rien a en faire de different (dans les deux cas
    // il doit se reconnecter), et les distinguer indiquerait a un attaquant
    // qu'un jeton donne a un jour existe.
    return res.status(401).json({
      status: 'error',
      code: 'SESSION_INVALIDE',
      message: 'Session invalide ou expiree : reconnectez-vous.',
    });
  }

  req.utilisateur = utilisateur;
  return next();
}

/**
 * Restreint une route a un role. A chainer APRES exigerAuthentification.
 *
 * 403 et non 401 : l'utilisateur est parfaitement authentifie, c'est son
 * ROLE qui ne l'autorise pas. Un 401 lui suggererait de se reconnecter, ce
 * qui ne changerait rien -- meme distinction que celle deja appliquee a
 * AUCUN_APPAREIL_ENROLE a l'Etape 5.
 */
function exigerRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.utilisateur) {
      // Garde-fou de developpement : signale un middleware mal chaine plutot
      // que de laisser passer silencieusement une route non protegee.
      console.error('[auth] exigerRole utilise sans exigerAuthentification en amont.');
      return res.status(500).json({ status: 'error', message: 'Configuration serveur invalide.' });
    }
    if (!rolesAutorises.includes(req.utilisateur.role)) {
      return res.status(403).json({
        status: 'error',
        code: 'ROLE_INSUFFISANT',
        message: `Action reservee au role : ${rolesAutorises.join(' ou ')}.`,
      });
    }
    return next();
  };
}

module.exports = { exigerAuthentification, exigerRole };
