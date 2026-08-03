// src/controllers/appareilController.js
// Etat de l'appareil enrole de l'etudiant connecte.
//
// Existe pour un besoin d'interface precis : l'etudiant ne doit pas
// decouvrir que son appareil a ete dissocie au moment ou il tente de
// scanner, devant la classe. Le frontend compare l'identifiant conserve
// localement lors de l'enrolement avec celui renvoye ici, et peut ainsi
// prevenir AVANT toute tentative.

const pool = require('../config/db');

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

    // cle_publique volontairement NON renvoyee : le client la possede deja
    // s'il s'agit de son appareil, et la transmettre a un autre appareil
    // n'aurait aucune utilite legitime.
    return res.status(200).json({ status: 'ok', appareil: lignes[0] ?? null });
  } catch (error) {
    console.error('[appareilController] Erreur GET /api/mon-appareil :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

module.exports = { consulterMonAppareil };
