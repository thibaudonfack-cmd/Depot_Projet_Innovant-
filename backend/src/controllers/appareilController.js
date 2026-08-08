// src/controllers/appareilController.js
// Etat de l'appareil enrole de l'etudiant connecte.
//
// Existe pour un besoin d'interface precis : l'etudiant ne doit pas
// decouvrir que son appareil a ete dissocie au moment ou il tente de
// scanner, devant la classe. Le frontend compare l'identifiant conserve
// localement lors de l'enrolement avec celui renvoye ici, et peut ainsi
// prevenir AVANT toute tentative.

const pool = require('../config/db');
const { QUOTA_ENROLEMENTS_MAX } = require('./enrolementController');

/** GET /api/mon-appareil - role etudiant. */
async function consulterMonAppareil(req, res) {
  try {
    const [lignes] = await pool.query(
      `SELECT id, info_appareil, date_enrolement
       FROM appareils_enroles
       WHERE etudiant_id = ? AND statut = 'actif'
       LIMIT 1`,
      [req.utilisateur.etudiant_id]
    );

    // Etape 11 : le quota est renvoye pour que l'interface puisse AVERTIR
    // avant l'action plutot que d'annoncer un refus apres coup. Un utilisateur
    // qui apprend la limite au moment ou elle le bloque la subit ; celui qui
    // la connait avant peut decider.
    const [compteurs] = await pool.query(
      'SELECT compteur_enrolements FROM etudiants WHERE id = ?',
      [req.utilisateur.etudiant_id]
    );
    const consommes = Number(compteurs[0]?.compteur_enrolements ?? 0);

    // cle_publique volontairement NON renvoyee : le client la possede deja
    // s'il s'agit de son appareil, et la transmettre a un autre appareil
    // n'aurait aucune utilite legitime.
    return res.status(200).json({
      status: 'ok',
      appareil: lignes[0] ?? null,
      quota: {
        consommes,
        maximum: QUOTA_ENROLEMENTS_MAX,
        // Jamais negatif : un compteur remis a une valeur superieure au
        // maximum par une manipulation en base afficherait sinon "-1
        // association restante", ce qui n'a pas de sens a l'ecran.
        restants: Math.max(0, QUOTA_ENROLEMENTS_MAX - consommes),
      },
    });
  } catch (error) {
    console.error('[appareilController] Erreur GET /api/mon-appareil :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

module.exports = { consulterMonAppareil };
