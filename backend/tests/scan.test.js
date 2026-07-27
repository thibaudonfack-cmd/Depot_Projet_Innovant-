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
// d'un scan (RF-12, Etape 3). Meme prerequis que health.test.js : MySQL
// reellement joignable (variables MYSQL_* de l'environnement), schema et
// seed charges (01-schema.sql, 02-seed.sql).
//
// AUCUN mock de la base ici, deliberement : le point precis de ce fichier
// est de prouver que les contraintes UNIQUE(jti, etudiant_id) et
// UNIQUE(seance_id, etudiant_id) rejettent reellement les cas invalides au
// niveau du moteur InnoDB lui-meme (cf. 01-schema.sql, scanController.js),
// pas seulement qu'un code applicatif simule ce comportement. Un mock du
// pool passerait a cote de la seule chose que cette Etape doit demontrer.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const { app } = require('../server');
const pool = require('../src/config/db');
const { generateSessionToken } = require('../src/services/tokenService');

// UUID fixes du seed de demonstration (02-seed.sql) -- deja utilises ailleurs
// dans le projet (TESTING.md) pour rester reproductibles d'un environnement
// a l'autre.
const UF_ID = '11111111-1111-1111-1111-111111111111';
const SALLE_ID = '22222222-2222-2222-2222-222222222222';

// Un etudiant DEDIE par scenario qui va JUSQU'AU BOUT de l'insertion (au
// moins un INSERT reussi dans scans) -- et non un seul ETUDIANT_ID partage.
// Raison : depuis l'ajout de UNIQUE(seance_id, etudiant_id) (regle metier
// de presence, cf. ANALYSE_CODE.md), un etudiant ne peut plus avoir qu'UNE
// seule ligne de presence pour cette seance de test, quel que soit le
// jeton utilise. Reutiliser le meme etudiant_id entre le cas nominal et le
// test de rejeu (par exemple) ferait echouer le premier appel du second
// test avec 409 DOUBLE_SCAN au lieu du 201 attendu -- pas un bug de
// l'implementation, une consequence directe et voulue de la nouvelle regle
// metier qu'il faut respecter cote tests aussi. Les tests qui ne touchent
// JAMAIS la base (jeton expire/invalide/champs manquants, rejetes avant
// l'INSERT) peuvent en revanche partager librement un etudiant_id.
const ETUDIANT_NOMINAL = '33333333-3333-3333-3333-333333333331';
const ETUDIANT_V4 = '33333333-3333-3333-3333-333333333332';
const ETUDIANT_DOUBLE_SCAN = '33333333-3333-3333-3333-333333333333';
const ETUDIANT_SANS_DB = '33333333-3333-3333-3333-333333333334';

// Meme resolution que tokenService.js, adaptee a la profondeur de ce fichier
// (backend/tests/ -> 2 niveaux jusqu'a la racine du depot, contre 3 depuis
// backend/src/services/).
const PRIVATE_KEY_PATH = process.env.JWT_PRIVATE_KEY_PATH
  ? path.resolve(process.env.JWT_PRIVATE_KEY_PATH)
  : path.resolve(__dirname, '../../keys/private.pem');
const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

let seanceId;

beforeAll(async () => {
  // Une seance dediee a cette suite, creee DIRECTEMENT en base plutot que
  // via POST /api/seances : ce fichier ne doit pas dependre du controller
  // d'un autre endpoint pour etre lisible et executable isolement. Seule la
  // table seances doit exister pour satisfaire la FK scans.seance_id.
  seanceId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO seances (id, uf_id, salle_id) VALUES (?, ?, ?)',
    [seanceId, UF_ID, SALLE_ID]
  );
});

afterAll(async () => {
  // PAS de nettoyage des lignes creees (ni scans, ni la seance de test) :
  // ce n'est pas un oubli. La table scans est VOLONTAIREMENT en ecriture
  // seule pour l'utilisateur applicatif (app_logs ne recoit ni UPDATE ni
  // DELETE sur scans -- whitelist RF-18/RNF-13, cf. database/03-privileges.sh
  // et ANALYSE_CODE.md, section Etape 1). Une premiere version de ce fichier
  // tentait un DELETE FROM scans ici et a echoue avec exactement l'erreur
  // MySQL attendue dans ce cas ("DELETE command denied to user 'app_logs'"),
  // ce qui a confirme EN CONDITIONS REELLES que la contrainte de privileges
  // posee a l'Etape 1 s'applique bien, y compris a du code de test qui
  // utilise le meme pool que l'application. Supprimer ces lignes exigerait
  // un acces root (reserve, dans ce projet, a la purge de fin d'UF, RF-20 --
  // hors perimetre de ce fichier), pas le pool applicatif standard.
  //
  // Meme raison que health.test.js pour ce qui reste : sans ce pool.end()
  // explicite, Jest resterait bloque sur un handle TCP ouvert
  // (detectOpenHandles: true, jest.config.js, l'aurait signale).
  await pool.end();
});

describe('POST /api/scans -- cascade de validation (RF-12)', () => {
  test('cas nominal : un jeton fraichement genere est accepte (201)', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);

    const response = await request(app)
      .post('/api/scans')
      .send({ jeton, etudiant_id: ETUDIANT_NOMINAL });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ok');
    expect(response.body.resultat).toBe('valide');
    expect(response.body.seance_id).toBe(seanceId);
    expect(response.body.etudiant_id).toBe(ETUDIANT_NOMINAL);
  });

  test('V1 (partage differe) : un jeton expire est rejete (401, code JETON_EXPIRE)', async () => {
    // expiresIn negatif produit un jeton dont l'exp est deja passe des la
    // signature -- equivalent exact, sans attendre 25s reelles dans la
    // suite de test, d'une capture/photo du QR code envoyee trop tard.
    // Ne touche jamais la base (rejete des la verification cryptographique) :
    // peut partager ETUDIANT_SANS_DB sans risque de collision.
    const jetonExpire = jwt.sign(
      { session_id: seanceId, salle_id: SALLE_ID },
      privateKey,
      { algorithm: 'RS256', expiresIn: '-10s', jwtid: crypto.randomUUID() }
    );

    const response = await request(app)
      .post('/api/scans')
      .send({ jeton: jetonExpire, etudiant_id: ETUDIANT_SANS_DB });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('JETON_EXPIRE');
  });

  test('signature invalide (jeton signe par une autre cle) : rejete (401, code JETON_INVALIDE), distinctement d\'un jeton expire', async () => {
    // Cle RSA jetable, generee dans le test : garantit une signature
    // invalide de maniere deterministe (contrairement a une mutation de
    // chaine sur un vrai jeton, qui pourrait accidentellement retomber sur
    // un cas limite). Ce jeton n'a jamais ete signe par la vraie cle privee
    // du serveur -- c'est exactement le scenario "jeton forge". Ne touche
    // jamais la base non plus : ETUDIANT_SANS_DB reutilise sans risque.
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

    const response = await request(app)
      .post('/api/scans')
      .send({ jeton: jetonForge, etudiant_id: ETUDIANT_SANS_DB });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('JETON_INVALIDE');
  });

  test('V4 (rejeu cryptographique) : soumettre deux fois EXACTEMENT le meme jeton est rejete la seconde fois (409, code REJEU_DETECTE)', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);

    const premiere = await request(app)
      .post('/api/scans')
      .send({ jeton, etudiant_id: ETUDIANT_V4 });
    expect(premiere.status).toBe(201);

    const deuxieme = await request(app)
      .post('/api/scans')
      .send({ jeton, etudiant_id: ETUDIANT_V4 });

    expect(deuxieme.status).toBe(409);
    expect(deuxieme.body.code).toBe('REJEU_DETECTE');
  });

  test('regle metier de presence (double scan) : un etudiant ne peut valider sa presence qu\'une fois par seance, MEME avec deux jetons DIFFERENTS, tous deux valides et jamais rejoues (409, code DOUBLE_SCAN)', async () => {
    const jetonA = generateSessionToken(seanceId, SALLE_ID);
    const jetonB = generateSessionToken(seanceId, SALLE_ID);

    // Verifie la premisse du test : ce n'est PAS un cas de rejeu (V4). Si
    // ces deux jti etaient identiques, ce test testerait accidentellement
    // la meme chose que le test V4 ci-dessus au lieu de la regle metier.
    expect(jwt.decode(jetonA).jti).not.toBe(jwt.decode(jetonB).jti);

    const premier = await request(app)
      .post('/api/scans')
      .send({ jeton: jetonA, etudiant_id: ETUDIANT_DOUBLE_SCAN });
    expect(premier.status).toBe(201);

    const second = await request(app)
      .post('/api/scans')
      .send({ jeton: jetonB, etudiant_id: ETUDIANT_DOUBLE_SCAN });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DOUBLE_SCAN');
  });

  test('jeton ou etudiant_id manquant : 400 explicite, avant toute verification cryptographique', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);

    const sansEtudiant = await request(app).post('/api/scans').send({ jeton });
    expect(sansEtudiant.status).toBe(400);

    const sansJeton = await request(app).post('/api/scans').send({ etudiant_id: ETUDIANT_SANS_DB });
    expect(sansJeton.status).toBe(400);
  });
});
