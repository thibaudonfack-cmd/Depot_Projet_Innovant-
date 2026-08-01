// tests/scan.test.js
//
// Commande exacte pour lancer ces tests : docker compose exec backend npm test
// (depuis la racine du projet, conteneur backend deja demarre). Lancer
// "npm test" directement sur la machine hote (hors Docker) echouera de
// maniere explicite des le chargement de src/config/db.js (variables
// MYSQL_* absentes -- cf. db.js, verification fail-fast) plutot que par une
// erreur MySQL cryptique.
//
// Test d'integration (Supertest + vrai MySQL) de la cascade de validation
// d'un scan (RF-12, Etapes 3 et 5). Meme prerequis que health.test.js :
// MySQL reellement joignable (variables MYSQL_* de l'environnement), schema
// et seed charges (01-schema.sql, 02-seed.sql).
//
// AUCUN mock de la base ni de la cryptographie, deliberement : le point
// precis de ce fichier est de prouver que les contraintes UNIQUE(jti,
// etudiant_id) / UNIQUE(seance_id, etudiant_id) rejettent reellement au
// niveau du moteur InnoDB, ET que la verification de signature d'appareil
// (Etape 5) accepte/rejette de vraies signatures ECDSA. Un mock passerait a
// cote des deux.
//
// Note sur les cles utilisees ici : les paires ECDSA sont generees via
// l'API WebCrypto de Node (crypto.webcrypto.subtle), et NON via
// crypto.generateKeyPairSync. Choix delibere : WebCrypto est exactement
// l'API qu'utilise le frontend (CryptoService.js), et elle produit des
// signatures au format BRUT r||s (IEEE P1363, 64 octets) la ou l'API Node
// classique produit du DER (~71 octets). Utiliser generateKeyPairSync +
// createSign ici aurait produit des signatures DER que le backend rejette
// (il attend ieee-p1363, cf. deviceSignatureService.js) -- les tests
// auraient donc valide un format que le vrai client n'envoie jamais.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const { app } = require('../server');
const pool = require('../src/config/db');
const { generateSessionToken } = require('../src/services/tokenService');
const { connecter } = require('./aide-auth');

// UUID fixes du seed de demonstration (02-seed.sql).
const UF_ID = '11111111-1111-1111-1111-111111111111';
const SALLE_ID = '22222222-2222-2222-2222-222222222222';

// Un etudiant DEDIE par scenario qui va JUSQU'AU BOUT de l'insertion (au
// moins un INSERT reussi dans scans) -- et non un seul ETUDIANT_ID partage.
// Raison : UNIQUE(seance_id, etudiant_id) (regle metier de presence, cf.
// ANALYSE_CODE.md) fait qu'un etudiant ne peut avoir qu'UNE seule ligne de
// presence pour cette seance de test, quel que soit le jeton utilise.
// Reutiliser le meme etudiant_id entre le cas nominal et le test de rejeu
// ferait echouer le premier appel du second test avec 409 DOUBLE_SCAN au
// lieu du 201 attendu -- pas un bug de l'implementation, une consequence
// directe et voulue de la regle metier, qu'il faut respecter cote tests aussi.
const ETUDIANT_NOMINAL = '33333333-3333-3333-3333-333333333331';
const ETUDIANT_V4 = '33333333-3333-3333-3333-333333333332';
const ETUDIANT_DOUBLE_SCAN = '33333333-3333-3333-3333-333333333333';
const ETUDIANT_SANS_APPAREIL = '33333333-3333-3333-3333-333333333334';

// ETAPE 7c : etudiant_id n'est plus envoye dans le corps des requetes -- il
// provient de la session. Chaque scenario doit donc etre execute SOUS
// L'IDENTITE de l'etudiant concerne, d'ou un cookie de session par compte.
// Les identifiants ci-dessus ne servent plus qu'aux verifications directes
// en base et a l'enrolement des appareils de test.
const cookies = {};

const PRIVATE_KEY_PATH = process.env.JWT_PRIVATE_KEY_PATH
  ? path.resolve(process.env.JWT_PRIVATE_KEY_PATH)
  : path.resolve(__dirname, '../../keys/private.pem');
const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

let seanceId;
// Seconde seance, reservee au test d'usurpation d'identite (Etape 7c).
// Necessaire, et non un confort : la contrainte uq_scan_presence
// (Etape 3 bis) n'autorise qu'UNE presence par etudiant et par seance. Or
// les quatre etudiants du seed ont deja tous scanne -- ou ne peuvent pas
// signer -- sur la seance principale au moment ou ce test s'execute. Le
// reutiliser donnerait un 409 DOUBLE_SCAN parfaitement legitime, qui
// masquerait ce que le test cherche reellement a verifier.
let seanceUsurpation;
// Cles ECDSA des appareils "enroles" par cette suite, indexees par etudiant.
const appareils = new Map();

/**
 * Genere une paire ECDSA P-256 via WebCrypto (comme le frontend) et
 * l'enregistre en base comme appareil actif de cet etudiant -- equivalent
 * direct d'un POST /api/enrolements reussi, ecrit ici en SQL pour que ce
 * fichier ne dependre pas du controller d'un autre endpoint.
 */
async function enrolerAppareilPour(etudiantId) {
  const paire = await crypto.webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify']
  );
  const spki = await crypto.webcrypto.subtle.exportKey('spki', paire.publicKey);
  const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(spki).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;

  await pool.query(
    `INSERT INTO appareils_enroles (id, etudiant_id, cle_publique, info_appareil, statut)
     VALUES (?, ?, ?, ?, 'actif')`,
    [crypto.randomUUID(), etudiantId, pem, 'Test Suite - scan.test.js', ]
  );

  appareils.set(etudiantId, paire);
  return paire;
}

/** Signe une chaine avec la cle privee de l'appareil enrole d'un etudiant. */
async function signerAvecAppareilDe(etudiantId, donnees) {
  const paire = appareils.get(etudiantId);
  const signature = await crypto.webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    paire.privateKey,
    new TextEncoder().encode(donnees)
  );
  return Buffer.from(signature).toString('base64');
}

beforeAll(async () => {
  // Une seance dediee a cette suite, creee DIRECTEMENT en base plutot que
  // via POST /api/seances : ce fichier ne doit pas dependre du controller
  // d'un autre endpoint pour etre lisible et executable isolement.
  seanceId = crypto.randomUUID();
  seanceUsurpation = crypto.randomUUID();
  await pool.query(
    'INSERT INTO seances (id, uf_id, salle_id) VALUES (?, ?, ?), (?, ?, ?)',
    [seanceId, UF_ID, SALLE_ID, seanceUsurpation, UF_ID, SALLE_ID]
  );

  // Trois des quatre etudiants ont un appareil enrole. ETUDIANT_SANS_APPAREIL
  // n'en a volontairement AUCUN : c'est le sujet d'un test dedie.
  await enrolerAppareilPour(ETUDIANT_NOMINAL);
  await enrolerAppareilPour(ETUDIANT_V4);
  await enrolerAppareilPour(ETUDIANT_DOUBLE_SCAN);

  // Une session par etudiant concerne. Le compte "driss" correspond a
  // ETUDIANT_SANS_APPAREIL : il est authentifie comme les autres, mais
  // n'a volontairement aucun appareil enrole.
  for (const [cle, id] of [
    ['amara', ETUDIANT_NOMINAL],
    ['bilal', ETUDIANT_V4],
    ['chiara', ETUDIANT_DOUBLE_SCAN],
    ['driss', ETUDIANT_SANS_APPAREIL],
  ]) {
    const { cookie, utilisateur } = await connecter(cle);
    cookies[cle] = cookie;
    // Verification de coherence du seed : la session doit bien pointer vers
    // l'etudiant attendu. Sans ce controle, une erreur de correspondance
    // dans 02-seed.sql produirait des echecs de test tres difficiles a
    // diagnostiquer plus loin (un scan attribue au mauvais etudiant).
    expect(utilisateur.etudiant_id).toBe(id);
  }
});

afterAll(async () => {
  // PAS de nettoyage des lignes de scans : ce n'est pas un oubli. La table
  // scans est VOLONTAIREMENT en ecriture seule pour l'utilisateur applicatif
  // (app_logs ne recoit ni UPDATE ni DELETE sur scans -- whitelist
  // RF-18/RNF-13, cf. database/03-privileges.sh et ANALYSE_CODE.md, Etape 1).
  // Une premiere version de ce fichier tentait un DELETE FROM scans ici et a
  // echoue avec exactement l'erreur MySQL attendue ("DELETE command denied to
  // user 'app_logs'"), confirmant EN CONDITIONS REELLES que la contrainte de
  // privileges posee a l'Etape 1 s'applique bien, y compris au code de test.
  //
  // Les appareils enroles, eux, PEUVENT etre nettoyes : app_logs dispose de
  // DELETE sur appareils_enroles (RF-08, revocation de cle).
  for (const etudiantId of appareils.keys()) {
    await pool.query('DELETE FROM appareils_enroles WHERE etudiant_id = ?', [etudiantId]);
  }
  await pool.end();
});

describe('POST /api/scans -- cascade de validation (RF-12, Etapes 3 et 5)', () => {
  test('cas nominal : jeton frais + signature de l\'appareil enrole -> accepte (201)', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);
    const signature = await signerAvecAppareilDe(ETUDIANT_NOMINAL, jeton);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.amara)
      .send({ jeton, signature_appareil: signature });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ok');
    expect(response.body.resultat).toBe('valide');
    expect(response.body.seance_id).toBe(seanceId);
    expect(response.body.etudiant_id).toBe(ETUDIANT_NOMINAL);
  });

  test('V1 (partage differe) : un jeton expire est rejete (401, JETON_EXPIRE), meme avec une signature d\'appareil valide', async () => {
    // expiresIn negatif produit un jeton dont l'exp est deja passe des la
    // signature -- equivalent exact, sans attendre 25s reelles, d'une
    // capture/photo du QR code envoyee trop tard.
    const jetonExpire = jwt.sign(
      { session_id: seanceId, salle_id: SALLE_ID },
      privateKey,
      { algorithm: 'RS256', expiresIn: '-10s', jwtid: crypto.randomUUID() }
    );
    // Signature parfaitement valide : prouve que c'est bien l'EXPIRATION qui
    // rejette, pas un defaut de signature d'appareil.
    const signature = await signerAvecAppareilDe(ETUDIANT_NOMINAL, jetonExpire);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.amara)
      .send({ jeton: jetonExpire, signature_appareil: signature });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('JETON_EXPIRE');
  });

  test('signature RS256 du JETON invalide (jeton forge) : rejete (401, JETON_INVALIDE), distinctement d\'un jeton expire', async () => {
    const { privateKey: fausseCle } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const jetonForge = jwt.sign(
      { session_id: seanceId, salle_id: SALLE_ID },
      fausseCle,
      { algorithm: 'RS256', expiresIn: '25s', jwtid: crypto.randomUUID() }
    );
    const signature = await signerAvecAppareilDe(ETUDIANT_NOMINAL, jetonForge);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.amara)
      .send({ jeton: jetonForge, signature_appareil: signature });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('JETON_INVALIDE');
  });

  test('ETAPE 5 : signature d\'appareil invalide (signee par un AUTRE appareil) -> 401 SIGNATURE_APPAREIL_INVALIDE', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);
    // Le jeton est authentique et frais ; c'est l'appareil qui ne correspond
    // pas -- exactement le scenario "un tiers relaie le jeton depuis son
    // propre telephone".
    const signatureDuMauvaisAppareil = await signerAvecAppareilDe(ETUDIANT_V4, jeton);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.amara)
      .send({ jeton, signature_appareil: signatureDuMauvaisAppareil });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SIGNATURE_APPAREIL_INVALIDE');
  });

  test('ETAPE 5 : signature syntaxiquement invalide (chaine arbitraire) -> 401 SIGNATURE_APPAREIL_INVALIDE', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.amara)
      .send({ jeton, signature_appareil: 'AAAAAAAA' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SIGNATURE_APPAREIL_INVALIDE');
  });

  test('ETAPE 5 : une signature valide pour UN jeton ne valide PAS un AUTRE jeton (non-rejouabilite de la signature)', async () => {
    const premierJeton = generateSessionToken(seanceId, SALLE_ID);
    const secondJeton = generateSessionToken(seanceId, SALLE_ID);
    // Signature legitime, mais produite pour le PREMIER jeton -- rejouee ici
    // avec le second. La signature portant sur le jeton complet (jti inclus),
    // elle est indissociable de celui-ci.
    const signatureDuPremier = await signerAvecAppareilDe(ETUDIANT_NOMINAL, premierJeton);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.amara)
      .send({ jeton: secondJeton, signature_appareil: signatureDuPremier });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SIGNATURE_APPAREIL_INVALIDE');
  });

  test('ETAPE 5 : etudiant sans aucun appareil enrole -> 403 AUCUN_APPAREIL_ENROLE (et non 401)', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);
    // Signature techniquement bien formee (produite par un appareil reel),
    // mais cet etudiant n'a AUCUN appareil enrole en base : impossible de
    // verifier quoi que ce soit.
    const signature = await signerAvecAppareilDe(ETUDIANT_NOMINAL, jeton);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.driss)
      .send({ jeton, signature_appareil: signature });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUCUN_APPAREIL_ENROLE');
  });

  test('V4 (rejeu cryptographique) : soumettre deux fois EXACTEMENT le meme jeton (et la meme signature) est rejete la seconde fois (409, REJEU_DETECTE)', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);
    const signature = await signerAvecAppareilDe(ETUDIANT_V4, jeton);

    const premiere = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.bilal)
      .send({ jeton, signature_appareil: signature });
    expect(premiere.status).toBe(201);

    const deuxieme = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.bilal)
      .send({ jeton, signature_appareil: signature });

    expect(deuxieme.status).toBe(409);
    expect(deuxieme.body.code).toBe('REJEU_DETECTE');
  });

  test('regle metier de presence (double scan) : un etudiant ne peut valider sa presence qu\'une fois par seance, MEME avec deux jetons DIFFERENTS correctement signes (409, DOUBLE_SCAN)', async () => {
    const jetonA = generateSessionToken(seanceId, SALLE_ID);
    const jetonB = generateSessionToken(seanceId, SALLE_ID);

    // Verifie la premisse : ce n'est PAS un cas de rejeu (V4). Si ces deux
    // jti etaient identiques, ce test testerait accidentellement la meme
    // chose que le test V4 au lieu de la regle metier.
    expect(jwt.decode(jetonA).jti).not.toBe(jwt.decode(jetonB).jti);

    const signatureA = await signerAvecAppareilDe(ETUDIANT_DOUBLE_SCAN, jetonA);
    const signatureB = await signerAvecAppareilDe(ETUDIANT_DOUBLE_SCAN, jetonB);

    const premier = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.chiara)
      .send({ jeton: jetonA, signature_appareil: signatureA });
    expect(premier.status).toBe(201);

    const second = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.chiara)
      .send({ jeton: jetonB, signature_appareil: signatureB });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DOUBLE_SCAN');
  });

  test('champs obligatoires manquants (jeton ou signature_appareil) : 400 explicite, avant toute verification cryptographique', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);
    const signature = await signerAvecAppareilDe(ETUDIANT_NOMINAL, jeton);

    const sansJeton = await request(app)
      .post('/api/scans').set('Cookie', cookies.amara)
      .send({ signature_appareil: signature });
    expect(sansJeton.status).toBe(400);

    // signature_appareil manquante : rejetee en 400, JAMAIS acceptee par
    // defaut -- la rendre facultative offrirait un contournement trivial de
    // toute la chaine de securite de l'Etape 5.
    const sansSignature = await request(app)
      .post('/api/scans').set('Cookie', cookies.amara).send({ jeton });
    expect(sansSignature.status).toBe(400);
  });

  // --------------------------------------------------------------------
  // ETAPE 7c : l'identite ne vient plus du client
  // --------------------------------------------------------------------

  test("ETAPE 7c : sans cookie de session, la route est refusee (401) -- aucun scan possible sans authentification", async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);
    const signature = await signerAvecAppareilDe(ETUDIANT_NOMINAL, jeton);

    const response = await request(app)
      .post('/api/scans')
      .send({ jeton, signature_appareil: signature });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('NON_AUTHENTIFIE');
  });

  test('ETAPE 7c : un cookie de session invente est refuse (401)', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);
    const signature = await signerAvecAppareilDe(ETUDIANT_NOMINAL, jeton);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', 'presence_session=jeton-totalement-invente')
      .send({ jeton, signature_appareil: signature });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SESSION_INVALIDE');
  });

  test("ETAPE 7c : un etudiant_id glisse dans le corps est IGNORE -- le scan est attribue a l'utilisateur de la session, pas a l'identifiant fourni", async () => {
    // C'EST LE TEST CENTRAL DE L'ETAPE 7c. Bilal est authentifie, mais tente
    // de faire enregistrer une presence au nom d'Amara en placant son
    // identifiant dans le corps de la requete -- exactement l'attaque que
    // rendait triviale l'absence d'authentification jusqu'ici.
    // Seance DEDIEE : voir le commentaire de seanceUsurpation plus haut.
    const jeton = generateSessionToken(seanceUsurpation, SALLE_ID);
    const signature = await signerAvecAppareilDe(ETUDIANT_V4, jeton);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookies.bilal)
      .send({
        jeton,
        signature_appareil: signature,
        etudiant_id: ETUDIANT_NOMINAL, // tentative d'usurpation
      });

    // La requete aboutit (Bilal a le droit de scanner)...
    expect(response.status).toBe(201);
    // ...mais la presence est enregistree pour BILAL, jamais pour Amara.
    expect(response.body.etudiant_id).toBe(ETUDIANT_V4);
    expect(response.body.etudiant_id).not.toBe(ETUDIANT_NOMINAL);

    // Verification EN BASE, et pas seulement sur la reponse HTTP.
    const [lignes] = await pool.query(
      'SELECT etudiant_id FROM scans WHERE id = ?', [response.body.scan_id]
    );
    expect(lignes[0].etudiant_id).toBe(ETUDIANT_V4);
  });

  test("ETAPE 7c : un formateur authentifie ne peut pas scanner (403, role insuffisant)", async () => {
    const { cookie } = await connecter('formateur');
    const jeton = generateSessionToken(seanceId, SALLE_ID);
    const signature = await signerAvecAppareilDe(ETUDIANT_NOMINAL, jeton);

    const response = await request(app)
      .post('/api/scans')
      .set('Cookie', cookie)
      .send({ jeton, signature_appareil: signature });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ROLE_INSUFFISANT');
  });
});
