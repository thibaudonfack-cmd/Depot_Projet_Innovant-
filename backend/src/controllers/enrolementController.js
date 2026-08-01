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
// ETAPE 7c : en revanche, l'IDENTITE de l'etudiant est desormais etablie.
// Elle provient de la session authentifiee, plus du corps de la requete --
// il n'est donc plus possible d'enroler son propre appareil sous
// l'identifiant d'un autre etudiant, ce qui etait jusqu'ici le contournement
// le plus direct de toute la chaine (documente comme angle mort a l'Etape 5).

const crypto = require('crypto');
const pool = require('../config/db');

/**
 * POST /api/enrolements
 * Corps attendu : { public_key: string, device_info?: string }
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
  const { public_key: clePublique, device_info: infoAppareil } = req.body || {};

  // Identite issue de la SESSION, jamais du client (cf. en-tete de fonction).
  const etudiantId = req.utilisateur.etudiant_id;

  if (!clePublique) {
    return res.status(400).json({
      status: 'error',
      message: 'public_key est obligatoire.',
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

module.exports = { enrolerAppareil };
