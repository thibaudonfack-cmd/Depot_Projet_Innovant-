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
const {
  clauseUfDuFormateur, formateurGereSeance, refuserHorsPerimetre,
} = require('../services/perimetreFormateur');

/** Fenetre de rectification ouverte a l'etudiant, en heures (regle D). */
const FENETRE_RECTIFICATION_HEURES = 24;

/**
 * Expression SQL determinant si une seance est terminee.
 *
 * Le statut est DEDUIT de l'horloge, il n'est pas stocke. Un champ mis a jour
 * par un traitement periodique resterait faux entre deux passages, et une
 * seance apparaitrait "en cours" des heures apres sa fin -- exactement le
 * defaut constate. Deduire garantit que la reponse est juste a la
 * milliseconde ou elle est calculee.
 *
 * Repli sur le statut stocke quand heure_fin_prevue est absente : les seances
 * creees avant l'introduction des horaires prevus (colonnes nullables) n'ont
 * pas de borne temporelle, et seule la cloture manuelle fait alors foi.
 */
const SQL_SEANCE_TERMINEE = `
  CASE
    WHEN s.heure_fin_prevue IS NOT NULL THEN (NOW() > s.heure_fin_prevue)
    ELSE (s.statut = 'cloturee')
  END`;

/**
 * Instant de fin retenu pour le calcul du temps de participation.
 *
 * Priorite a heure_depart quand elle existe : elle resulte soit d'une
 * correction du formateur, soit d'une rectification acceptee, et fait donc
 * autorite. A defaut, et seulement si la seance est terminee, on retient
 * l'heure de fin PREVUE -- un etudiant present jusqu'au bout n'a aucune
 * raison de voir son temps rester indefini parce que personne n'a saisi son
 * depart.
 */
const SQL_FIN_RETENUE = `
  COALESCE(p.heure_depart, CASE WHEN ${SQL_SEANCE_TERMINEE} THEN s.heure_fin_prevue END)`;

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
              ${SQL_SEANCE_TERMINEE} AS terminee,
              (SELECT COUNT(*) FROM presences p WHERE p.seance_id = s.id) AS nb_presences
       FROM seances s
       JOIN uf u ON u.id = s.uf_id
       JOIN salles sa ON sa.id = s.salle_id
       -- Cloisonnement pose DANS la requete : les seances des collegues ne
       -- sont jamais lues, donc jamais susceptibles de fuir par un champ
       -- oublie ou un journal trop bavard.
       WHERE ${clauseUfDuFormateur('s.uf_id')}
       ORDER BY s.date_ouverture DESC
       LIMIT 50`,
      [req.utilisateur.id]
    );
    // MySQL renvoie 0/1 pour un booleen ; on normalise ici plutot que de
    // laisser chaque vue comparer une valeur numerique a un nom qui promet un
    // booleen.
    const seances = lignes.map((s) => ({ ...s, terminee: s.terminee === 1 }));
    return res.status(200).json({ status: 'ok', seances });
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
    // Verification du mandat AVANT toute lecture de donnees d'etudiants.
    // Masquer une seance dans une liste n'empeche personne d'en deviner
    // l'identifiant et de l'appeler directement.
    const { existe, autorise } = await formateurGereSeance(pool, req.utilisateur.id, seanceId);
    if (!existe || !autorise) return refuserHorsPerimetre(res, 'Seance');

    const [seances] = await pool.query(
      `SELECT s.id, s.statut, s.heure_debut_prevue, s.heure_fin_prevue,
              u.intitule AS uf_intitule, sa.nom AS salle_nom,
              ${SQL_SEANCE_TERMINEE} AS terminee
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
              TIMESTAMPDIFF(MINUTE, p.heure_arrivee, p.heure_depart) AS duree_minutes,
              TIMESTAMPDIFF(MINUTE, p.heure_arrivee, ${SQL_FIN_RETENUE}) AS duree_validee_minutes
       FROM presences p
       JOIN seances s ON s.id = p.seance_id
       JOIN etudiants e ON e.id = p.etudiant_id
       WHERE p.seance_id = ?
       ORDER BY e.nom`,
      [seanceId]
    );

    return res.status(200).json({
      status: 'ok',
      seance: { ...seances[0], terminee: seances[0].terminee === 1 },
      presences,
    });
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
              TIMESTAMPDIFF(MINUTE, p.heure_arrivee, ${SQL_FIN_RETENUE}) AS duree_validee_minutes,
              ${SQL_SEANCE_TERMINEE} AS seance_terminee,
              s.heure_debut_prevue, s.heure_fin_prevue, s.statut AS seance_statut,
              u.intitule AS uf_intitule, sa.nom AS salle_nom,
              -- Fenetre de rectification calculee PAR LA BASE, a partir de
              -- l'heure de fin PREVUE de la seance et de l'horloge serveur.
              -- Ne jamais laisser le client decider s'il est encore dans les
              -- temps : il lui suffirait de changer l'heure de sa machine.
              -- La fenetre s'ouvre A LA FIN de la seance, pas des le scan.
              -- Signaler une erreur sur des heures encore en train de se
              -- constituer n'aurait aucun sens : l'etudiant est toujours en
              -- cours, et son depart n'est pas encore connu.
              CASE
                WHEN s.heure_fin_prevue IS NULL THEN 0
                WHEN NOW() <= s.heure_fin_prevue THEN 0
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
      seance_terminee: ligne.seance_terminee === 1,
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
  SQL_SEANCE_TERMINEE,
  SQL_FIN_RETENUE,
};
