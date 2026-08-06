// src/controllers/rapportController.js
// Rapport administratif d'une seance (Etape 8).
//
// Destine a la validation des credits : l'ecole a besoin de savoir, pour
// chaque etudiant ATTENDU, s'il etait present et combien de temps.
//
// Point de conception central : le rapport ne part NI des seules inscriptions,
// NI des seules presences, mais de leur UNION.
//
// Partir des seules presences ne montrerait que ceux qui sont venus, alors
// que l'information administrative la plus importante est precisement
// l'inverse -- qui manquait.
//
// Mais partir des seules inscriptions, comme le faisait la premiere version,
// a un defaut symetrique et plus grave : un etudiant REELLEMENT PRESENT mais
// non inscrit a l'UF de la seance disparaissait purement et simplement du
// rapport. Le cas est arrive en test de bout en bout -- une seance creee sur
// une UF sans inscrits affichait "Attendus 0, Presents 0, Absents 0" alors
// qu'un etudiant avait scanne et figurait dans la table presences. Aucune
// erreur n'etait levee : le rapport etait simplement muet.
//
// C'est le pire defaut possible pour un releve d'assiduite. Un absent
// improprement compte se remarque -- l'interesse proteste. Un PRESENT EFFACE
// ne se remarque pas : ni l'etudiant, qui a scanne et croit son temps
// enregistre, ni le formateur, qui ne peut pas remarquer l'absence de
// quelqu'un dont il ignore qu'il devrait figurer.
//
// L'union corrige cela. Un etudiant present sans etre inscrit apparait
// desormais, explicitement signale par le drapeau `inscrit: false` -- ce qui
// est une information administrative utile (changement de groupe, inscription
// non enregistree, erreur d'UF a la creation de la seance), et non quelque
// chose a masquer. Le rapport ne cache rien de ce que la base sait.

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
              (i.etudiant_id IS NOT NULL) AS inscrit,
              p.id AS presence_id, p.heure_arrivee, p.heure_depart, p.source,
              p.position_coherente, p.distance_m,
              ${SQL_FIN_RETENUE} AS fin_retenue,
              TIMESTAMPDIFF(MINUTE, p.heure_arrivee, ${SQL_FIN_RETENUE}) AS minutes_validees,
              (SELECT COUNT(*) FROM demandes_rectification d
                WHERE d.presence_id = p.id AND d.statut = 'en_attente') AS demandes_en_attente
       -- On PART de la seance, dont on sait qu'elle existe (verifiee
       -- ci-dessus) : ses horaires sont ainsi disponibles pour les
       -- expressions ci-dessus meme quand l'etudiant n'a aucune presence.
       FROM seances s
       -- L'UNION des deux populations : ceux qu'on ATTENDAIT (inscrits a
       -- l'UF) et ceux qui sont VENUS (une presence sur cette seance).
       -- UNION et non UNION ALL : le dedoublonnage est justement l'objectif,
       -- un etudiant a la fois inscrit et present ne devant apparaitre
       -- qu'une fois.
       JOIN etudiants e ON e.id IN (
              SELECT i2.etudiant_id FROM inscriptions i2 WHERE i2.uf_id = s.uf_id
              UNION
              SELECT p2.etudiant_id FROM presences p2 WHERE p2.seance_id = s.id
            )
       -- Jointure EXTERNE : elle sert a savoir si l'etudiant etait attendu,
       -- pas a filtrer. Une jointure interne ici reintroduirait exactement le
       -- defaut corrige.
       LEFT JOIN inscriptions i ON i.etudiant_id = e.id AND i.uf_id = s.uf_id
       LEFT JOIN presences p ON p.seance_id = s.id AND p.etudiant_id = e.id
       WHERE s.id = ?
       ORDER BY e.nom`,
      [seanceId]
    );

    const etudiants = lignes.map((ligne) => ({
      etudiant_id: ligne.etudiant_id,
      nom: ligne.etudiant_nom,
      email: ligne.email,
      present: ligne.presence_id !== null,
      // Un present non inscrit n'est pas une anomalie a taire : c'est un
      // fait que le secretariat doit trancher. On le remonte tel quel.
      inscrit: ligne.inscrit === 1,
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
    const inscrits = etudiants.filter((e) => e.inscrit);
    const minutesTotal = presents.reduce((somme, e) => somme + (e.minutes_validees ?? 0), 0);

    return res.status(200).json({
      status: 'ok',
      seance: { ...seance, terminee: seance.terminee === 1 },
      synthese: {
        // "Attendus" compte les INSCRITS, pas les lignes du tableau : un
        // present non inscrit n'etait, par definition, pas attendu. L'ancien
        // calcul (etudiants.length) confondait les deux et aurait gonfle
        // l'effectif theorique de l'UF.
        attendus: inscrits.length,
        presents: presents.length,
        // Un absent est un INSCRIT qui n'est pas venu -- soustraire
        // betement les presents des attendus donnerait un nombre negatif des
        // qu'un non-inscrit se presente.
        absents: inscrits.filter((e) => !e.present).length,
        // Signale au secretariat qu'une ligne du tableau sort du cadre
        // administratif prevu. Zero dans le cas normal.
        presents_non_inscrits: presents.filter((e) => !e.inscrit).length,
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
