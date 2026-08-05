// src/controllers/presenceController.js
// Consultation des seances et des presences (Etape 7d bis).
//
// LECTURE SEULE a ce stade. La modification des heures par le formateur et
// le traitement des demandes de rectification arriveront avec le suivi du
// temps proprement dit : les ecrans sont prepares, la logique d'ecriture ne
// l'est pas encore.
//
// La duree n'est JAMAIS lue depuis la base : elle est calculee a partir des
// instants, conformement au choix de modelisation (cf. 01-schema.sql, table
// presences). Le calcul est fait en SQL (TIMESTAMPDIFF) plutot qu'en
// JavaScript, pour que le fuseau de la base fasse foi de bout en bout.

const pool = require('../config/db');

/** Fenetre de rectification ouverte a l'etudiant, en heures (regle D). */
const FENETRE_RECTIFICATION_HEURES = 24;

/**
 * GET /api/seances
 * Route protegee, role formateur. Liste les seances avec le nombre de
 * presences enregistrees.
 */
async function listerSeances(req, res) {
  try {
    const [lignes] = await pool.query(
      `SELECT s.id, s.statut, s.date_ouverture, s.heure_debut_prevue, s.heure_fin_prevue,
              u.intitule AS uf_intitule, sa.nom AS salle_nom,
              (SELECT COUNT(*) FROM presences p WHERE p.seance_id = s.id) AS nb_presences
       FROM seances s
       JOIN uf u ON u.id = s.uf_id
       JOIN salles sa ON sa.id = s.salle_id
       ORDER BY s.date_ouverture DESC
       LIMIT 50`
    );
    return res.status(200).json({ status: 'ok', seances: lignes });
  } catch (error) {
    console.error('[presenceController] Erreur GET /api/seances :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

/**
 * GET /api/seances/:id/presences
 * Route protegee, role formateur. Detail des presences d'une seance.
 */
async function listerPresencesDeSeance(req, res) {
  const { id: seanceId } = req.params;

  try {
    const [seances] = await pool.query(
      `SELECT s.id, s.statut, s.heure_debut_prevue, s.heure_fin_prevue,
              u.intitule AS uf_intitule, sa.nom AS salle_nom
       FROM seances s
       JOIN uf u ON u.id = s.uf_id
       JOIN salles sa ON sa.id = s.salle_id
       WHERE s.id = ?`,
      [seanceId]
    );
    if (!seances[0]) {
      return res.status(404).json({ status: 'error', message: 'Seance introuvable.' });
    }

    const [presences] = await pool.query(
      `SELECT p.id, p.etudiant_id, e.nom AS etudiant_nom,
              p.heure_arrivee, p.heure_depart, p.source,
              p.position_coherente, p.distance_m, p.precision_m,
              TIMESTAMPDIFF(MINUTE, p.heure_arrivee, p.heure_depart) AS duree_minutes
       FROM presences p
       JOIN etudiants e ON e.id = p.etudiant_id
       WHERE p.seance_id = ?
       ORDER BY e.nom`,
      [seanceId]
    );

    return res.status(200).json({ status: 'ok', seance: seances[0], presences });
  } catch (error) {
    console.error('[presenceController] Erreur GET presences :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

/**
 * GET /api/mes-presences
 * Route protegee, role etudiant. Historique de l'etudiant CONNECTE.
 *
 * L'identifiant vient de la session, jamais d'un parametre : sans cela,
 * changer une valeur dans l'URL permettrait de consulter l'historique de
 * n'importe qui. Meme principe qu'a l'Etape 7c.
 */
async function listerMesPresences(req, res) {
  const etudiantId = req.utilisateur.etudiant_id;

  try {
    const [lignes] = await pool.query(
      `SELECT p.id, p.seance_id, p.heure_arrivee, p.heure_depart, p.source,
              TIMESTAMPDIFF(MINUTE, p.heure_arrivee, p.heure_depart) AS duree_minutes,
              s.heure_debut_prevue, s.heure_fin_prevue, s.statut AS seance_statut,
              u.intitule AS uf_intitule, sa.nom AS salle_nom,
              -- Fenetre de rectification calculee PAR LA BASE, a partir de
              -- l'heure de fin PREVUE de la seance et de l'horloge serveur.
              -- Ne jamais laisser le client decider s'il est encore dans les
              -- temps : il lui suffirait de changer l'heure de sa machine.
              CASE
                WHEN s.heure_fin_prevue IS NULL THEN 0
                WHEN NOW() <= DATE_ADD(s.heure_fin_prevue, INTERVAL ? HOUR) THEN 1
                ELSE 0
              END AS rectification_ouverte,
              (SELECT d.statut FROM demandes_rectification d
                WHERE d.presence_id = p.id
                ORDER BY d.date_soumission DESC LIMIT 1) AS demande_statut
       FROM presences p
       JOIN seances s ON s.id = p.seance_id
       JOIN uf u ON u.id = s.uf_id
       JOIN salles sa ON sa.id = s.salle_id
       WHERE p.etudiant_id = ?
       ORDER BY p.heure_arrivee DESC
       LIMIT 100`,
      [FENETRE_RECTIFICATION_HEURES, etudiantId]
    );

    // Le booleen est normalise ici : MySQL renvoie 0/1, et laisser filtrer
    // une valeur numeriquement vraie vers un champ nomme "ouverte" invite a
    // des comparaisons hasardeuses cote client.
    const presences = lignes.map((ligne) => ({
      ...ligne,
      rectification_ouverte: ligne.rectification_ouverte === 1,
    }));

    return res.status(200).json({ status: 'ok', presences });
  } catch (error) {
    console.error('[presenceController] Erreur GET /api/mes-presences :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

module.exports = {
  listerSeances,
  listerPresencesDeSeance,
  listerMesPresences,
  FENETRE_RECTIFICATION_HEURES,
};
