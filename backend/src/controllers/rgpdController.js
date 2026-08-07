// src/controllers/rgpdController.js
// Cloture d'une unite de formation et minimisation des donnees (Etape 9).
//
// =========================================================================
// CE QUI EST DETRUIT, ET POURQUOI CE N'EST PAS CE QU'ON CROIT
// =========================================================================
//
// Le cahier des charges initial demandait de purger "les signatures
// cryptographiques et les logs geolocalises de la table scans". La
// cartographie reelle du schema contredit cette formulation, et l'appliquer
// telle quelle aurait produit l'inverse de l'effet recherche :
//
//   - La table scans contient : id, seance_id, etudiant_id, jti, resultat,
//     motif_rejet, horodatage. AUCUNE coordonnee, AUCUNE signature.
//   - Les coordonnees GPS sont dans PRESENCES : latitude_scan,
//     longitude_scan, precision_m, distance_m, position_coherente.
//   - Les signatures d'appareil ne sont stockees NULLE PART : elles sont
//     verifiees a la volee puis jetees (cf. deviceSignatureService.js).
//     Seule la cle PUBLIQUE de l'appareil subsiste, dans appareils_enroles.
//
// Purger scans en preservant presences aurait donc laisse intactes les
// donnees de localisation -- la categorie la PLUS sensible du systeme, et
// la seule qui justifie vraiment une minimisation. La cloture porte donc sur
// les deux tables, en ciblant ce qui s'y trouve reellement.
//
// =========================================================================
// LA REGLE DE PARTAGE
// =========================================================================
//
// Une donnee est conservee si, et seulement si, elle sert encore la finalite
// administrative (prouver le temps de formation suivi). Tout le reste
// disparait, quelle que soit son utilite technique passee.
//
//   DETRUIT -- utile pendant la seance, sans objet ensuite
//     presences.latitude_scan / longitude_scan   ou se trouvait la personne
//     presences.precision_m / distance_m          idem, derive
//     presences.position_coherente                verdict de geofencing
//     scans.jti                                   lien vers le jeton reel
//
//   CONSERVE 5 ANS -- obligation de conservation administrative
//     presences.etudiant_id / heure_arrivee / heure_depart
//     scans (les LIGNES, anonymisees)             preuve du nombre de scans
//     db_attestations.journal_modifications       trace des corrections
//
// La localisation repondait a une question ponctuelle : "cette personne
// etait-elle dans la salle a cet instant ?". Une fois la seance terminee et
// le delai de contestation expire, cette question ne se posera plus jamais.
// La conserver cinq ans constituerait un historique de deplacements sans
// finalite -- exactement ce que l'article 5.1.c interdit.
//
// =========================================================================
// POURQUOI ANONYMISER PLUTOT QUE SUPPRIMER
// =========================================================================
//
// Les lignes de scans ne sont PAS supprimees : leur jti est remplace par une
// valeur derivee de leur propre identifiant. Le nombre de scans reste ainsi
// verifiable -- on peut toujours prouver qu'un etudiant a scanne deux fois,
// donc qu'il a pointe son depart -- alors que le lien avec le jeton reel a
// disparu. Supprimer les lignes detruirait aussi la preuve que la presence
// repose sur des scans, et non sur une saisie manuelle : on affaiblirait
// l'archive administrative au nom de sa protection.
//
// L'operation utilise un POOL SEPARE (dbRgpd.js) : l'utilisateur applicatif
// ordinaire n'a ni UPDATE ni DELETE sur scans, et cela doit le rester.

const poolRgpd = require('../config/dbRgpd');
const { consigner } = require('../services/journalService');
const { refuserHorsPerimetre } = require('../services/perimetreFormateur');

/**
 * POST /api/uf/:id/cloture-rgpd
 * Role formateur. IRREVERSIBLE.
 */
async function cloturerUf(req, res) {
  const { id: ufId } = req.params;
  const { confirmation } = req.body || {};

  // Confirmation EXPLICITE dans le corps de la requete, en plus de la modale
  // cote interface. Une modale ne protege que d'un clic distrait ; elle ne
  // protege pas d'un appel direct a l'API, ni d'un lien clique depuis un
  // autre site. Exiger une chaine precise garantit que l'intention a
  // traverse tout le chemin jusqu'ici.
  if (confirmation !== 'CLOTURER') {
    return res.status(400).json({
      status: 'error',
      code: 'CONFIRMATION_MANQUANTE',
      message: 'La cloture RGPD est irreversible et exige confirmation: "CLOTURER".',
    });
  }

  const connexion = await poolRgpd.getConnection();
  try {
    await connexion.beginTransaction();

    // FOR UPDATE : verrouille la ligne d'UF le temps de la transaction. Deux
    // clotures simultanees ne peuvent pas lire toutes deux "non cloturee",
    // ce qui produirait deux entrees au journal d'audit pour une seule
    // destruction reelle.
    const [ufs] = await connexion.query(
      `SELECT u.id, u.intitule, u.date_cloture_rgpd,
              EXISTS (SELECT 1 FROM formateur_uf fu
                       WHERE fu.uf_id = u.id AND fu.formateur_id = ?) AS autorise
         FROM uf u WHERE u.id = ? FOR UPDATE`,
      [req.utilisateur.id, ufId]
    );
    const uf = ufs[0];

    if (!uf) {
      await connexion.rollback();
      return res.status(404).json({ status: 'error', message: 'Unite de formation introuvable.' });
    }

    // CLOISONNEMENT. Detruire irreversiblement les donnees d'une UF qu'on
    // n'encadre pas serait la pire consequence possible d'une faille de
    // cloisonnement : elle ne se repare pas.
    if (uf.autorise !== 1) {
      await connexion.rollback();
      return refuserHorsPerimetre(res, 'Unite de formation');
    }

    // Idempotence : une UF deja cloturee n'est pas re-purgee. 409 et non 200,
    // pour que l'interface distingue "c'est fait" de "je viens de le faire".
    if (uf.date_cloture_rgpd !== null) {
      await connexion.rollback();
      return res.status(409).json({
        status: 'error',
        code: 'DEJA_CLOTUREE',
        message: 'Cette unite de formation a deja ete cloturee.',
        date_cloture_rgpd: uf.date_cloture_rgpd,
      });
    }

    // REFUS SI UNE CONTESTATION EST PENDANTE.
    //
    // Purger avant d'avoir tranche priverait le formateur des elements sur
    // lesquels statuer -- la position enregistree fait partie du dossier --
    // et l'etudiant se verrait opposer une decision fondee sur des donnees
    // detruites entre-temps. Le droit a la minimisation ne prime pas sur le
    // droit d'etre entendu.
    const [enAttente] = await connexion.query(
      `SELECT COUNT(*) AS n
         FROM demandes_rectification d
         JOIN presences p ON p.id = d.presence_id
         JOIN seances s ON s.id = p.seance_id
        WHERE s.uf_id = ? AND d.statut = 'en_attente'`,
      [ufId]
    );
    if (enAttente[0].n > 0) {
      await connexion.rollback();
      return res.status(409).json({
        status: 'error',
        code: 'DEMANDES_EN_ATTENTE',
        message: `${enAttente[0].n} demande(s) de rectification sont encore en attente. `
               + 'Traitez-les avant de cloturer : la cloture detruit les elements du dossier.',
      });
    }

    // Compte AVANT destruction, pour pouvoir consigner ce qui a ete detruit.
    // Apres l'UPDATE, l'information n'existe plus par definition.
    const [avant] = await connexion.query(
      `SELECT
         (SELECT COUNT(*) FROM scans sc JOIN seances s ON s.id = sc.seance_id
           WHERE s.uf_id = ?) AS scans,
         (SELECT COUNT(*) FROM presences p JOIN seances s ON s.id = p.seance_id
           WHERE s.uf_id = ? AND p.latitude_scan IS NOT NULL) AS positions`,
      [ufId, ufId]
    );

    // --- 1. Destruction des donnees de localisation -----------------------
    const [purgePositions] = await connexion.query(
      `UPDATE presences p
          JOIN seances s ON s.id = p.seance_id
          SET p.latitude_scan = NULL, p.longitude_scan = NULL,
              p.precision_m = NULL, p.distance_m = NULL,
              p.position_coherente = NULL
        WHERE s.uf_id = ?`,
      [ufId]
    );

    // --- 2. Anonymisation de la trace cryptographique ---------------------
    //
    // CONCAT('purge:', sc.id) et non une constante : uq_scan_nonce porte sur
    // (jti, etudiant_id), et un etudiant ayant scanne deux fois dans la meme
    // seance produirait deux lignes identiques -- la contrainte rejetterait
    // la purge, precisement pour les etudiants ayant correctement pointe leur
    // depart. La valeur reste unique tout en n'ayant plus aucun lien avec le
    // jeton d'origine.
    const [purgeScans] = await connexion.query(
      `UPDATE scans sc
          JOIN seances s ON s.id = sc.seance_id
          SET sc.jti = CONCAT('purge:', sc.id)
        WHERE s.uf_id = ?`,
      [ufId]
    );

    // --- 3. Verrouillage ---------------------------------------------------
    await connexion.query(
      'UPDATE uf SET date_cloture_rgpd = NOW() WHERE id = ?',
      [ufId]
    );

    // --- 4. Trace d'audit ---------------------------------------------------
    //
    // Consignee dans la MEME transaction : une destruction sans trace serait
    // indefendable devant une inspection, et une trace ecrite hors
    // transaction pourrait survivre a une purge annulee (ou l'inverse).
    await consigner(connexion, {
      tableCible: 'uf',
      ligneId: ufId,
      champ: 'date_cloture_rgpd',
      valeurAvant: null,
      valeurApres: `cloture RGPD : ${purgePositions.affectedRows} presence(s) traitee(s), `
                 + `${avant[0].positions} position(s) detruite(s), `
                 + `${purgeScans.affectedRows} scan(s) anonymise(s)`,
      auteur: req.utilisateur,
      motif: `Cloture RGPD de l'UF "${uf.intitule}" : minimisation des donnees `
           + '(art. 5.1.c). Localisation et trace cryptographique detruites ; '
           + 'archive administrative conservee 5 ans.',
      origine: 'systeme',
    });

    await connexion.commit();

    return res.status(200).json({
      status: 'ok',
      uf_id: ufId,
      intitule: uf.intitule,
      detruit: {
        positions: avant[0].positions,
        scans_anonymises: purgeScans.affectedRows,
        presences_traitees: purgePositions.affectedRows,
      },
      conserve: {
        message: 'Identite, heures d\'arrivee et de depart, et journal des '
               + 'modifications : conserves cinq ans au titre de l\'obligation '
               + 'de conservation administrative.',
      },
    });
  } catch (error) {
    await connexion.rollback();
    console.error('[rgpdController] Erreur cloture RGPD :', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Erreur serveur lors de la cloture. Aucune donnee n\'a ete detruite.',
    });
  } finally {
    connexion.release();
  }
}

module.exports = { cloturerUf };
