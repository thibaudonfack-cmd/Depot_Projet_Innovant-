// tests/scan.test.js
// Test d'integration (Supertest + vrai MySQL) de la cascade de validation
// d'un scan (RF-12, Etape 3). Meme prerequis que health.test.js : MySQL
// reellement joignable (variables MYSQL_* de l'environnement), schema et
// seed charges (01-schema.sql, 02-seed.sql).
//
// AUCUN mock de la base ici, deliberement : le point precis de ce fichier
// est de prouver que la contrainte UNIQUE(jti, etudiant_id) rejette
// reellement un rejeu au niveau du moteur InnoDB lui-meme (cf. 01-schema.sql,
// scanController.js), pas seulement qu'un code applicatif simule ce
// comportement. Un mock du pool passerait a cote de la seule chose que
// cette Etape doit demontrer.

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
const ETUDIANT_ID = '33333333-3333-3333-3333-333333333331';

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
      .send({ jeton, etudiant_id: ETUDIANT_ID });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ok');
    expect(response.body.resultat).toBe('valide');
    expect(response.body.seance_id).toBe(seanceId);
    expect(response.body.etudiant_id).toBe(ETUDIANT_ID);
  });

  test('V1 (partage differe) : un jeton expire est rejete (401, code JETON_EXPIRE)', async () => {
    // expiresIn negatif produit un jeton dont l'exp est deja passe des la
    // signature -- equivalent exact, sans attendre 25s reelles dans la
    // suite de test, d'une capture/photo du QR code envoyee trop tard.
    const jetonExpire = jwt.sign(
      { session_id: seanceId, salle_id: SALLE_ID },
      privateKey,
      { algorithm: 'RS256', expiresIn: '-10s', jwtid: crypto.randomUUID() }
    );

    const response = await request(app)
      .post('/api/scans')
      .send({ jeton: jetonExpire, etudiant_id: ETUDIANT_ID });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('JETON_EXPIRE');
  });

  test('signature invalide (jeton signe par une autre cle) : rejete (401, code JETON_INVALIDE), distinctement d\'un jeton expire', async () => {
    // Cle RSA jetable, generee dans le test : garantit une signature
    // invalide de maniere deterministe (contrairement a une mutation de
    // chaine sur un vrai jeton, qui pourrait accidentellement retomber sur
    // un cas limite). Ce jeton n'a jamais ete signe par la vraie cle privee
    // du serveur -- c'est exactement le scenario "jeton forge".
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
      .send({ jeton: jetonForge, etudiant_id: ETUDIANT_ID });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('JETON_INVALIDE');
  });

  test('V4 (rejeu) : soumettre deux fois exactement le meme jeton est rejete la seconde fois (409, code REJEU_DETECTE)', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);

    const premiere = await request(app)
      .post('/api/scans')
      .send({ jeton, etudiant_id: ETUDIANT_ID });
    expect(premiere.status).toBe(201);

    const deuxieme = await request(app)
      .post('/api/scans')
      .send({ jeton, etudiant_id: ETUDIANT_ID });

    expect(deuxieme.status).toBe(409);
    expect(deuxieme.body.code).toBe('REJEU_DETECTE');
  });

  test('jeton ou etudiant_id manquant : 400 explicite, avant toute verification cryptographique', async () => {
    const jeton = generateSessionToken(seanceId, SALLE_ID);

    const sansEtudiant = await request(app).post('/api/scans').send({ jeton });
    expect(sansEtudiant.status).toBe(400);

    const sansJeton = await request(app).post('/api/scans').send({ etudiant_id: ETUDIANT_ID });
    expect(sansJeton.status).toBe(400);
  });
});
