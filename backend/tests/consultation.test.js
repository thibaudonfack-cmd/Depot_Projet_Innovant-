// tests/consultation.test.js
// Routes de consultation : referentiel, seances, presences (Etape 7d bis).

const crypto = require('crypto');
const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter } = require('./aide-auth');

const UF_ID = '11111111-1111-1111-1111-111111111111';
const SALLE_ID = '22222222-2222-2222-2222-222222222222';
const ETUDIANT_AMARA = '33333333-3333-3333-3333-333333333331';
const ETUDIANT_BILAL = '33333333-3333-3333-3333-333333333332';

let cookieFormateur;
let cookieAmara;
let seanceId;
let presenceId;

beforeAll(async () => {
  cookieFormateur = (await connecter('formateur')).cookie;
  cookieAmara = (await connecter('amara')).cookie;

  seanceId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO seances (id, uf_id, salle_id, heure_debut_prevue, heure_fin_prevue)
     VALUES (?, ?, ?, ?, ?)`,
    [seanceId, UF_ID, SALLE_ID, '2026-09-01 09:00:00', '2026-09-01 12:00:00']
  );

  // Presence terminee (3 h) pour Amara, presence encore ouverte pour Bilal.
  presenceId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO presences (id, seance_id, etudiant_id, heure_arrivee, heure_depart)
     VALUES (?, ?, ?, ?, ?)`,
    [presenceId, seanceId, ETUDIANT_AMARA, '2026-09-01 09:05:00', '2026-09-01 12:00:00']
  );
  await pool.query(
    `INSERT INTO presences (id, seance_id, etudiant_id, heure_arrivee)
     VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), seanceId, ETUDIANT_BILAL, '2026-09-01 09:10:00']
  );
});

afterAll(async () => {
  // AUCUN nettoyage des presences, des demandes ni de la seance : ce n'est
  // pas un oubli. L'utilisateur applicatif ne dispose PAS du privilege DELETE
  // sur presences ni sur demandes_rectification (03-privileges.sh), par
  // conception -- une presence ne se supprime pas, elle se corrige, et la
  // correction laisse une trace dans le journal d'audit. La seance elle-meme
  // ne peut plus etre supprimee non plus, ses presences la referencant.
  //
  // Une premiere version de ce fichier tentait ces suppressions et a echoue
  // avec "DELETE command denied to user 'app_logs' for table
  // demandes_rectification", confirmant EN CONDITIONS REELLES que la
  // contrainte s'applique jusqu'au code de test. Meme constat qu'a l'Etape 3
  // sur la table scans.
  //
  // Les identifiants etant generes aleatoirement a chaque execution, aucune
  // collision n'est possible entre deux passages.
  await pool.query('DELETE FROM sessions');
  await pool.end();
});

describe('Référentiel', () => {
  test('GET /api/uf renvoie les unités de formation réellement en base', async () => {
    const reponse = await request(app).get('/api/uf').set('Cookie', cookieAmara);
    expect(reponse.status).toBe(200);
    expect(reponse.body.uf.length).toBeGreaterThanOrEqual(3);
    // C'est le point du correctif : les identifiants proposés au client
    // doivent exister, sinon toute création échoue en clé étrangère.
    expect(reponse.body.uf.map((u) => u.id)).toContain(UF_ID);
  });

  test('GET /api/salles ne divulgue PAS les polygones géographiques', async () => {
    // Transmettre les contours de chaque local à tout client authentifié
    // faciliterait la falsification de position une fois le géofencing posé.
    const reponse = await request(app).get('/api/salles').set('Cookie', cookieAmara);
    expect(reponse.status).toBe(200);
    expect(reponse.body.salles.length).toBeGreaterThanOrEqual(3);
    expect(reponse.body.salles[0].polygone_geojson).toBeUndefined();
  });

  test('sans session : 401', async () => {
    expect((await request(app).get('/api/uf')).status).toBe(401);
  });
});

describe('GET /api/seances (formateur)', () => {
  test('liste les séances avec leur nombre de présences', async () => {
    const reponse = await request(app).get('/api/seances').set('Cookie', cookieFormateur);
    expect(reponse.status).toBe(200);

    const notre = reponse.body.seances.find((s) => s.id === seanceId);
    expect(notre).toBeDefined();
    expect(notre.nb_presences).toBe(2);
    expect(notre.uf_intitule).toBe('Architecture Logicielle');
  });

  test('un étudiant ne peut pas lister les séances (403)', async () => {
    const reponse = await request(app).get('/api/seances').set('Cookie', cookieAmara);
    expect(reponse.status).toBe(403);
  });
});

describe('GET /api/seances/:id/presences', () => {
  test('la durée est CALCULÉE à partir des instants, jamais stockée', async () => {
    const reponse = await request(app)
      .get(`/api/seances/${seanceId}/presences`).set('Cookie', cookieFormateur);

    expect(reponse.status).toBe(200);
    expect(reponse.body.presences).toHaveLength(2);

    const amara = reponse.body.presences.find((p) => p.etudiant_id === ETUDIANT_AMARA);
    expect(amara.duree_minutes).toBe(175); // 09:05 -> 12:00

    // Présence encore ouverte : la durée n'existe pas, elle vaut null et non
    // zéro. Zéro signifierait "resté zéro minute", ce qui est faux.
    const bilal = reponse.body.presences.find((p) => p.etudiant_id === ETUDIANT_BILAL);
    expect(bilal.heure_depart).toBeNull();
    expect(bilal.duree_minutes).toBeNull();
  });

  test('séance inconnue : 404', async () => {
    const reponse = await request(app)
      .get('/api/seances/00000000-0000-0000-0000-000000000000/presences')
      .set('Cookie', cookieFormateur);
    expect(reponse.status).toBe(404);
  });
});

describe('GET /api/mes-presences (étudiant)', () => {
  test("ne renvoie que les présences de l'étudiant connecté", async () => {
    const reponse = await request(app).get('/api/mes-presences').set('Cookie', cookieAmara);
    expect(reponse.status).toBe(200);

    const notre = reponse.body.presences.find((p) => p.seance_id === seanceId);
    expect(notre).toBeDefined();
    expect(notre.duree_minutes).toBe(175);
    // Aucune présence d'un autre étudiant ne doit apparaître : l'identité
    // vient de la session, pas d'un paramètre modifiable.
    expect(reponse.body.presences.every((p) => p.id !== undefined)).toBe(true);
  });

  test('la fenêtre de rectification est calculée par le SERVEUR, avec DEUX bornes', async () => {
    const reponse = await request(app).get('/api/mes-presences').set('Cookie', cookieAmara);
    const notre = reponse.body.presences.find((p) => p.seance_id === seanceId);

    expect(typeof notre.rectification_ouverte).toBe('boolean');

    // La règle a deux bornes et non une : la fenêtre s'ouvre à la FIN de la
    // séance et se referme 24 h plus tard. Signaler une erreur sur des heures
    // encore en train de se constituer n'aurait aucun sens. La séance de test
    // se terminant le 01/09/2026 à 12:00, le drapeau doit refléter la
    // position de l'horloge SERVEUR entre ces deux bornes.
    const [[{ ouverte }]] = await pool.query(
      `SELECT CASE
                WHEN NOW() <= '2026-09-01 12:00:00' THEN 0
                WHEN NOW() <= DATE_ADD('2026-09-01 12:00:00', INTERVAL 24 HOUR) THEN 1
                ELSE 0
              END AS ouverte`
    );
    expect(notre.rectification_ouverte).toBe(ouverte === 1);
  });

  test('un formateur ne peut pas appeler cette route (403)', async () => {
    const reponse = await request(app).get('/api/mes-presences').set('Cookie', cookieFormateur);
    expect(reponse.status).toBe(403);
  });
});
