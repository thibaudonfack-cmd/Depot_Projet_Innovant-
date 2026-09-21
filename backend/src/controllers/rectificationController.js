// src/controllers/rectificationController.js
// Demandes de rectification (regle D) et modification manuelle des heures
// par le formateur (regle B), avec journal d'audit (regle E).

const crypto = require('crypto');
const pool = require('../config/db');
const { consigner } = require('../services/journalService');
const { formateurGereSeance, refuserHorsPerimetre } = require('../services/perimetreFormateur');

/** Fenetre laissee a l'etudiant apres la fin prevue de la seance. */
const FENETRE_HEURES = 24;

/**
 * Convertit une chaine ISO du client en SECONDES EPOCH, ou null.
 *
 * CORRECTION D'UN DEFAUT DE FUSEAU, decouvert en ecrivant la borne de
 * l'Etape 9. La version precedente renvoyait `toISOString().slice(0,19)`,
 * c'est-a-dire une horloge murale UTC, qui etait ensuite ecrite telle quelle
 * dans une colonne DATETIME. Or toutes les autres heures de la base
 * (heure_arrivee, heure_debut_prevue, NOW()) sont exprimees dans l'horloge du
 * SERVEUR. Deux horloges cohabitaient donc dans les memes colonnes.
 *
 * Consequences, invisibles tant qu'on ne comparait pas les deux familles :
 *   - une rectification acceptee decalait le depart de l'etudiant de
 *     l'offset UTC (2 h en ete a Bruxelles), silencieusement ;
 *   - une borne "depart <= fin prevue" comparait 12:40 (UTC) a 14:40
 *     (serveur) et rejetait un depart parfaitement legitime.
 *
 * Les secondes epoch n'ont, elles, aucune ambiguite : c'est un instant
 * absolu. La conversion vers une horloge murale est faite par MySQL via
 * FROM_UNIXTIME(), qui produit un DATETIME dans le fuseau de la session --
 * donc exactement la meme horloge que NOW() et que les colonnes existantes.
 * La regle generale du projet est ainsi respectee : le fuseau de la base
 * fait foi de bout en bout, et JavaScript ne convertit jamais lui-meme.
 */
function versInstantSql(valeur, nomChamp) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) throw new Error(`${nomChamp} n'est pas une date valide.`);
  return Math.floor(date.getTime() / 1000);
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
    arriveeDemandee = versInstantSql(arriveeBrute, 'heure_arrivee_demandee');
    departDemande = versInstantSql(departBrut, 'heure_depart_demandee');
  } catch (erreur) {
    return res.status(400).json({ status: 'error', message: erreur.message });
  }

  // ---------------------------------------------------------------------
  // L'HEURE D'ARRIVEE N'EST PAS CONTESTABLE PAR L'ETUDIANT.
  //
  // Elle n'est pas declarative : elle resulte d'un scan dont le jeton est
  // signe RS256 par le serveur et dont la possession est prouvee par une
  // signature ECDSA de l'appareil enrole. C'est la donnee la MIEUX etablie
  // de tout le systeme. Autoriser l'etudiant a la deplacer reviendrait a
  // laisser une declaration libre ecraser une preuve cryptographique -- et
  // viderait de son sens toute la chaine des Etapes 3 a 5.
  //
  // Le depart, lui, est legitimement contestable : il repose sur un SECOND
  // scan qui peut simplement avoir ete oublie en quittant la salle. C'est
  // une omission, pas une contestation de preuve.
  //
  // Le champ est en lecture seule cote interface, mais le refus est pose
  // ICI : un formulaire desactive ne protege de rien, il suffit d'appeler
  // l'API directement.
  if (arriveeDemandee) {
    return res.status(400).json({
      status: 'error',
      code: 'ARRIVEE_NON_CONTESTABLE',
      message: "L'heure d'arrivee resulte d'un scan signe et ne peut pas etre modifiee "
             + 'par une demande de rectification. Seule l\'heure de depart est contestable.',
    });
  }

  try {
    // La presence doit appartenir a l'etudiant CONNECTE. Sans ce filtre,
    // fournir l'identifiant de la presence d'un camarade permettrait de
    // soumettre une demande en son nom.
    const [presences] = await pool.query(
      `SELECT p.id, p.etudiant_id, u.date_cloture_rgpd,
              DATE_FORMAT(s.heure_fin_prevue, '%H:%i') AS fin_prevue_hhmm,
              -- Les DEUX bornes sont evaluees par MySQL, jamais en
              -- JavaScript : FROM_UNIXTIME place l'instant du client dans
              -- l'horloge de la base, la meme que celle des colonnes
              -- comparees. Comparer en JS reintroduirait le melange de
              -- fuseaux documente au-dessus de versInstantSql.
              (FROM_UNIXTIME(?) <= p.heure_arrivee) AS depart_avant_arrivee,
              (s.heure_fin_prevue IS NOT NULL AND FROM_UNIXTIME(?) > s.heure_fin_prevue)
                AS depart_apres_fin,
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
       JOIN uf u ON u.id = s.uf_id
       WHERE p.id = ? AND p.etudiant_id = ?`,
      [departDemande, departDemande, FENETRE_HEURES, presenceId, req.utilisateur.etudiant_id]
    );

    const presence = presences[0];
    if (!presence) {
      // 404 et non 403 : ne pas confirmer l'existence d'une presence
      // appartenant a quelqu'un d'autre.
      return res.status(404).json({ status: 'error', message: 'Presence introuvable.' });
    }

    // Une UF cloturee au titre du RGPD est FIGEE. Les elements du dossier
    // (position enregistree, trace des scans) ont ete detruits : statuer sur
    // une contestation sans eux serait statuer a l'aveugle. Le verrou est
    // DEDUIT de uf.date_cloture_rgpd plutot que duplique sur chaque presence,
    // pour qu'il n'existe qu'une seule source de verite.
    if (presence.date_cloture_rgpd !== null) {
      return res.status(409).json({
        status: 'error',
        code: 'UF_CLOTUREE',
        message: 'Cette unite de formation est cloturee. Les heures sont definitives.',
      });
    }

    if (presence.fenetre_ouverte !== 1) {
      return res.status(403).json({
        status: 'error',
        code: 'DELAI_EXPIRE',
        message: "Le signalement n'est possible qu'apres la fin de la seance, et pendant 24 heures.",
      });
    }

    // -------------------------------------------------------------------
    // BORNES DU DEPART DEMANDE
    //
    // Comparaison de CHAINES 'YYYY-MM-DD HH:MM:SS', volontairement : les
    // deux bornes viennent de la base via DATE_FORMAT, et versDatetimeUtc
    // produit le meme format. Passer par des objets Date reintroduirait la
    // conversion de fuseau qui a deja fausse des comparaisons ailleurs dans
    // ce projet (cf. ANALYSE_CODE.md, mysql2 et les DATETIME). En format
    // ISO a longueur fixe, l'ordre lexicographique EST l'ordre chronologique.
    // -------------------------------------------------------------------
    if (departDemande) {
      // a) Le depart ne peut pas preceder l'arrivee, qui fait foi.
      if (presence.depart_avant_arrivee === 1) {
        return res.status(400).json({
          status: 'error',
          code: 'DEPART_AVANT_ARRIVEE',
          message: "L'heure de depart demandee doit etre posterieure a l'heure d'arrivee.",
        });
      }

      // b) Le depart ne peut pas depasser la fin PREVUE de la seance.
      //
      // Sans cette borne, un etudiant parti a 10 h pourrait demander un
      // depart a 23 h et se voir crediter des heures qui n'ont jamais eu
      // lieu : la rectification deviendrait un moyen de fabriquer du temps
      // de formation, exactement ce que le systeme entier cherche a empecher.
      // La fenetre de 24 h rend d'ailleurs la manoeuvre naturelle, puisqu'elle
      // s'ouvre APRES la fin de la seance.
      if (presence.depart_apres_fin === 1) {
        return res.status(400).json({
          status: 'error',
          code: 'DEPART_APRES_FIN_SEANCE',
          message: "L'heure de depart demandee ne peut pas depasser l'heure de fin prevue "
                 + `de la seance (${presence.fin_prevue_hhmm}).`,
        });
      }
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
       VALUES (?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?))`,
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
              EXISTS (SELECT 1 FROM formateur_uf fu
                       WHERE fu.uf_id = s.uf_id AND fu.formateur_id = ?) AS autorise,
              DATE_FORMAT(d.heure_arrivee_demandee, '%Y-%m-%d %H:%i:%s') AS arrivee_demandee,
              DATE_FORMAT(d.heure_depart_demandee, '%Y-%m-%d %H:%i:%s') AS depart_demande,
              DATE_FORMAT(p.heure_arrivee, '%Y-%m-%d %H:%i:%s') AS arrivee_actuelle,
              DATE_FORMAT(p.heure_depart, '%Y-%m-%d %H:%i:%s') AS depart_actuel
       FROM demandes_rectification d
       JOIN presences p ON p.id = d.presence_id
       JOIN seances s ON s.id = p.seance_id
       WHERE d.id = ?
       FOR UPDATE`,
      [req.utilisateur.id, demandeId]
    );

    const demande = demandes[0];
    if (!demande) {
      await connexion.rollback();
      return res.status(404).json({ status: 'error', message: 'Demande introuvable.' });
    }
    // Trancher la demande d'un etudiant qu'on n'encadre pas reviendrait a
    // statuer sur un dossier dont on ignore le contexte -- et priverait le
    // formateur responsable de sa decision.
    if (demande.autorise !== 1) {
      await connexion.rollback();
      return refuserHorsPerimetre(res, 'Demande');
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
    nouveauDepart = versInstantSql(departBrut, 'heure_depart');
  } catch (erreur) {
    return res.status(400).json({ status: 'error', message: erreur.message });
  }

  const connexion = await pool.getConnection();
  try {
    await connexion.beginTransaction();

    // Meme precaution que ci-dessus : lecture en chaines, jamais en objets
    // Date, pour ne pas reintroduire de conversion de fuseau.
    const [presences] = await connexion.query(
      `SELECT p.id, s.id AS seance_id,
              EXISTS (SELECT 1 FROM formateur_uf fu
                       WHERE fu.uf_id = s.uf_id AND fu.formateur_id = ?) AS autorise,
              DATE_FORMAT(p.heure_arrivee, '%Y-%m-%d %H:%i:%s') AS heure_arrivee,
              DATE_FORMAT(p.heure_depart, '%Y-%m-%d %H:%i:%s') AS heure_depart,
              -- Valeur demandee, ramenee dans l'horloge de la base pour le
              -- journal d'audit ET pour la comparaison ci-dessous.
              DATE_FORMAT(FROM_UNIXTIME(?), '%Y-%m-%d %H:%i:%s') AS depart_demande_texte,
              (FROM_UNIXTIME(?) <= p.heure_arrivee) AS depart_avant_arrivee,
              u.date_cloture_rgpd
       FROM presences p
       JOIN seances s ON s.id = p.seance_id
       JOIN uf u ON u.id = s.uf_id
       WHERE p.id = ? FOR UPDATE`,
      [req.utilisateur.id, nouveauDepart, nouveauDepart, presenceId]
    );
    const presence = presences[0];
    if (!presence) {
      await connexion.rollback();
      return res.status(404).json({ status: 'error', message: 'Presence introuvable.' });
    }

    // Cloisonnement : modifier l'horaire d'un etudiant qu'on n'encadre pas
    // n'a aucun fondement, et serait invisible du formateur reellement
    // responsable.
    if (presence.autorise !== 1) {
      await connexion.rollback();
      return refuserHorsPerimetre(res, 'Presence');
    }

    // Le verrou de cloture s'applique AUSSI au formateur, et c'est voulu.
    // Une archive dont le detenteur peut encore modifier le contenu n'est pas
    // une archive. Passe cette date, seule une procedure administrative hors
    // application pourrait revenir sur les heures.
    if (presence.date_cloture_rgpd !== null) {
      await connexion.rollback();
      return res.status(409).json({
        status: 'error',
        code: 'UF_CLOTUREE',
        message: 'Cette unite de formation est cloturee. Les heures sont definitives '
               + 'et ne peuvent plus etre modifiees.',
      });
    }

    // Coherence des bornes verifiee ici EN PLUS de la contrainte CHECK du
    // schema : la contrainte protege l'integrite, ce controle donne un
    // message utilisable a l'utilisateur plutot qu'une erreur SQL brute.
    // La comparaison est faite PAR MYSQL (colonne depart_avant_arrivee
    // ci-dessus), pas en JavaScript : voir versInstantSql pour le defaut de
    // fuseau que cela evite.
    if (nouveauDepart && presence.depart_avant_arrivee === 1) {
      await connexion.rollback();
      return res.status(400).json({
        status: 'error',
        message: "L'heure de depart doit etre posterieure a l'heure d'arrivee.",
      });
    }

    await connexion.query(
      `UPDATE presences SET heure_depart = FROM_UNIXTIME(?),
              source = 'correction_formateur' WHERE id = ?`,
      [nouveauDepart, presenceId]
    );

    await consigner(connexion, {
      tableCible: 'presences', ligneId: presenceId, champ: 'heure_depart',
      // Le journal recoit une heure LISIBLE dans l'horloge de la base, pas
      // un timestamp epoch : une trace destinee a etre relue par un humain
      // cinq ans plus tard ne doit pas exiger une conversion.
      valeurAvant: presence.heure_depart, valeurApres: presence.depart_demande_texte,
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
  const { id: seanceId } = req.params;

  try {
    // Meme mandat exige que pour les presences : ces demandes contiennent le
    // motif redige librement par l'etudiant, souvent d'ordre personnel
    // (rendez-vous medical, situation familiale).
    const { existe, autorise } = await formateurGereSeance(pool, req.utilisateur.id, seanceId);
    if (!existe || !autorise) return refuserHorsPerimetre(res, 'Seance');

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
