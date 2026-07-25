// src/controllers/seanceController.js
// RF-01 : ouverture d'une seance de pointage rattachee a une UF, une salle et
// un creneau horaire.

const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

/**
 * POST /api/seances
 * Corps attendu : { uf_id: string, salle_id: string }
 *
 * L'identifiant de la seance est genere COTE APPLICATION (uuidv4()), pas
 * laisse au DEFAULT (UUID()) du schema SQL (01-schema.sql). Raison technique
 * precise : ce DEFAULT s'applique quand la colonne id est omise de l'INSERT,
 * mais mysql2 (comme tout driver MySQL) n'expose l'identifiant genere par le
 * serveur QUE via result.insertId -- un champ reserve aux colonnes
 * AUTO_INCREMENT, toujours vide pour une cle generee par une expression par
 * defaut comme UUID(). Sans generation cote application, il serait impossible
 * de retourner l'id de la seance creee dans la reponse HTTP sans une requete
 * de lecture supplementaire, elle-meme fragile en cas d'insertions
 * concurrentes. Generer le nonce du jeton (tokenService) et l'id de la
 * seance de la meme maniere (uuid v4 applicatif) est aussi plus coherent que
 * de melanger deux strategies de generation d'UUID dans le meme projet.
 */
async function creerSeance(req, res) {
  const { uf_id: ufId, salle_id: salleId } = req.body || {};

  if (!ufId || !salleId) {
    return res.status(400).json({
      status: 'error',
      message: 'uf_id et salle_id sont obligatoires.',
    });
  }

  const seanceId = uuidv4();

  try {
    await pool.query(
      'INSERT INTO seances (id, uf_id, salle_id) VALUES (?, ?, ?)',
      [seanceId, ufId, salleId]
    );

    // statut ('ouverte') et date_ouverture (CURRENT_TIMESTAMP) sont remplis
    // par les DEFAULT du schema (01-schema.sql) -- pas besoin de les fournir.
    return res.status(201).json({
      status: 'ok',
      seance_id: seanceId,
      uf_id: ufId,
      salle_id: salleId,
      statut: 'ouverte',
    });
  } catch (error) {
    // ER_NO_REFERENCED_ROW_2 : uf_id ou salle_id ne correspond a aucune ligne
    // existante (violation de contrainte FOREIGN KEY). C'est une erreur de
    // *saisie* previsible (mauvais identifiant fourni par le client), pas une
    // panne serveur : elle merite un 400, pas un 500 generique qui masquerait
    // la cause reelle.
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({
        status: 'error',
        message: 'uf_id ou salle_id inconnu (aucune ligne correspondante en base).',
      });
    }

    console.error('Erreur POST /api/seances :', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Erreur serveur lors de la creation de la seance.',
    });
  }
}

module.exports = { creerSeance };
