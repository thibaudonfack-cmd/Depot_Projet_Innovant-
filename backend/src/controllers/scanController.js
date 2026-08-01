// src/controllers/scanController.js
// RF-12 : cascade de validation d'un scan etudiant (Etape 3).
//
// Endpoint : POST /api/scans (et non /api/scan comme ecrit litteralement
// dans la mission de l'Etape 3) -- choix delibere de coherence avec la
// convention REST deja en place dans ce projet : POST /api/seances cree une
// ligne dans la table seances, POST /api/scans cree une ligne dans la table
// scans (meme correspondance route <-> table que seanceController.js).
// C'etait deja le nom retenu dans la feuille de route notee a la fin de
// l'Etape 2 (ANALYSE_CODE.md, "Prochaine etape suggeree"). Ecart signale et
// justifie dans ANALYSE_CODE.md, section Etape 3, plutot que suivi
// silencieusement ou laisse incoherent avec /api/seances.
//
// Cascade STRICTE (Etapes 3 puis 5) :
//   a) Signature RS256 du JETON (verificationService.js, cle publique du
//      SERVEUR)                                   -- le jeton vient bien de nous
//   b) Expiration (exp, TTL 25s)                  -- ferme V1 (partage differe)
//   c) Signature ECDSA de l'APPAREIL (deviceSignatureService.js, cle
//      publique de l'APPAREIL lue en base)        -- ferme l'usurpation et
//      le relais par un tiers non enrole (Etape 5, RF-07 complet)
//   d) Unicite du nonce (jti, etudiant_id)        -- ferme V4 (rejeu crypto)
//   e) Unicite de la presence (seance_id, etudiant_id) -- regle METIER
//      (un etudiant, une presence par seance, meme avec plusieurs jetons
//      DIFFERENTS tous individuellement valides -- cf. ANALYSE_CODE.md,
//      section Etape 3, "Regle metier d'unicite de presence" pour la
//      distinction complete avec d).
//
// ORDRE : ECART ASSUME PAR RAPPORT A L'ENONCE DE L'ETAPE 5.
// La mission demandait d'ajouter la verification de signature d'appareil
// "juste apres avoir valide l'authenticite du JWT et son expiration/nonce".
// Prise au pied de la lettre, cette formulation placerait c) APRES d)/e) --
// c'est-a-dire APRES l'INSERT, puisque le controle du nonce EST l'INSERT
// (cf. plus bas). Ce serait une faille : un jeton valide presente SANS
// signature d'appareil valide aurait alors deja consomme le nonce et cree
// une ligne de presence en base avant d'etre rejete. L'attaquant echouerait
// a se faire pointer, mais aurait au passage detruit la possibilite pour le
// VRAI etudiant d'utiliser ce meme jeton (nonce consomme) -- un deni de
// service trivial. La verification de signature est donc placee AVANT toute
// ecriture, conformement au principe applique depuis le debut du projet :
// aucun effet de bord persistant tant que toutes les validations ne sont
// pas franchies.
//
// c) ET d) sont TOUTES DEUX implementees en laissant l'INSERT echouer sur
// la contrainte UNIQUE correspondante de la table scans (01-schema.sql),
// jamais par un SELECT prealable ("ce jti/cette presence existe-t-il deja ?")
// suivi d'un INSERT conditionnel. Un SELECT-puis-INSERT applicatif ouvrirait
// une fenetre de course dans les DEUX cas : deux requetes HTTP concurrentes
// (deux onglets, un rejeu quasi simultane, ou deux jetons differents scannes
// coup sur coup) pourraient toutes deux lire "absent" avant qu'aucune des
// deux n'ait encore ecrit, et donc toutes deux inserer. Seul le moteur
// InnoDB, au moment precis de l'ecriture, peut garantir l'atomicite de
// cette verification -- exactement ce que documentent les commentaires de
// la table scans dans 01-schema.sql.
//
// Une meme erreur MySQL (code ER_DUP_ENTRY, 1062) est levee que ce soit
// uq_scan_nonce OU uq_scan_presence qui soit violee -- MySQL ne distingue
// PAS nativement laquelle des deux dans le code d'erreur. La distinction
// (necessaire pour choisir entre REJEU_DETECTE et DOUBLE_SCAN dans la
// reponse HTTP) est faite ci-dessous par une lecture ciblee APRES l'echec
// de l'INSERT, jamais par une analyse du texte libre de error.message
// (dont le format exact varie selon la version/locale du serveur MySQL,
// donc fragile) ni par une verification AVANT l'INSERT (qui reintroduirait
// la meme fenetre de course que ci-dessus).

const crypto = require('crypto');
const pool = require('../config/db');
const { verifierJetonScan, TokenInvalideError } = require('../services/verificationService');
const {
  verifierSignatureAppareil,
  SignatureAppareilInvalideError,
} = require('../services/deviceSignatureService');

/**
 * POST /api/scans
 * Corps attendu : { jeton: string, signature_appareil: string }
 * Route PROTEGEE : exige une session authentifiee de role 'etudiant'.
 *
 * ETAPE 7c -- etudiant_id N'EST PLUS LU DANS LE CORPS DE LA REQUETE.
 * Il provient exclusivement de req.utilisateur.etudiant_id, c'est-a-dire de
 * la session resolue cote serveur a partir du cookie httpOnly. C'est le
 * correctif de la limitation signalee depuis l'Etape 3 : jusqu'ici,
 * n'importe qui pouvait scanner "au nom de" n'importe quel etudiant en
 * changeant une valeur dans le corps JSON, ce qui vidait de sens toute la
 * chaine cryptographique construite aux Etapes 4 et 5. Un champ etudiant_id
 * eventuellement present dans le corps est desormais purement et simplement
 * IGNORE -- et non rejete : le refuser explicitement renseignerait un
 * attaquant sur le mecanisme, sans aucun gain de securite.
 *
 * signature_appareil reste OBLIGATOIRE (Etape 5) : c'est la preuve que le
 * jeton est presente par l'appareil enrole de l'etudiant. La rendre
 * facultative aurait offert un contournement trivial -- il aurait suffi de
 * ne jamais s'enroler pour echapper au controle.
 *
 * Les deux garanties se completent et ne se remplacent pas : la session
 * prouve QUI, la signature d'appareil prouve DEPUIS QUEL APPAREIL. Un compte
 * vole sans l'appareil enrole ne permet pas de scanner ; un appareil enrole
 * sans la session non plus.
 */
async function scannerJeton(req, res) {
  const { jeton, signature_appareil: signatureAppareil } = req.body || {};

  // Identite issue de la SESSION, jamais du client (cf. en-tete de fonction).
  const etudiantId = req.utilisateur.etudiant_id;

  if (!jeton || !signatureAppareil) {
    return res.status(400).json({
      status: 'error',
      message: 'jeton et signature_appareil sont obligatoires.',
    });
  }

  // --- a) puis b) : signature RS256, puis expiration -- dans cet ordre,
  // garanti par jwt.verify() lui-meme (cf. verificationService.js). ---
  let decoded;
  try {
    decoded = verifierJetonScan(jeton);
  } catch (err) {
    if (err instanceof TokenInvalideError && err.code === 'EXPIRE') {
      // 401 : le jeton est syntaxiquement/cryptographiquement comprehensible
      // mais n'est plus une preuve de presence valide -- vecteur V1 ferme ici.
      return res.status(401).json({
        status: 'error',
        code: 'JETON_EXPIRE',
        message: 'Jeton expire : rescannez le QR code actuellement affiche.',
      });
    }
    if (err instanceof TokenInvalideError) {
      return res.status(401).json({
        status: 'error',
        code: 'JETON_INVALIDE',
        message: 'Jeton invalide (signature ou format incorrect).',
      });
    }
    // Erreur inattendue (ne devrait jamais arriver : verifierJetonScan ne
    // leve que des TokenInvalideError) -- 500 plutot que de masquer une
    // vraie panne derriere un 401 trompeur.
    console.error('[scanController] Erreur inattendue lors de la verification du jeton :', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Erreur serveur lors de la verification du jeton.',
    });
  }

  const { sessionId, jti } = decoded;

  // --- c) : signature ECDSA de l'appareil enrole. AVANT toute ecriture
  // (voir l'en-tete de ce fichier pour l'ecart assume sur l'ordre). ---
  let appareil;
  try {
    const [appareils] = await pool.query(
      `SELECT cle_publique FROM appareils_enroles
       WHERE etudiant_id = ? AND statut = 'actif'
       LIMIT 1`,
      [etudiantId]
    );
    appareil = appareils[0];
  } catch (error) {
    console.error('[scanController] Erreur lors de la lecture de l\'appareil enrole :', error.message);
    return res.status(500).json({
      status: 'error',
      message: "Erreur serveur lors de la verification de l'appareil.",
    });
  }

  if (!appareil) {
    // Aucun appareil actif pour cet etudiant : le scan ne peut pas etre
    // verifie, donc il est refuse. 403 (et non 401) : la requete est
    // parfaitement formee et le jeton authentique -- c'est l'ETAT du compte
    // (aucun appareil enrole) qui interdit l'operation, pas un defaut
    // d'authentification de la requete elle-meme.
    return res.status(403).json({
      status: 'error',
      code: 'AUCUN_APPAREIL_ENROLE',
      message: "Aucun appareil actif n'est enrole pour cet etudiant : enrolez cet appareil avant de scanner.",
    });
  }

  try {
    // La chaine signee est le JETON COMPLET, exactement tel qu'il a ete
    // recu -- pas un condense ni un sous-ensemble de ses champs. Consequence
    // volontaire : la signature est indissociable de CE jeton precis (donc
    // de ce jti, de cette seance et de cette fenetre de 25 secondes). Une
    // signature capturee sur un scan legitime ne peut pas etre rejouee avec
    // un autre jeton : elle ne le validerait pas.
    verifierSignatureAppareil(jeton, signatureAppareil, appareil.cle_publique);
  } catch (err) {
    if (err instanceof SignatureAppareilInvalideError) {
      if (err.code === 'CLE_ILLISIBLE') {
        // Donnee corrompue cote serveur, pas une fraude du client -- ne pas
        // l'imputer a l'utilisateur par un 401 trompeur.
        console.error('[scanController] Cle publique d\'appareil illisible :', err.message);
        return res.status(500).json({
          status: 'error',
          message: "La cle publique enregistree pour cet appareil est illisible : re-enrolez l'appareil.",
        });
      }
      return res.status(401).json({
        status: 'error',
        code: 'SIGNATURE_APPAREIL_INVALIDE',
        message: "La signature de l'appareil est invalide : ce jeton n'a pas ete signe par l'appareil enrole de cet etudiant.",
      });
    }
    console.error('[scanController] Erreur inattendue lors de la verification de signature :', err.message);
    return res.status(500).json({
      status: 'error',
      message: "Erreur serveur lors de la verification de la signature de l'appareil.",
    });
  }

  const scanId = crypto.randomUUID();

  // --- d) et e) : unicite du nonce ET unicite de la presence, chacune
  // appliquee par sa propre contrainte UNIQUE sur la table scans -- voir
  // l'en-tete de ce fichier pour la justification complete du choix
  // "laisser l'INSERT echouer" plutot qu'un SELECT prealable, dans les deux cas.
  try {
    await pool.query(
      'INSERT INTO scans (id, seance_id, etudiant_id, jti, resultat) VALUES (?, ?, ?, ?, ?)',
      [scanId, sessionId, etudiantId, jti, 'valide']
    );

    return res.status(201).json({
      status: 'ok',
      scan_id: scanId,
      seance_id: sessionId,
      etudiant_id: etudiantId,
      resultat: 'valide',
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      // La contrainte UNIQUE (l'une des deux -- MySQL ne dit pas laquelle
      // via error.code, toujours 1062 dans les deux cas) vient de rejeter
      // l'insertion. Disambiguation deterministe : est-ce EXACTEMENT ce
      // (jti, etudiant_id) qui existe deja ? Si oui, c'est un rejeu litteral
      // du meme jeton (uq_scan_nonce, V4). Si non, l'INSERT n'a pu echouer
      // que sur l'autre contrainte possible (uq_scan_presence) : un jeton
      // DIFFERENT (jti different), mais la meme paire (seance_id,
      // etudiant_id) existe deja -- double scan (regle metier).
      //
      // Cette lecture ne sert JAMAIS a decider s'il faut inserer (l'INSERT
      // a deja ete tente et a deja echoue de maniere atomique au moment ou
      // ce code s'execute) -- uniquement a choisir le bon message d'erreur
      // pour le client. L'atomicite du rejet reste entierement garantie par
      // les contraintes UNIQUE elles-memes, pas par cette lecture.
      const [dejaRejoue] = await pool.query(
        'SELECT 1 FROM scans WHERE jti = ? AND etudiant_id = ? LIMIT 1',
        [jti, etudiantId]
      );

      if (dejaRejoue.length > 0) {
        // uq_scan_nonce : rejeu (V4). 409 (et non 400) : la requete est
        // valide en soi, c'est son EFFET (creer un doublon) que l'etat
        // actuel du serveur refuse.
        return res.status(409).json({
          status: 'error',
          code: 'REJEU_DETECTE',
          message: 'Ce jeton a deja ete utilise par cet etudiant (rejeu detecte).',
        });
      }

      // uq_scan_presence : un AUTRE jeton (jti different), valide et non
      // rejoue, a deja ete scanne par cet etudiant pour cette meme seance.
      return res.status(409).json({
        status: 'error',
        code: 'DOUBLE_SCAN',
        message: 'Presence deja validee pour cette seance.',
      });
    }

    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      // seance_id (extrait du jeton, jamais du client) ou etudiant_id
      // (fourni par le client) ne correspond a aucune ligne existante --
      // meme raisonnement que seanceController.js : erreur de saisie/etat
      // previsible, pas une panne serveur.
      return res.status(400).json({
        status: 'error',
        message: 'seance_id (issu du jeton) ou etudiant_id inconnu (aucune ligne correspondante en base).',
      });
    }

    console.error('[scanController] Erreur POST /api/scans :', error.message);
    return res.status(500).json({
      status: 'error',
      message: "Erreur serveur lors de l'enregistrement du scan.",
    });
  }
}

module.exports = { scannerJeton };
