// src/controllers/seanceController.js
// RF-01 : ouverture d'une seance de pointage rattachee a une UF, une salle
// et un creneau horaire.
//
// Etape 7d : la route est desormais PROTEGEE et reservee au role formateur
// (cf. src/routes/seanceRoutes.js), et accepte les heures prevues du cours.

const crypto = require('crypto');
const pool = require('../config/db');
const { coordonneeValide, RAYON_TOLERANCE_DEFAUT_M } = require('../services/geofencingService');

/**
 * Normalise une heure recue du client vers le format DATETIME de MySQL.
 *
 * Le navigateur envoie une chaine ISO 8601 avec fuseau (par exemple
 * "2026-08-03T09:00:00.000Z"). MySQL attend "YYYY-MM-DD HH:MM:SS" et, en
 * colonne DATETIME, ne conserve AUCUN fuseau. On convertit donc
 * explicitement en UTC avant stockage, conformement a la convention du
 * projet : tout est conserve en UTC, la conversion vers l'heure locale se
 * fait a l'affichage. Passer la chaine ISO telle quelle a mysql2
 * fonctionnerait en apparence mais laisserait le fuseau de la connexion
 * decider du resultat, ce qui produirait des ecarts d'une heure selon
 * l'environnement -- redhibitoire des lors que ces heures serviront a
 * justifier des quotas.
 *
 * @returns {string|null} la valeur prete pour MySQL, ou null si absente
 * @throws {Error} si la valeur est fournie mais inexploitable
 */
function versDatetimeUtc(valeur, nomChamp) {
  if (valeur === undefined || valeur === null || valeur === '') return null;

  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${nomChamp} n'est pas une date valide.`);
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * POST /api/seances
 * Corps attendu : { uf_id, salle_id, heure_debut_prevue?, heure_fin_prevue? }
 * Route PROTEGEE : session authentifiee de role 'formateur'.
 *
 * L'identifiant de la seance est genere COTE APPLICATION (crypto.randomUUID),
 * pas laisse au DEFAULT (UUID()) du schema : mysql2 n'expose l'identifiant
 * genere par le serveur que via result.insertId, champ reserve aux colonnes
 * AUTO_INCREMENT et toujours vide pour une cle produite par une expression
 * par defaut. Sans generation applicative, il faudrait une requete de
 * lecture supplementaire pour retourner l'id, elle-meme fragile en cas
 * d'insertions concurrentes.
 */
async function creerSeance(req, res) {
  const {
    uf_id: ufId,
    salle_id: salleId,
    heure_debut_prevue: heureDebutBrute,
    heure_fin_prevue: heureFinBrute,
    latitude,
    longitude,
  } = req.body || {};

  if (!ufId || !salleId) {
    return res.status(400).json({
      status: 'error',
      message: 'uf_id et salle_id sont obligatoires.',
    });
  }

  let heureDebut;
  let heureFin;
  try {
    heureDebut = versDatetimeUtc(heureDebutBrute, 'heure_debut_prevue');
    heureFin = versDatetimeUtc(heureFinBrute, 'heure_fin_prevue');
  } catch (erreur) {
    return res.status(400).json({ status: 'error', message: erreur.message });
  }

  // Coherence des bornes, verifiee AVANT toute ecriture. Une seance dont la
  // fin precede le debut produirait plus tard une duree negative dans les
  // cumuls d'heures : mieux vaut la refuser a la source que d'avoir a la
  // rattraper par une correction manuelle.
  if (heureDebut && heureFin && heureFin <= heureDebut) {
    return res.status(400).json({
      status: 'error',
      message: "L'heure de fin doit etre posterieure a l'heure de debut.",
    });
  }

  // Position de reference du geofencing. FACULTATIVE : si le formateur refuse
  // le partage de position, ou si son appareil n'a pas de GPS, la seance est
  // creee normalement -- simplement sans reference. Refuser la creation dans
  // ce cas rendrait le systeme inutilisable pour un motif secondaire.
  const latRef = Number(latitude);
  const lonRef = Number(longitude);
  const referenceUtilisable = coordonneeValide(latRef, lonRef);

  const seanceId = crypto.randomUUID();

  try {
    await pool.query(
      `INSERT INTO seances
         (id, uf_id, salle_id, heure_debut_prevue, heure_fin_prevue,
          latitude_reference, longitude_reference, rayon_tolerance_m)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seanceId, ufId, salleId, heureDebut, heureFin,
        referenceUtilisable ? latRef : null,
        referenceUtilisable ? lonRef : null,
        referenceUtilisable ? RAYON_TOLERANCE_DEFAUT_M : null,
      ]
    );

    // Relecture plutot que reconstruction a la main de l'objet renvoye : les
    // valeurs par defaut (statut, date_ouverture) sont posees par le schema,
    // et les recopier ici les dupliquerait a deux endroits qui pourraient
    // diverger. Le client recoit ainsi exactement ce qui est en base.
    const [lignes] = await pool.query(
      `SELECT id, uf_id, salle_id, statut, date_ouverture,
              heure_debut_prevue, heure_fin_prevue,
              latitude_reference, longitude_reference, rayon_tolerance_m
       FROM seances WHERE id = ?`,
      [seanceId]
    );

    return res.status(201).json({
      status: 'ok',
      seance: lignes[0],
      // Signale explicitement au client que la seance fonctionnera sans
      // verification geographique, pour qu'il puisse en informer le formateur
      // plutot que de le laisser croire a une protection qui n'existe pas.
      geofencing_actif: referenceUtilisable,
    });
  } catch (error) {
    // ER_NO_REFERENCED_ROW_2 hors transaction, ER_NO_REFERENCED_ROW dans une
    // transaction : MySQL rapporte la meme violation de cle etrangere sous
    // deux codes selon le contexte (constate a l'Etape 4).
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
      return res.status(400).json({
        status: 'error',
        message: 'uf_id ou salle_id inconnu (aucune ligne correspondante en base).',
      });
    }

    console.error('[seanceController] Erreur POST /api/seances :', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Erreur serveur lors de la creation de la seance.',
    });
  }
}

module.exports = { creerSeance };
