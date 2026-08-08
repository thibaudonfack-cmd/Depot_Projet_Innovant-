// src/controllers/enrolementController.js
// RF-07 (enrolement cryptographique) / RF-09 (un seul appareil actif par
// etudiant) -- Etape 4.
//
// Nom retenu : "enrolement" (une seule consonne L, sans accent circonflexe)
// -- pas "enrollement" (orthographe anglicisee) comme ecrit dans la mission
// recue. Choix de coherence, pas de gout personnel : la table concernee,
// posee des l'Etape 1, s'appelle deja "appareils_enroles" (une seule L,
// cf. database/01-schema.sql, commentaire "RF-07 (enrolement
// cryptographique)"). Utiliser une orthographe differente pour le
// controller/la route aurait introduit une incoherence terminologique dans
// un projet qui doit pouvoir etre defendu mot pour mot devant un jury.
// Endpoint : POST /api/enrolements (pluriel, meme convention route<->action
// que /api/seances et /api/scans).
//
// Ce que cette route NE FAIT PAS (perimetre volontairement limite) :
// verifier que le client est reellement en possession de la cle privee
// correspondant a la cle publique envoyee (ex. via un defi-reponse signe).
// A ce stade, la route fait confiance a la cle publique fournie -- cette
// preuve de possession sera necessaire au moment ou une cle enrolee doit
// authentifier un scan (etape ulterieure, RF-07 complet), pas au moment de
// l'enrolement initial lui-meme (qui a lieu sur un appareil qui vient tout
// juste de generer sa propre paire, cf. CryptoService.js).
//
// PREUVE DE POSSESSION (challenge-response). L'enrolement se fait desormais
// en DEUX temps : le client demande un defi, le signe avec la cle privee
// qu'il vient de generer, et transmet signature et cle publique. Le serveur
// verifie la signature AVEC LA CLE PUBLIQUE SOUMISE -- c'est le point
// central : reussir cette verification n'est possible qu'en detenant la cle
// privee associee.
//
// Ce que cela ferme : soumettre la cle publique d'un tiers (elle est publique
// et se recupere aisement, mais signer exigerait sa cle privee), et rejouer
// un enrolement intercepte (le defi est a usage unique et expire).
//
// Ce que cela NE ferme PAS : enroler SON PROPRE appareil sous l'identite d'un
// autre etudiant apres avoir obtenu ses identifiants. L'attaquant genere sa
// paire et signe correctement -- la preuve de possession est satisfaite. Cet
// angle mort releve de l'authentification (Etape 7c) et de la friction
// documentee dans "Trois arguments pour la soutenance", pas du defi-reponse.
//
// ETAPE 7c : l'IDENTITE de l'etudiant est etablie.
// Elle provient de la session authentifiee, plus du corps de la requete --
// il n'est donc plus possible d'enroler son propre appareil sous
// l'identifiant d'un autre etudiant, ce qui etait jusqu'ici le contournement
// le plus direct de toute la chaine (documente comme angle mort a l'Etape 5).

/**
 * Nombre TOTAL d'associations d'appareil autorisees par etudiant.
 *
 * 2 = l'enrolement initial, plus UN changement d'appareil. Ce n'est pas un
 * chiffre arbitraire : il couvre le cas legitime le plus frequent (telephone
 * casse ou remplace pendant l'annee) tout en rendant le pret de compte
 * couteux. Un etudiant qui prete son compte consomme son unique credit de
 * rechange, et se retrouve durablement sans appareil valide.
 *
 * Au-dela, la reprise passe par une verification d'identite humaine au
 * secretariat -- ce qui est le but : reintroduire un cout qu'aucune mesure
 * technique ne peut imposer seule.
 */
const QUOTA_ENROLEMENTS_MAX = 2;

const crypto = require('crypto');
const pool = require('../config/db');
const {
  verifierSignatureAppareil,
  SignatureAppareilInvalideError,
} = require('../services/deviceSignatureService');

/** Duree de vie d'un defi. Court : il n'a de sens que le temps de l'echange. */
const DUREE_DEFI_SECONDES = 120;

/**
 * POST /api/enrolements/defi
 * Role etudiant. Emet un defi a signer.
 */
async function emettreDefi(req, res) {
  try {
    const defiId = crypto.randomUUID();
    // 32 octets aleatoires via randomBytes, jamais Math.random() : la valeur
    // doit etre impredictible, sans quoi un attaquant pourrait preparer une
    // signature a l'avance.
    const valeur = crypto.randomBytes(32).toString('hex');

    await pool.query(
      `INSERT INTO defis_enrolement (id, etudiant_id, valeur, date_expiration)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
      [defiId, req.utilisateur.etudiant_id, valeur, DUREE_DEFI_SECONDES]
    );

    return res.status(201).json({
      status: 'ok',
      defi: { id: defiId, valeur, duree_secondes: DUREE_DEFI_SECONDES },
    });
  } catch (error) {
    console.error('[enrolementController] Erreur POST /api/enrolements/defi :', error.message);
    return res.status(500).json({ status: 'error', message: 'Erreur serveur.' });
  }
}

/**
 * POST /api/enrolements
 * Corps attendu : { public_key, defi_id, signature_defi, device_info? }
 * Route PROTEGEE : exige une session authentifiee de role 'etudiant'.
 *
 * etudiant_id provient de req.utilisateur.etudiant_id (session), jamais du
 * corps de la requete -- cf. en-tete de ce fichier, Etape 7c.
 *
 * public_key est stockee TELLE QUELLE (colonne cle_publique, TEXT) --
 * attendue au format PEM (cf. CryptoService.js, exportPublicKey()), mais ce
 * controller ne valide pas activement le format a ce stade (pas de parsing
 * ASN.1/PEM cote backend) : une cle malformee serait simplement inutilisable
 * plus tard (au moment de verifier une signature), pas rejetee ici. A
 * durcir si necessaire dans une etape ulterieure.
 *
 * device_info (payload JSON, nom impose par la mission) correspond a la
 * colonne info_appareil (nom de colonne en francais, coherent avec le reste
 * du schema) -- meme type de correspondance nom-de-champ-API / nom-de-colonne
 * que session_id (jeton JWT) <-> seance_id (colonne scans.seance_id),
 * deja pratique depuis l'Etape 2/3 de ce projet.
 *
 * Regle metier RF-09 (un seul appareil ACTIF par etudiant) : implementee en
 * DEUX temps, dans une transaction UNIQUE (voir plus bas pourquoi la
 * transaction est necessaire, pas optionnelle) :
 *   1. UPDATE : tout appareil actif existant pour cet etudiant passe a
 *      'revoque' (jamais supprime -- piste d'audit conservee).
 *   2. INSERT : le nouvel appareil est enregistre avec statut='actif'.
 */
async function enrolerAppareil(req, res) {
  const {
    public_key: clePublique,
    device_info: infoAppareil,
    defi_id: defiId,
    signature_defi: signatureDefi,
  } = req.body || {};

  // Identite issue de la SESSION, jamais du client (cf. en-tete de fonction).
  const etudiantId = req.utilisateur.etudiant_id;

  if (!clePublique || !defiId || !signatureDefi) {
    return res.status(400).json({
      status: 'error',
      message: 'public_key, defi_id et signature_defi sont obligatoires.',
    });
  }

  const nouvelAppareilId = crypto.randomUUID();

  // Transaction OBLIGATOIRE ici, et non deux requetes independantes : la
  // colonne generee actif_key (01-schema.sql) et sa contrainte
  // UNIQUE KEY uq_appareil_actif interdisent que DEUX lignes 'actif'
  // coexistent pour le meme etudiant, ne serait-ce qu'un instant. Si
  // l'UPDATE de revocation et l'INSERT du nouvel appareil n'etaient pas
  // executes dans une transaction unique, une panne entre les deux
  // laisserait l'etudiant SANS AUCUN appareil actif (l'ancien revoque, le
  // nouveau jamais insere) -- un etat incoherent, silencieux, et difficile
  // a diagnostiquer. La transaction garantit que soit les deux operations
  // reussissent ensemble, soit aucune n'est appliquee (rollback).
  const connexion = await pool.getConnection();

  try {
    await connexion.beginTransaction();

    // --- PREUVE DE POSSESSION ---
    //
    // Consommation ATOMIQUE du defi : l'UPDATE ne reussit que si le defi
    // existe, appartient a cet etudiant, n'a pas expire et n'a jamais ete
    // consomme. Verifier par un SELECT puis marquer par un UPDATE ouvrirait
    // une fenetre de course pendant laquelle deux requetes simultanees
    // pourraient consommer le meme defi -- le rendant reutilisable, soit
    // exactement l'inverse du but recherche. affectedRows tranche sans
    // ambiguite.
    const [consommation] = await connexion.query(
      `UPDATE defis_enrolement
       SET date_consommation = NOW()
       WHERE id = ? AND etudiant_id = ?
         AND date_consommation IS NULL
         AND date_expiration > NOW()`,
      [defiId, etudiantId]
    );

    if (consommation.affectedRows !== 1) {
      await connexion.rollback();
      // Message unique pour les trois causes (inconnu, expire, deja
      // consomme) : les distinguer renseignerait un attaquant sur l'etat des
      // defis sans aucun benefice pour l'utilisateur legitime, qui n'a de
      // toute facon qu'une action a faire -- recommencer.
      return res.status(400).json({
        status: 'error',
        code: 'DEFI_INVALIDE',
        message: 'Defi invalide, expire ou deja utilise. Relancez l\'association de cet appareil.',
      });
    }

    const [defis] = await connexion.query(
      'SELECT valeur FROM defis_enrolement WHERE id = ?', [defiId]
    );

    try {
      // Verification avec la cle publique SOUMISE, et non une cle lue en base :
      // l'appareil n'est pas encore enrole, il n'y a rien a lire. C'est tout
      // l'interet du procede -- prouver que l'expediteur detient la cle privee
      // correspondant a la cle publique qu'il presente.
      verifierSignatureAppareil(defis[0].valeur, signatureDefi, clePublique);
    } catch (err) {
      await connexion.rollback();
      if (err instanceof SignatureAppareilInvalideError && err.code === 'CLE_ILLISIBLE') {
        return res.status(400).json({
          status: 'error',
          code: 'CLE_PUBLIQUE_INVALIDE',
          message: 'La cle publique transmise est illisible.',
        });
      }
      return res.status(401).json({
        status: 'error',
        code: 'PREUVE_POSSESSION_INVALIDE',
        message: "La signature du defi est invalide : cet appareil ne detient pas la cle privee correspondant a la cle publique transmise.",
      });
    }

    // -------------------------------------------------------------------
    // QUOTA D'ENROLEMENTS (Etape 11) -- le dernier verrou.
    //
    // Ce controle vient APRES la preuve de possession, deliberement. Refuser
    // avant de verifier la signature renseignerait un attaquant sur l'etat
    // d'un compte sans qu'il ait eu a prouver quoi que ce soit ; et surtout,
    // un quota consomme par une tentative non authentifiee permettrait de
    // BLOQUER le compte d'un camarade en epuisant son credit a sa place.
    //
    // INCREMENT CONDITIONNEL ATOMIQUE, jamais SELECT-puis-UPDATE. Deux
    // requetes simultanees liraient toutes deux "1", concluraient toutes deux
    // "autorise", et enroleraient deux appareils pour un seul credit : le
    // quota serait contournable en cliquant deux fois. Ici le moteur tranche,
    // et affectedRows dit sans ambiguite si le credit a ete consomme.
    //
    // C'est le meme raisonnement que pour la consommation du defi plus haut
    // et pour uq_scan_nonce : chaque fois qu'une ressource est CONSOMMEE,
    // c'est InnoDB qui doit arbitrer, pas le code applicatif.
    // -------------------------------------------------------------------
    const [quota] = await connexion.query(
      `UPDATE etudiants
          SET compteur_enrolements = compteur_enrolements + 1
        WHERE id = ? AND compteur_enrolements < ?`,
      [etudiantId, QUOTA_ENROLEMENTS_MAX]
    );

    if (quota.affectedRows !== 1) {
      await connexion.rollback();
      // 403 et non 429 : ce n'est pas une limitation de debit qu'une attente
      // leverait, c'est un refus definitif tant qu'un humain n'intervient
      // pas. Le message doit donc indiquer la SEULE issue reelle.
      return res.status(403).json({
        status: 'error',
        code: 'QUOTA_ENROLEMENT_ATTEINT',
        message: 'Vous avez atteint le nombre maximal d\'associations d\'appareil '
               + `(${QUOTA_ENROLEMENTS_MAX}). Contactez le secretariat pour faire `
               + 'reinitialiser ce compteur apres verification de votre identite.',
      });
    }

    const [resultatRevocation] = await connexion.query(
      `UPDATE appareils_enroles
       SET statut = 'revoque', date_revocation = CURRENT_TIMESTAMP
       WHERE etudiant_id = ? AND statut = 'actif'`,
      [etudiantId]
    );

    await connexion.query(
      `INSERT INTO appareils_enroles (id, etudiant_id, cle_publique, info_appareil, statut)
       VALUES (?, ?, ?, ?, 'actif')`,
      [nouvelAppareilId, etudiantId, clePublique, infoAppareil || null]
    );

    await connexion.commit();

    return res.status(201).json({
      status: 'ok',
      appareil_id: nouvelAppareilId,
      etudiant_id: etudiantId,
      statut: 'actif',
      // Indique explicitement au client si cet enrolement a remplace un
      // appareil precedent -- utile pour distinguer, cote UI, un premier
      // enrolement d'un ré-enrolement (ex. changement de telephone).
      appareil_precedent_revoque: resultatRevocation.affectedRows > 0,
    });
  } catch (error) {
    await connexion.rollback();

    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
      // etudiant_id ne correspond a aucune ligne existante (contrainte FK
      // fk_appareil_etudiant) -- meme raisonnement que seanceController.js
      // et scanController.js : erreur de saisie previsible, pas une panne.
      //
      // DEUX codes verifies, pas un seul -- decouvert empiriquement (pas
      // suppose) en testant ce controller contre un vrai MySQL : la MEME
      // violation de contrainte FOREIGN KEY est rapportee par MySQL sous
      // DEUX codes d'erreur differents selon le contexte transactionnel.
      // Hors transaction explicite (autocommit), MySQL renvoie
      // ER_NO_REFERENCED_ROW_2 (errno 1452, message detaille avec le nom de
      // la contrainte) -- c'est ce qu'on observe pour seanceController.js
      // et scanController.js, qui n'utilisent pas de transaction explicite.
      // DANS une transaction ouverte via connexion.beginTransaction() (le
      // cas ICI, necessaire pour la regle RF-09, cf. plus haut), MySQL
      // renvoie a la place ER_NO_REFERENCED_ROW (errno 1216, message plus
      // generique, sans le "_2"). Ne verifier que ER_NO_REFERENCED_ROW_2
      // ici aurait laisse ce cas retomber, a tort, dans la branche 500
      // generique ci-dessous -- un etudiant_id simplement invalide aurait
      // ete rapporte comme une panne serveur plutot qu'une erreur de saisie.
      return res.status(400).json({
        status: 'error',
        message: 'etudiant_id inconnu (aucune ligne correspondante en base).',
      });
    }

    console.error('[enrolementController] Erreur POST /api/enrolements :', error.message);
    return res.status(500).json({
      status: 'error',
      message: "Erreur serveur lors de l'enrolement de l'appareil.",
    });
  } finally {
    // Rendre la connexion au pool dans TOUS les cas (succes, erreur
    // metier, erreur inattendue) -- sans ce finally, une connexion prise
    // via getConnection() et jamais liberee finirait par epuiser le pool
    // (connectionLimit: 10, cf. src/config/db.js) apres suffisamment
    // d'enrolements en erreur.
    connexion.release();
  }
}

module.exports = { enrolerAppareil, emettreDefi, DUREE_DEFI_SECONDES, QUOTA_ENROLEMENTS_MAX };
