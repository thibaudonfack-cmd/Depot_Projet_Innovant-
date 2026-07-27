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
// Cascade STRICTE imposee par la mission :
//   a) Signature RS256 (verificationService.js, cle PUBLIQUE)
//   b) Expiration (exp, TTL 25s)                 -- ferme V1 (partage differe)
//   c) Unicite du nonce (jti, etudiant_id)        -- ferme V4 (rejeu crypto)
//   d) Unicite de la presence (seance_id, etudiant_id) -- regle METIER
//      (un etudiant, une presence par seance, meme avec plusieurs jetons
//      DIFFERENTS tous individuellement valides -- cf. ANALYSE_CODE.md,
//      section Etape 3, "Regle metier d'unicite de presence" pour la
//      distinction complete avec c).
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

/**
 * POST /api/scans
 * Corps attendu : { jeton: string, etudiant_id: string }
 *
 * Limitation connue et assumee a ce stade (documentee dans ANALYSE_CODE.md) :
 * etudiant_id est fourni tel quel par le client, sans authentification de
 * l'appareil qui l'envoie -- l'enrolement cryptographique par appareil
 * (RF-07) est explicitement hors perimetre de cette Etape 3, qui ferme
 * uniquement V1 et V4 (cf. mission). La cascade actuelle prouve "ce jeton
 * est authentique, frais, et pas encore consomme par cet etudiant", pas
 * encore "presente par l'appareil enrole de cet etudiant" -- cette derniere
 * garantie (et la fermeture du vecteur associe) arrivera avec RF-07.
 */
async function scannerJeton(req, res) {
  const { jeton, etudiant_id: etudiantId } = req.body || {};

  if (!jeton || !etudiantId) {
    return res.status(400).json({
      status: 'error',
      message: 'jeton et etudiant_id sont obligatoires.',
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
  const scanId = crypto.randomUUID();

  // --- c) et d) : unicite du nonce ET unicite de la presence, chacune
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
