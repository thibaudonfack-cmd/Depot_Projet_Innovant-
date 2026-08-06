// src/controllers/rapportController.js
// Rapport administratif d'une seance (Etape 8).
//
// Destine a la validation des credits : l'ecole a besoin de savoir, pour
// chaque etudiant ATTENDU, s'il etait present et combien de temps.
//
// Point de conception central : le rapport part des INSCRIPTIONS, pas des
// presences. Lister les presences ne montrerait que ceux qui sont venus,
// alors que l'information administrative la plus importante est precisement
// l'inverse -- qui manquait. Une jointure externe depuis inscriptions garantit
// que chaque etudiant attendu figure au rapport, present ou non.

const pool = require('../config/db');
const { SQL_SEANCE_TERMINEE, SQL_FIN_RETENUE } = require('./presenceController');

/**
 * GET /api/seances/:id/rapport
 * Role formateur.
 */
async function genererRapport(req, res) {
  const { id: seanceId } = req.params;

  try {
    const [seances] = await pool.query(
      `SELECT s.id, s.uf_id, s.statut, s.date_ouverture,
              s.heure_debut_prevue, s.heure_fin_prevue, s.quota_minutes,
              u.intitule AS uf_intitule, sa.nom AS salle_nom,
              ${SQL_SEANCE_TERMINEE} AS terminee
       FROM seances s
       JOIN uf u ON u.id = s.uf_id
       JOIN salles sa ON sa.id = s.salle_id
       WHERE s.id = ?`,
      [seanceId]
    );

    const seance = seances[0];
    if (!seance) {
      return res.status(404).json({ status: 'error', message: 'Seance introuvable.' });
    }

    const [lignes] = await pool.query(
      `SELECT e.id AS etudiant_id, e.nom AS etudiant_nom, e.email,
              p.id AS presence_id, p.heure_arrivee, p.heure_depart, p.source,
              p.position_coherente, p.distance_m,
              ${SQL_FIN_RETENUE} AS fin_retenue,
              TIMESTAMPDIFF(MINUTE, p.heure_arrivee, ${SQL_FIN_RETENUE}) AS minutes_validees,
              (SELECT COUNT(*) FROM demandes_rectification d
                WHERE d.presence_id = p.id AND d.statut = 'en_attente') AS demandes_en_attente
       FROM inscriptions i
       JOIN etudiants e ON e.id = i.etudiant_id
       -- Jointure sur la seance pour disposer de ses horaires dans les
       -- expressions ci-dessus, meme lorsque l'etudiant n'a aucune presence.
       JOIN seances s ON s.id = ?
       LEFT JOIN presences p ON p.seance_id = s.id AND p.etudiant_id = e.id
       WHERE i.uf_id = ?
       ORDER BY e.nom`,
      [seanceId, seance.uf_id]
    );

    const etudiants = lignes.map((ligne) => ({
      etudiant_id: ligne.etudiant_id,
      nom: ligne.etudiant_nom,
      email: ligne.email,
      present: ligne.presence_id !== null,
      heure_arrivee: ligne.heure_arrivee,
      // Distinguer l'heure REELLEMENT saisie de celle retenue pour le calcul :
      // un rapport doit pouvoir montrer que le depart n'a pas ete pointe et
      // que la fin prevue a servi de substitut, sans quoi la valeur parait
      // constatee alors qu'elle est deduite.
      heure_depart_saisie: ligne.heure_depart,
      heure_fin_retenue: ligne.fin_retenue,
      depart_deduit: ligne.presence_id !== null && ligne.heure_depart === null,
      minutes_validees: ligne.minutes_validees,
      source: ligne.source,
      position_coherente: ligne.position_coherente === null ? null : ligne.position_coherente === 1,
      distance_m: ligne.distance_m,
      // Signale au secretariat qu'une contestation est pendante : valider des
      // credits sur un temps encore susceptible d'etre corrige exposerait a
      // devoir revenir sur la decision.
      demande_en_attente: ligne.demandes_en_attente > 0,
    }));

    const presents = etudiants.filter((e) => e.present);
    const minutesTotal = presents.reduce((somme, e) => somme + (e.minutes_validees ?? 0), 0);

    return res.status(200).json({
      status: 'ok',
      seance: { ...seance, terminee: seance.terminee === 1 },
      synthese: {
        attendus: etudiants.length,
        presents: presents.length,
        absents: etudiants.length - presents.length,
        minutes_validees_total: minutesTotal,
        // Un rapport etabli sur une seance en cours est par nature provisoire.
        // Le dire explicitement evite qu'il soit archive comme definitif.
        provisoire: seance.terminee !== 1,
        demandes_en_attente: etudiants.filter((e) => e.demande_en_attente).length,
      },
      etudiants,
    });
  } catch (error) {
    console.error('[rapportController] Erreur GET rapport :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

module.exports = { genererRapport };
