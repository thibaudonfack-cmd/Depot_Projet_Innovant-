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
//   b) Expiration (exp, TTL 25s)            -- ferme V1 (partage differe)
//   c) Unicite du nonce (jti, etudiant_id)  -- ferme V4 (rejeu)
//
// Le point c) est delibrement implemente en laissant l'INSERT echouer sur la
// contrainte UNIQUE(jti, etudiant_id) de la table scans (01-schema.sql),
// plutot que par un SELECT prealable ("ce jti existe-t-il deja ?") suivi
// d'un INSERT conditionnel. Un SELECT-puis-INSERT applicatif ouvrirait une
// fenetre de course : deux requetes HTTP concurrentes portant le meme jeton
// (ex. deux onglets, ou un rejeu volontaire quasi simultane) pourraient
// toutes deux lire "absent" avant qu'aucune des deux n'ait encore ecrit,
// et donc toutes deux inserer. Seul le moteur InnoDB, au moment precis de
// l'ecriture, peut garantir l'atomicite de cette verification -- c'est
// exactement ce que documente deja le commentaire de la table scans dans
// 01-schema.sql ("fermeture du vecteur V4 ... avant meme toute logique
// applicative").

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

  // --- c) : unicite du nonce, appliquee par la contrainte UNIQUE de la
  // table scans -- voir l'en-tete de ce fichier pour la justification
  // complete du choix "laisser l'INSERT echouer" plutot qu'un SELECT prealable.
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
      // Rejeu (V4) : ce (jti, etudiant_id) existe deja en base -- la
      // contrainte UNIQUE de 01-schema.sql vient de faire tout le travail.
      // 409 Conflict (et non 400) : la requete est valide en soi, c'est son
      // EFFET (creer un doublon) que l'etat actuel du serveur refuse.
      return res.status(409).json({
        status: 'error',
        code: 'REJEU_DETECTE',
        message: 'Ce jeton a deja ete utilise par cet etudiant (rejeu detecte).',
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
