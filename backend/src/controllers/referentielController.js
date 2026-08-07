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
const { clauseUfDuFormateur } = require('../services/perimetreFormateur');

/** GET /api/uf - route protegee (toute session authentifiee). */
async function listerUf(req, res) {
  try {
    // date_cloture IS NULL : on ne propose que les UF encore actives pour la
    // CREATION de seance -- ouvrir une seance sur une UF cloturee produirait
    // des heures inexploitables.
    //
    // Etape 9 : la liste sert desormais AUSSI au selecteur du bilan, qui doit
    // pouvoir atteindre une UF cloturee (c'est meme le cas d'usage principal
    // en fin de semestre). D'ou le parametre `toutes`, plutot qu'une seconde
    // route qui dupliquerait la meme requete a un filtre pres.
    const toutes = req.query.toutes === '1';

    // CLOISONNEMENT (Etape 10). Un formateur ne recoit que les UF qui lui
    // sont confiees ; un etudiant continue de recevoir la liste complete,
    // dont il a besoin pour lire l'intitule de ses propres seances et qui ne
    // contient aucune donnee personnelle.
    const filtres = [];
    const parametres = [];
    if (!toutes) filtres.push('u.date_cloture IS NULL');
    if (req.utilisateur.role === 'formateur') {
      filtres.push(clauseUfDuFormateur('u.id'));
      parametres.push(req.utilisateur.id);
    }

    const [lignes] = await pool.query(
      `SELECT u.id, u.intitule, u.date_cloture, u.date_cloture_rgpd,
              u.volume_horaire_minutes
         FROM uf u
        ${filtres.length > 0 ? `WHERE ${filtres.join(' AND ')}` : ''}
        ORDER BY u.intitule`,
      parametres
    );
    return res.status(200).json({
      status: 'ok',
      // Drapeau explicite plutot que de laisser chaque ecran comparer une
      // date a null : la question posee est booleenne.
      uf: lignes.map((u) => ({ ...u, cloturee_rgpd: u.date_cloture_rgpd !== null })),
    });
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
