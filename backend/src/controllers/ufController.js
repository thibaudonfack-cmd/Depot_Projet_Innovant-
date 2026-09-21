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
const { formateurGereUf, refuserHorsPerimetre } = require('../services/perimetreFormateur');
// AUDIT (Etape 11) : ces deux expressions etaient RECOPIEES ici, mot pour
// mot, depuis presenceController. La regle "une seance est terminee" existait
// donc en deux exemplaires -- et une modification de l'une aurait laisse
// l'autre en place sans qu'aucun test ne le signale, puisque les deux
// auraient continue de fonctionner, chacune a sa facon. Le bilan d'UF et le
// rapport de seance auraient alors compte differemment les memes seances.
//
// presenceController reste la source unique : c'est lui qui porte la
// definition du cycle de vie d'une seance, et rapportController s'y
// referait deja.
const { SQL_SEANCE_TERMINEE: SQL_TERMINEE, SQL_FIN_RETENUE } = require('./presenceController');

/**
 * GET /api/uf/:id/rapport-global
 * Role formateur. Bilan d'assiduite cumule sur toute l'unite de formation.
 */
async function rapportGlobal(req, res) {
  const { id: ufId } = req.params;

  try {
    // CLOISONNEMENT. Un bilan expose les heures de TOUS les inscrits : c'est
    // la route la plus sensible du role formateur, et donc celle ou le
    // mandat doit etre verifie en premier.
    if (!(await formateurGereUf(pool, req.utilisateur.id, ufId))) {
      return refuserHorsPerimetre(res, 'Unite de formation');
    }

    const [ufs] = await pool.query(
      `SELECT id, intitule, date_cloture, date_cloture_rgpd, volume_horaire_minutes
         FROM uf WHERE id = ?`,
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
              -- Volume horaire REELLEMENT programme et deja ecoule. C'est le
              -- denominateur honnete du taux : rapporter le temps de
              -- presence au volume officiel de l'UF donnerait 20 % a un
              -- etudiant assidu en milieu de semestre, ce qui affolerait
              -- inutilement le secretariat.
              COALESCE(SUM(CASE WHEN ${SQL_TERMINEE}
                THEN TIMESTAMPDIFF(MINUTE, s.heure_debut_prevue, s.heure_fin_prevue)
                END), 0) AS minutes_prevues,
              MIN(s.heure_debut_prevue) AS premiere,
              MAX(s.heure_fin_prevue) AS derniere
       FROM seances s WHERE s.uf_id = ?`,
      [ufId]
    );
    const seancesTerminees = Number(compteurs[0].terminees ?? 0);
    const seancesTotal = Number(compteurs[0].total ?? 0);
    const minutesPrevues = Number(compteurs[0].minutes_prevues ?? 0);

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
        // KPI (Etape 10) : le ratio temps effectif / temps prevu. C'est la
        // grandeur sur laquelle une validation d'UF se decide, et elle ne se
        // deduit pas du nombre de seances -- un etudiant present a toutes
        // les seances mais reparti au bout d'une heure a 100 % de presences
        // et bien moins de 100 % de temps.
        minutes_prevues: minutesPrevues,
        heures_validees: Math.floor(minutes / 60),
        departs_deduits: Number(ligne.departs_deduits),
        demandes_en_attente: Number(ligne.demandes_en_attente),
        // Taux calcule sur les SEANCES et non sur les minutes : c'est
        // l'unite dans laquelle un secretariat raisonne ("11 seances sur
        // 12"). Le detail horaire figure a cote pour qui veut l'autre
        // lecture. Division par zero evitee explicitement -- une UF dont
        // aucune seance n'est encore terminee produirait sinon NaN, qui
        // s'afficherait tel quel dans le tableau.
        // DEUX taux, qui repondent a deux questions differentes et qu'il
        // serait trompeur de confondre :
        //   - taux_presence  : "a combien de seances est-il venu ?"
        //   - taux_temps     : "quelle part du volume horaire a-t-il suivi ?"
        // Le second est celui qui conditionne la certification ; le premier
        // reste utile pour reperer un decrochage.
        taux_presence: seancesTerminees === 0
          ? null
          : Math.round((presences / seancesTerminees) * 100),
        taux_temps: minutesPrevues === 0
          ? null
          // Plafonne a 100 et arrondi au dixieme : un depassement afficherait
          // sinon 104 %, ce qui ferait douter de tout le tableau.
          : Math.min(100, Math.round((minutes / minutesPrevues) * 1000) / 10),
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
        minutes_prevues: minutesPrevues,
        // Volume officiel inscrit au dossier pedagogique, distinct de ce qui
        // a ete programme. Affiche a titre de reference, jamais utilise comme
        // denominateur en cours de semestre.
        volume_horaire_minutes: uf.volume_horaire_minutes,
        taux_temps_moyen: minutesPrevues === 0 || etudiants.length === 0
          ? null
          : Math.min(100, Math.round(
            (totalMinutes / (minutesPrevues * etudiants.length)) * 1000) / 10),
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

// SQL_TERMINEE n'est plus reexporte : personne ne l'importait, et le
// reexporter depuis ce module suggerait a tort qu'il en etait l'origine.
module.exports = { rapportGlobal };
