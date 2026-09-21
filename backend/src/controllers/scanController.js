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
// c) est implementee en laissant l'INSERT echouer sur uq_scan_nonce
// (01-schema.sql), jamais par un SELECT prealable ("ce jti existe-t-il
// deja ?") suivi d'un INSERT conditionnel. Un SELECT-puis-INSERT applicatif
// ouvrirait une fenetre de course : deux requetes HTTP concurrentes (deux
// onglets, un rejeu quasi simultane) pourraient toutes deux lire "absent"
// avant qu'aucune n'ait encore ecrit, et donc toutes deux inserer. Seul le
// moteur InnoDB, au moment precis de l'ecriture, peut garantir l'atomicite
// de cette verification.
//
// --- DOUBLE SCAN : ENTREE PUIS SORTIE -------------------------------------
//
// Un etudiant scanne DEUX fois : en arrivant, puis en quittant la salle. Le
// second scan ne cree pas une seconde presence -- il complete la premiere en
// y inscrivant heure_depart. C'est la seule facon d'obtenir un temps de
// participation EXACT ; a defaut, le systeme retient l'heure de fin prevue
// de la seance (cf. presenceController.js, SQL_FIN_RETENUE), ce qui est une
// approximation acceptable mais une approximation tout de meme.
//
// Ce comportement exigeait de RETIRER la contrainte uq_scan_presence
// (seance_id, etudiant_id) de la table scans. Elle exprimait la bonne regle
// -- une seule presence par etudiant et par seance -- mais sur la mauvaise
// table : scans est le journal brut des evenements, et lui interdire une
// deuxieme ligne interdisait d'enregistrer le scan de sortie. Un geste
// legitime recevait un 409 DOUBLE_SCAN. La regle metier est desormais portee
// par uq_presence sur la table presences, qui contraint l'ETAT et non
// l'HISTOIRE (justification complete dans 01-schema.sql, en-tete de scans).
//
// L'aiguillage arrivee/depart est IMPLICITE : rien n'est demande a
// l'etudiant, qui scanne simplement le meme QR code. C'est l'existence d'une
// presence ouverte qui determine le sens. Un choix explicite ("j'arrive" /
// "je pars") ajouterait une decision a un geste qui doit rester
// instantane -- et une decision offerte est une decision qui sera parfois
// mal prise, produisant des donnees fausses qu'aucun controle ne pourrait
// ensuite distinguer des vraies.
//
// La lecture prealable de la presence se fait SELECT ... FOR UPDATE, a
// l'interieur de la transaction : deux scans simultanes ne peuvent pas lire
// tous deux "presence ouverte" et tenter tous deux d'ecrire le depart. Ce
// n'est pas la meme situation que le SELECT-puis-INSERT proscrit plus haut,
// precisement PARCE QUE le verrou de ligne est pose par le moteur.

const crypto = require('crypto');
const pool = require('../config/db');
const { verifierJetonScan, TokenInvalideError } = require('../services/verificationService');
const {
  verifierSignatureAppareil,
  SignatureAppareilInvalideError,
} = require('../services/deviceSignatureService');
const { evaluerPosition } = require('../services/geofencingService');

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
  const {
    jeton,
    signature_appareil: signatureAppareil,
    latitude, longitude, precision_m: precisionBrute,
  } = req.body || {};

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
  let appareilsRevoques = [];
  try {
    const [appareils] = await pool.query(
      `SELECT id, cle_publique, statut FROM appareils_enroles
       WHERE etudiant_id = ?
       ORDER BY (statut = 'actif') DESC, date_enrolement DESC`,
      [etudiantId]
    );
    appareil = appareils.find((a) => a.statut === 'actif');
    appareilsRevoques = appareils.filter((a) => a.statut === 'revoque');
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
      // AVANT de conclure a une signature invalide, verifier si le jeton a
      // ete signe par un appareil REVOQUE de cet etudiant. C'est le cas le
      // plus frequent en pratique : l'etudiant a change de telephone, et
      // l'ancien continue d'essayer. Le rejet est le meme, mais le message
      // doit dire la verite -- "signature invalide" laisserait croire a un
      // defaut technique alors que le systeme fonctionne exactement comme
      // prevu. C'est aussi ce qui permet a l'interface d'afficher un message
      // actionnable ("cet appareil a ete dissocie") plutot qu'une erreur
      // cryptographique incomprehensible.
      const signeParUnAppareilRevoque = appareilsRevoques.some((revoque) => {
        try {
          verifierSignatureAppareil(jeton, signatureAppareil, revoque.cle_publique);
          return true;
        } catch {
          return false;
        }
      });

      if (signeParUnAppareilRevoque) {
        return res.status(403).json({
          status: 'error',
          code: 'APPAREIL_REVOQUE',
          message: "Cet appareil a ete dissocie de votre compte. Utilisez l'appareil actuellement enrole, ou enrolez celui-ci a nouveau.",
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

  // --- Geofencing (RF-13). VOLONTAIREMENT NON BLOQUANT. ---
  //
  // Le resultat est consigne, jamais oppose a l'etudiant. L'asymetrie des
  // couts le justifie : un etudiant present marque absent subit un prejudice
  // administratif et academique reel, alors qu'une fraude qui passe reste
  // rattrapable par d'autres moyens. Et la position venant du client, la
  // bloquer donnerait une fausse impression de rigueur tout en penalisant
  // surtout les etudiants dont le telephone capte mal.
  let geo = { coherente: null, distanceM: null, motif: 'AUCUNE_REFERENCE' };
  try {
    const [seances] = await pool.query(
      `SELECT latitude_reference, longitude_reference, rayon_tolerance_m
       FROM seances WHERE id = ?`,
      [sessionId]
    );
    const seance = seances[0];
    if (seance && seance.latitude_reference !== null) {
      geo = evaluerPosition({
        reference: {
          latitude: Number(seance.latitude_reference),
          longitude: Number(seance.longitude_reference),
        },
        scan: {
          latitude: Number(latitude),
          longitude: Number(longitude),
          precisionM: Number(precisionBrute),
        },
        rayonToleranceM: seance.rayon_tolerance_m,
      });
    }
  } catch (error) {
    // Une panne du calcul geographique ne doit JAMAIS empecher un etudiant
    // de valider sa presence : le geofencing est un indicateur secondaire.
    console.error('[scanController] Erreur lors de l\'evaluation de position :', error.message);
  }

  const scanId = crypto.randomUUID();
  const presenceId = crypto.randomUUID();

  // --- d) et e) : unicite du nonce ET unicite de la presence, chacune
  // appliquee par sa propre contrainte UNIQUE sur la table scans -- voir
  // l'en-tete de ce fichier pour la justification complete du choix
  // "laisser l'INSERT echouer" plutot qu'un SELECT prealable, dans les deux cas.
  //
  // Le scan ET la presence sont ecrits dans UNE SEULE TRANSACTION. scans est
  // le journal brut immuable, presences l'etat courant : un scan sans
  // presence correspondante laisserait un etudiant ayant reellement scanne
  // absent de tous les releves d'heures, sans qu'aucune erreur ne soit
  // levee. Les deux ecritures reussissent ensemble ou aucune n'est appliquee.
  const connexion = await pool.getConnection();
  try {
    await connexion.beginTransaction();

    // Le scan est TOUJOURS journalise, qu'il porte une arrivee ou un depart.
    // scans est le registre des evenements : il doit refleter ce qui s'est
    // produit, independamment de l'effet que cela produit sur l'etat.
    await connexion.query(
      'INSERT INTO scans (id, seance_id, etudiant_id, jti, resultat) VALUES (?, ?, ?, ?, ?)',
      [scanId, sessionId, etudiantId, jti, 'valide']
    );

    // FOR UPDATE : verrouille la ligne de presence (ou constate son absence)
    // pour la duree de la transaction. Sans ce verrou, deux scans emis a
    // quelques millisecondes d'intervalle pourraient lire tous deux
    // "presence ouverte" et tenter tous deux d'ecrire le depart.
    const [presencesExistantes] = await connexion.query(
      `SELECT id, heure_arrivee, heure_depart,
              (NOW() <= heure_arrivee) AS depart_trop_tot
         FROM presences
        WHERE seance_id = ? AND etudiant_id = ?
        FOR UPDATE`,
      [sessionId, etudiantId]
    );
    const presenceOuverte = presencesExistantes[0];

    // ---------------------------------------------------------------------
    // CAS 2 : le depart. Une presence existe deja, sans heure de sortie.
    // ---------------------------------------------------------------------
    if (presenceOuverte && presenceOuverte.heure_depart === null) {
      // Garde-fou contre chk_presence_bornes (heure_depart > heure_arrivee).
      // Un etudiant qui scanne deux fois par megarde dans la meme seconde
      // violerait la contrainte et recevrait une erreur 500 incomprehensible.
      // Le cas est traite explicitement, avec un message qui dit quoi faire.
      if (presenceOuverte.depart_trop_tot === 1) {
        await connexion.rollback();
        return res.status(409).json({
          status: 'error',
          code: 'DEPART_TROP_TOT',
          message: 'Votre arrivee vient d\'etre enregistree. Rescannez en quittant la salle pour pointer votre depart.',
        });
      }

      await connexion.query(
        'UPDATE presences SET heure_depart = NOW(), scan_depart_id = ? WHERE id = ?',
        [scanId, presenceOuverte.id]
      );
      await connexion.commit();

      return res.status(200).json({
        status: 'ok',
        sens: 'depart',
        scan_id: scanId,
        presence_id: presenceOuverte.id,
        seance_id: sessionId,
        etudiant_id: etudiantId,
        resultat: 'valide',
        position: { coherente: geo.coherente, distance_m: geo.distanceM, motif: geo.motif },
      });
    }

    // ---------------------------------------------------------------------
    // CAS 3 : le cycle est deja complet. Arrivee ET depart sont pointes.
    // ---------------------------------------------------------------------
    if (presenceOuverte) {
      // Le scan reste journalise (l'INSERT ci-dessus est valide et sera
      // conserve) : une tentative refusee fait partie de l'histoire de la
      // seance. Mais l'etat n'est pas modifie -- reecrire heure_depart a
      // chaque nouveau scan permettrait a un etudiant de gonfler son temps
      // en repassant devant l'ecran en fin de journee.
      //
      // Une correction reste possible, mais par la voie tracee : demande de
      // rectification par l'etudiant, ou modification par le formateur avec
      // motif consigne au journal d'audit. Ce qui est refuse ici, c'est la
      // modification SILENCIEUSE.
      await connexion.commit();
      return res.status(409).json({
        status: 'error',
        code: 'DEPART_DEJA_POINTE',
        message: 'Votre arrivee et votre depart sont deja enregistres pour cette seance. '
               + 'Si une heure est inexacte, signalez-le a votre formateur.',
      });
    }

    // ---------------------------------------------------------------------
    // CAS 1 : l'arrivee. Aucune presence pour cet etudiant sur cette seance.
    // ---------------------------------------------------------------------
    //
    // heure_arrivee = NOW() de la BASE, jamais une heure fournie par le
    // client : c'est l'horloge du serveur qui fait foi pour tout ce qui
    // servira a justifier des quotas.
    await connexion.query(
      `INSERT INTO presences
         (id, seance_id, etudiant_id, scan_arrivee_id, heure_arrivee, source,
          latitude_scan, longitude_scan, precision_m, distance_m, position_coherente)
       VALUES (?, ?, ?, ?, NOW(), 'scan', ?, ?, ?, ?, ?)`,
      [
        presenceId, sessionId, etudiantId, scanId,
        Number.isFinite(Number(latitude)) ? Number(latitude) : null,
        Number.isFinite(Number(longitude)) ? Number(longitude) : null,
        Number.isFinite(Number(precisionBrute)) ? Math.round(Number(precisionBrute)) : null,
        geo.distanceM,
        // null reste null : indeterminable n'est PAS la meme chose que
        // "hors zone", et les confondre reviendrait a signaler des etudiants
        // dont le GPS n'a simplement pas fonctionne.
        geo.coherente === null ? null : (geo.coherente ? 1 : 0),
      ]
    );

    await connexion.commit();

    return res.status(201).json({
      status: 'ok',
      sens: 'arrivee',
      scan_id: scanId,
      presence_id: presenceId,
      seance_id: sessionId,
      etudiant_id: etudiantId,
      resultat: 'valide',
      position: { coherente: geo.coherente, distance_m: geo.distanceM, motif: geo.motif },
    });
  } catch (error) {
    await connexion.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      // Depuis le retrait de uq_scan_presence, l'INSERT dans scans ne peut
      // plus violer qu'UNE seule contrainte : uq_scan_nonce. La
      // desambiguisation reste neanmoins explicite plutot que presumee --
      // MySQL renvoie le meme code 1062 pour toute violation d'unicite, et
      // une contrainte ajoutee plus tard ne doit pas etre silencieusement
      // interpretee comme un rejeu.
      //
      // Cette lecture ne sert JAMAIS a decider s'il faut inserer (l'INSERT
      // a deja ete tente et a deja echoue de maniere atomique au moment ou
      // ce code s'execute) -- uniquement a choisir le bon message d'erreur.
      const [dejaRejoue] = await pool.query(
        'SELECT 1 FROM scans WHERE jti = ? AND etudiant_id = ? LIMIT 1',
        [jti, etudiantId]
      );

      if (dejaRejoue.length > 0) {
        // uq_scan_nonce : rejeu (V4). 409 (et non 400) : la requete est
        // valide en soi, c'est son EFFET (rejouer un jeton deja consomme)
        // que l'etat actuel du serveur refuse.
        //
        // A NE PAS CONFONDRE avec le double scan legitime : ici c'est le
        // MEME jeton qui est represente. Un depart normal utilise un jeton
        // DIFFERENT, emis par une rotation ulterieure -- il ne passe donc
        // jamais par cette branche.
        return res.status(409).json({
          status: 'error',
          code: 'REJEU_DETECTE',
          message: 'Ce jeton a deja ete utilise par cet etudiant (rejeu detecte).',
        });
      }

      // uq_presence : deux scans d'arrivee reellement simultanes, dont le
      // second a franchi la lecture FOR UPDATE avant que le premier ne
      // commite. Le filet de securite du moteur a joue son role -- il n'y a
      // pas de doublon en base, et le client peut simplement rescanner.
      return res.status(409).json({
        status: 'error',
        code: 'SCAN_CONCURRENT',
        message: 'Un autre scan est en cours de traitement pour cette seance. Reessayez.',
      });
    }

    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
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
  } finally {
    // Restitution au pool dans TOUS les cas : sans ce finally, quelques
    // scans en erreur suffiraient a epuiser les dix connexions du pool.
    connexion.release();
  }
}

module.exports = { scannerJeton };
