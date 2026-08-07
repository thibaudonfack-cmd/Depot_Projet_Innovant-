// src/controllers/ufController.js
// Bilan global par unite de formation (Etape 9).
//
// Le rapport de seance (Etape 8) repond a "qui etait la ce jour-la ?". Ce
// bilan repond a une question differente et administrativement decisive :
// "cet etudiant a-t-il suivi assez d'heures pour valider son UF ?".
//
// Le changement de maille impose deux precautions.
//
// 1. SEULES LES SEANCES TERMINEES SONT AGREGEES. Une seance en cours n'a pas
//    de duree definitive : l'inclure ferait varier le bilan d'une minute a
//    l'autre, et un formateur qui l'imprime a 10 h obtiendrait autre chose
//    qu'a 11 h pour les memes faits. Un bilan doit etre stable.
//
// 2. LE NOMBRE DE SEANCES PREVUES EST COMPTE INDEPENDAMMENT DES PRESENCES.
//    Le calculer a partir des lignes de presence donnerait un denominateur
//    different pour chaque etudiant, et un taux d'assiduite de 100 % a
//    quelqu'un venu une seule fois sur douze seances.

const pool = require('../config/db');

/** Expression SQL : une seance est terminee (meme regle que partout ailleurs). */
const SQL_TERMINEE = `
  CASE
    WHEN s.heure_fin_prevue IS NOT NULL THEN (NOW() > s.heure_fin_prevue)
    ELSE (s.statut = 'cloturee')
  END`;

/** Fin retenue : depart pointe, sinon fin prevue si la seance est terminee. */
const SQL_FIN_RETENUE = `
  COALESCE(p.heure_depart, CASE WHEN ${SQL_TERMINEE} THEN s.heure_fin_prevue END)`;

/**
 * GET /api/uf/:id/rapport-global
 * Role formateur. Bilan d'assiduite cumule sur toute l'unite de formation.
 */
async function rapportGlobal(req, res) {
  const { id: ufId } = req.params;

  try {
    const [ufs] = await pool.query(
      'SELECT id, intitule, date_cloture, date_cloture_rgpd FROM uf WHERE id = ?',
      [ufId]
    );
    const uf = ufs[0];
    if (!uf) {
      return res.status(404).json({ status: 'error', message: 'Unite de formation introuvable.' });
    }

    // Denominateur commun a tous les etudiants : le nombre de seances
    // TERMINEES de l'UF. Compte une seule fois, pas par etudiant.
    const [compteurs] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(${SQL_TERMINEE}) AS terminees,
              MIN(s.heure_debut_prevue) AS premiere,
              MAX(s.heure_fin_prevue) AS derniere
       FROM seances s WHERE s.uf_id = ?`,
      [ufId]
    );
    const seancesTerminees = Number(compteurs[0].terminees ?? 0);
    const seancesTotal = Number(compteurs[0].total ?? 0);

    // Une seance non terminee rend le bilan provisoire, exactement comme au
    // niveau de la seance : le total peut encore augmenter.
    const provisoire = seancesTerminees < seancesTotal;

    const [lignes] = await pool.query(
      `SELECT e.id AS etudiant_id, e.nom, e.email,
              -- Presences comptees UNIQUEMENT sur les seances terminees, pour
              -- rester coherent avec le denominateur.
              COUNT(p.id) AS presences,
              -- COALESCE : un etudiant sans aucune presence doit afficher 0,
              -- pas NULL -- une case vide dans une colonne d'heures se lit
              -- comme une donnee manquante, pas comme une absence totale.
              COALESCE(SUM(TIMESTAMPDIFF(MINUTE, p.heure_arrivee, ${SQL_FIN_RETENUE})), 0)
                AS minutes_validees,
              SUM(CASE WHEN p.id IS NOT NULL AND p.heure_depart IS NULL THEN 1 ELSE 0 END)
                AS departs_deduits,
              (SELECT COUNT(*)
                 FROM demandes_rectification d
                 JOIN presences p2 ON p2.id = d.presence_id
                 JOIN seances s2 ON s2.id = p2.seance_id
                WHERE s2.uf_id = ? AND p2.etudiant_id = e.id AND d.statut = 'en_attente')
                AS demandes_en_attente
       FROM inscriptions i
       JOIN etudiants e ON e.id = i.etudiant_id
       -- Jointure externe vers les seances TERMINEES de l'UF puis vers les
       -- presences : l'etudiant reste dans le resultat meme s'il n'est jamais
       -- venu. C'est la meme lecon qu'a l'Etape 8 -- un bilan qui n'affiche
       -- que ceux qui sont venus ne repond pas a la question posee.
       LEFT JOIN seances s ON s.uf_id = i.uf_id AND ${SQL_TERMINEE}
       LEFT JOIN presences p ON p.seance_id = s.id AND p.etudiant_id = e.id
       WHERE i.uf_id = ?
       GROUP BY e.id, e.nom, e.email
       ORDER BY e.nom`,
      [ufId, ufId]
    );

    const etudiants = lignes.map((ligne) => {
      const presences = Number(ligne.presences);
      const minutes = Number(ligne.minutes_validees);
      return {
        etudiant_id: ligne.etudiant_id,
        nom: ligne.nom,
        email: ligne.email,
        seances_prevues: seancesTerminees,
        presences,
        absences: seancesTerminees - presences,
        minutes_validees: minutes,
        heures_validees: Math.floor(minutes / 60),
        departs_deduits: Number(ligne.departs_deduits),
        demandes_en_attente: Number(ligne.demandes_en_attente),
        // Taux calcule sur les SEANCES et non sur les minutes : c'est
        // l'unite dans laquelle un secretariat raisonne ("11 seances sur
        // 12"). Le detail horaire figure a cote pour qui veut l'autre
        // lecture. Division par zero evitee explicitement -- une UF dont
        // aucune seance n'est encore terminee produirait sinon NaN, qui
        // s'afficherait tel quel dans le tableau.
        taux_presence: seancesTerminees === 0
          ? null
          : Math.round((presences / seancesTerminees) * 100),
      };
    });

    const totalMinutes = etudiants.reduce((somme, e) => somme + e.minutes_validees, 0);

    return res.status(200).json({
      status: 'ok',
      uf: {
        id: uf.id,
        intitule: uf.intitule,
        date_cloture: uf.date_cloture,
        date_cloture_rgpd: uf.date_cloture_rgpd,
        cloturee_rgpd: uf.date_cloture_rgpd !== null,
      },
      synthese: {
        inscrits: etudiants.length,
        seances_total: seancesTotal,
        seances_terminees: seancesTerminees,
        premiere_seance: compteurs[0].premiere,
        derniere_seance: compteurs[0].derniere,
        minutes_validees_total: totalMinutes,
        provisoire,
        demandes_en_attente: etudiants.filter((e) => e.demandes_en_attente > 0).length,
      },
      etudiants,
    });
  } catch (error) {
    console.error('[ufController] Erreur GET rapport-global :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

module.exports = { rapportGlobal, SQL_TERMINEE };
