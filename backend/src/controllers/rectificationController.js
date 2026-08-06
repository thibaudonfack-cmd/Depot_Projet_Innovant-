// src/controllers/rectificationController.js
// Demandes de rectification (regle D) et modification manuelle des heures
// par le formateur (regle B), avec journal d'audit (regle E).

const crypto = require('crypto');
const pool = require('../config/db');
const { consigner } = require('../services/journalService');

/** Fenetre laissee a l'etudiant apres la fin prevue de la seance. */
const FENETRE_HEURES = 24;

/** Convertit une chaine ISO en DATETIME MySQL (UTC), ou null. */
function versDatetimeUtc(valeur, nomChamp) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) throw new Error(`${nomChamp} n'est pas une date valide.`);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * POST /api/rectifications
 * Corps : { presence_id, motif, heure_arrivee_demandee?, heure_depart_demandee? }
 * Role etudiant.
 *
 * LA FENETRE DE 24 H EST VERIFIEE ICI, cote serveur, contre l'horloge de la
 * BASE. Le controle equivalent cote navigateur n'est qu'un confort visuel :
 * il suffirait de changer l'heure de sa machine, ou d'appeler l'API
 * directement, pour le contourner. C'est cette verification-ci qui fait foi.
 */
async function soumettreRectification(req, res) {
  const {
    presence_id: presenceId,
    motif,
    heure_arrivee_demandee: arriveeBrute,
    heure_depart_demandee: departBrut,
  } = req.body || {};

  if (!presenceId || !motif || !motif.trim()) {
    return res.status(400).json({
      status: 'error',
      message: 'presence_id et motif sont obligatoires.',
    });
  }

  let arriveeDemandee;
  let departDemande;
  try {
    arriveeDemandee = versDatetimeUtc(arriveeBrute, 'heure_arrivee_demandee');
    departDemande = versDatetimeUtc(departBrut, 'heure_depart_demandee');
  } catch (erreur) {
    return res.status(400).json({ status: 'error', message: erreur.message });
  }

  if (arriveeDemandee && departDemande && departDemande <= arriveeDemandee) {
    return res.status(400).json({
      status: 'error',
      message: "L'heure de depart demandee doit etre posterieure a l'heure d'arrivee.",
    });
  }

  try {
    // La presence doit appartenir a l'etudiant CONNECTE. Sans ce filtre,
    // fournir l'identifiant de la presence d'un camarade permettrait de
    // soumettre une demande en son nom.
    const [presences] = await pool.query(
      `SELECT p.id, p.etudiant_id, s.heure_fin_prevue,
              -- MEME regle que dans presenceController : la fenetre s'ouvre
              -- a la FIN de la seance et se referme 24 h plus tard. Le
              -- controle cote lecture n'est qu'un confort d'affichage ; c'est
              -- celui-ci, a l'ecriture, qui fait foi.
              CASE
                WHEN s.heure_fin_prevue IS NULL THEN 0
                WHEN NOW() <= s.heure_fin_prevue THEN 0
                WHEN NOW() <= DATE_ADD(s.heure_fin_prevue, INTERVAL ? HOUR) THEN 1
                ELSE 0
              END AS fenetre_ouverte
       FROM presences p
       JOIN seances s ON s.id = p.seance_id
       WHERE p.id = ? AND p.etudiant_id = ?`,
      [FENETRE_HEURES, presenceId, req.utilisateur.etudiant_id]
    );

    const presence = presences[0];
    if (!presence) {
      // 404 et non 403 : ne pas confirmer l'existence d'une presence
      // appartenant a quelqu'un d'autre.
      return res.status(404).json({ status: 'error', message: 'Presence introuvable.' });
    }

    if (presence.fenetre_ouverte !== 1) {
      return res.status(403).json({
        status: 'error',
        code: 'DELAI_EXPIRE',
        message: "Le signalement n'est possible qu'apres la fin de la seance, et pendant 24 heures.",
      });
    }

    // Une seule demande en attente a la fois : sans ce controle, un etudiant
    // pourrait en empiler plusieurs et le formateur ne saurait laquelle
    // traiter.
    const [enAttente] = await pool.query(
      "SELECT id FROM demandes_rectification WHERE presence_id = ? AND statut = 'en_attente' LIMIT 1",
      [presenceId]
    );
    if (enAttente.length > 0) {
      return res.status(409).json({
        status: 'error',
        code: 'DEMANDE_DEJA_EN_ATTENTE',
        message: 'Une demande est deja en attente de traitement pour cette seance.',
      });
    }

    const demandeId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO demandes_rectification
         (id, presence_id, motif, heure_arrivee_demandee, heure_depart_demandee)
       VALUES (?, ?, ?, ?, ?)`,
      [demandeId, presenceId, motif.trim(), arriveeDemandee, departDemande]
    );

    return res.status(201).json({ status: 'ok', demande_id: demandeId, statut: 'en_attente' });
  } catch (error) {
    console.error('[rectificationController] Erreur POST :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

/**
 * PATCH /api/rectifications/:id
 * Corps : { decision: 'acceptee'|'refusee', motif_decision }
 * Role formateur.
 *
 * Accepter une demande applique les heures demandees a la presence ET
 * consigne la modification. Les deux dans la MEME transaction : une panne
 * entre les deux laisserait soit une heure modifiee sans trace, soit une
 * trace sans modification.
 */
async function traiterRectification(req, res) {
  const { id: demandeId } = req.params;
  const { decision, motif_decision: motifDecision } = req.body || {};

  if (!['acceptee', 'refusee'].includes(decision)) {
    return res.status(400).json({
      status: 'error',
      message: "decision doit valoir 'acceptee' ou 'refusee'.",
    });
  }
  // Motif OBLIGATOIRE dans les deux cas, y compris pour un refus : c'est ce
  // que l'etudiant pourra contester, et ce qu'une inspection lira.
  if (!motifDecision || !motifDecision.trim()) {
    return res.status(400).json({
      status: 'error',
      code: 'MOTIF_REQUIS',
      message: 'Un motif de decision est obligatoire.',
    });
  }

  const connexion = await pool.getConnection();
  try {
    await connexion.beginTransaction();

    // Les DATETIME sont lus SOUS FORME DE CHAINES (DATE_FORMAT) et non comme
    // objets Date. Raison decouverte a l'execution : mysql2 convertit une
    // colonne DATETIME en Date JavaScript en supposant le fuseau de la
    // connexion, puis la re-serialise dans ce meme fuseau a l'ecriture. Un
    // simple aller-retour d'une valeur INCHANGEE la decale donc de plusieurs
    // heures, ce qui a fait violer la contrainte chk_presence_bornes en
    // rendant l'arrivee posterieure au depart. Les chaines traversent sans
    // interpretation.
    const [demandes] = await connexion.query(
      `SELECT d.id, d.statut, d.presence_id,
              DATE_FORMAT(d.heure_arrivee_demandee, '%Y-%m-%d %H:%i:%s') AS arrivee_demandee,
              DATE_FORMAT(d.heure_depart_demandee, '%Y-%m-%d %H:%i:%s') AS depart_demande,
              DATE_FORMAT(p.heure_arrivee, '%Y-%m-%d %H:%i:%s') AS arrivee_actuelle,
              DATE_FORMAT(p.heure_depart, '%Y-%m-%d %H:%i:%s') AS depart_actuel
       FROM demandes_rectification d
       JOIN presences p ON p.id = d.presence_id
       WHERE d.id = ?
       FOR UPDATE`,
      [demandeId]
    );

    const demande = demandes[0];
    if (!demande) {
      await connexion.rollback();
      return res.status(404).json({ status: 'error', message: 'Demande introuvable.' });
    }
    if (demande.statut !== 'en_attente') {
      // FOR UPDATE plus haut : deux formateurs traitant la meme demande
      // simultanement, le second attend et constate qu'elle est deja tranchee.
      await connexion.rollback();
      return res.status(409).json({
        status: 'error',
        code: 'DEJA_TRAITEE',
        message: 'Cette demande a deja ete traitee.',
      });
    }

    await connexion.query(
      `UPDATE demandes_rectification
       SET statut = ?, date_decision = NOW(), decideur_id = ?, motif_decision = ?
       WHERE id = ?`,
      [decision, req.utilisateur.id, motifDecision.trim(), demandeId]
    );

    if (decision === 'acceptee') {
      const nouvelleArrivee = demande.arrivee_demandee ?? demande.arrivee_actuelle;
      const nouveauDepart = demande.depart_demande ?? demande.depart_actuel;

      // Coherence verifiee AVANT l'ecriture : la contrainte du schema
      // protegerait de toute facon l'integrite, mais elle produirait une
      // erreur 500 illisible la ou un 400 explicite renseigne le formateur.
      if (nouvelleArrivee && nouveauDepart && nouveauDepart <= nouvelleArrivee) {
        await connexion.rollback();
        return res.status(400).json({
          status: 'error',
          message: "Les heures demandees sont incoherentes : le depart precede l'arrivee.",
        });
      }

      // COALESCE : un champ non demande n'est PAS reecrit. Outre l'economie,
      // cela evite tout aller-retour d'une valeur inchangee a travers le
      // driver, source du decalage de fuseau decrit plus haut.
      await connexion.query(
        `UPDATE presences
         SET heure_arrivee = COALESCE(?, heure_arrivee),
             heure_depart = COALESCE(?, heure_depart),
             source = 'rectification_validee'
         WHERE id = ?`,
        [demande.arrivee_demandee, demande.depart_demande, demande.presence_id]
      );

      // Une entree de journal PAR CHAMP reellement modifie : consigner un
      // bloc global rendrait impossible de repondre a "qu'est-ce qui a
      // change exactement ?" lors d'un controle.
      for (const [champ, avant, apres] of [
        ['heure_arrivee', demande.arrivee_actuelle, nouvelleArrivee],
        ['heure_depart', demande.depart_actuel, nouveauDepart],
      ]) {
        if (String(avant) !== String(apres)) {
          await consigner(connexion, {
            tableCible: 'presences', ligneId: demande.presence_id, champ,
            valeurAvant: avant, valeurApres: apres,
            auteur: req.utilisateur, motif: motifDecision, origine: 'rectification',
          });
        }
      }
    }

    await connexion.commit();
    return res.status(200).json({ status: 'ok', demande_id: demandeId, statut: decision });
  } catch (error) {
    await connexion.rollback();
    console.error('[rectificationController] Erreur PATCH :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  } finally {
    connexion.release();
  }
}

/**
 * PUT /api/presences/:id
 * Corps : { heure_depart, motif }
 * Role formateur. Modification manuelle (depart anticipe, permission).
 */
async function modifierPresence(req, res) {
  const { id: presenceId } = req.params;
  const { heure_depart: departBrut, motif } = req.body || {};

  if (!motif || !motif.trim()) {
    return res.status(400).json({
      status: 'error',
      code: 'MOTIF_REQUIS',
      message: "Un motif est obligatoire pour toute modification manuelle d'une presence.",
    });
  }

  let nouveauDepart;
  try {
    nouveauDepart = versDatetimeUtc(departBrut, 'heure_depart');
  } catch (erreur) {
    return res.status(400).json({ status: 'error', message: erreur.message });
  }

  const connexion = await pool.getConnection();
  try {
    await connexion.beginTransaction();

    // Meme precaution que ci-dessus : lecture en chaines, jamais en objets
    // Date, pour ne pas reintroduire de conversion de fuseau.
    const [presences] = await connexion.query(
      `SELECT id,
              DATE_FORMAT(heure_arrivee, '%Y-%m-%d %H:%i:%s') AS heure_arrivee,
              DATE_FORMAT(heure_depart, '%Y-%m-%d %H:%i:%s') AS heure_depart
       FROM presences WHERE id = ? FOR UPDATE`,
      [presenceId]
    );
    const presence = presences[0];
    if (!presence) {
      await connexion.rollback();
      return res.status(404).json({ status: 'error', message: 'Presence introuvable.' });
    }

    // Coherence des bornes verifiee ici EN PLUS de la contrainte CHECK du
    // schema : la contrainte protege l'integrite, ce controle donne un
    // message utilisable a l'utilisateur plutot qu'une erreur SQL brute.
    // Comparaison de chaines au format '%Y-%m-%d %H:%i:%s' : lexicographique
    // et chronologique coincident, donc pas besoin de reconstruire des Date.
    if (nouveauDepart && nouveauDepart <= presence.heure_arrivee) {
      await connexion.rollback();
      return res.status(400).json({
        status: 'error',
        message: "L'heure de depart doit etre posterieure a l'heure d'arrivee.",
      });
    }

    await connexion.query(
      "UPDATE presences SET heure_depart = ?, source = 'correction_formateur' WHERE id = ?",
      [nouveauDepart, presenceId]
    );

    await consigner(connexion, {
      tableCible: 'presences', ligneId: presenceId, champ: 'heure_depart',
      valeurAvant: presence.heure_depart, valeurApres: nouveauDepart,
      auteur: req.utilisateur, motif, origine: 'formateur',
    });

    await connexion.commit();
    return res.status(200).json({ status: 'ok', presence_id: presenceId });
  } catch (error) {
    await connexion.rollback();
    console.error('[rectificationController] Erreur PUT presence :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  } finally {
    connexion.release();
  }
}

/** GET /api/seances/:id/rectifications - role formateur. */
async function listerRectificationsDeSeance(req, res) {
  try {
    const [lignes] = await pool.query(
      `SELECT d.id, d.motif, d.statut, d.date_soumission, d.motif_decision,
              d.heure_arrivee_demandee, d.heure_depart_demandee,
              p.id AS presence_id, p.heure_arrivee, p.heure_depart,
              e.nom AS etudiant_nom
       FROM demandes_rectification d
       JOIN presences p ON p.id = d.presence_id
       JOIN etudiants e ON e.id = p.etudiant_id
       WHERE p.seance_id = ?
       ORDER BY FIELD(d.statut, 'en_attente', 'acceptee', 'refusee'), d.date_soumission DESC`,
      [req.params.id]
    );
    return res.status(200).json({ status: 'ok', rectifications: lignes });
  } catch (error) {
    console.error('[rectificationController] Erreur GET :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

module.exports = {
  soumettreRectification,
  traiterRectification,
  modifierPresence,
  listerRectificationsDeSeance,
  FENETRE_HEURES,
};
