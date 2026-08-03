// src/controllers/referentielController.js
// Lecture des donnees de reference (unites de formation, salles).
//
// Existe pour une raison precise : le formulaire d'ouverture de seance
// proposait jusqu'ici des identifiants ECRITS EN DUR dans le code frontend,
// dont certains ne correspondaient a aucune ligne en base. Toute creation
// utilisant ces valeurs echouait en violation de cle etrangere. Servir la
// liste depuis la base supprime la classe entiere du probleme : le client ne
// peut plus proposer que ce qui existe reellement.

const pool = require('../config/db');

/** GET /api/uf - route protegee (toute session authentifiee). */
async function listerUf(req, res) {
  try {
    // date_cloture IS NULL : on ne propose que les UF encore actives. Ouvrir
    // une seance sur une UF cloturee produirait des heures inexploitables.
    const [lignes] = await pool.query(
      'SELECT id, intitule FROM uf WHERE date_cloture IS NULL ORDER BY intitule'
    );
    return res.status(200).json({ status: 'ok', uf: lignes });
  } catch (error) {
    console.error('[referentielController] Erreur GET /api/uf :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

/** GET /api/salles - route protegee. */
async function listerSalles(req, res) {
  try {
    // polygone_geojson volontairement NON renvoye : il ne sert pas au choix
    // d'une salle et transmettre les contours geographiques de chaque local
    // a tout client authentifie n'a aucun interet, alors que cela facilite
    // la falsification de position une fois le geofencing en place.
    const [lignes] = await pool.query('SELECT id, nom FROM salles ORDER BY nom');
    return res.status(200).json({ status: 'ok', salles: lignes });
  } catch (error) {
    console.error('[referentielController] Erreur GET /api/salles :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

module.exports = { listerUf, listerSalles };
