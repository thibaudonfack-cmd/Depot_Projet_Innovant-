// tests/health.test.js
// Test d'integration (Supertest) retroactif de l'Etape 1. Necessite un
// MySQL reellement joignable (variables MYSQL_* de l'environnement, lues par
// backend/src/config/db.js) -- en local via docker-compose, en CI via le
// service ephemere mysql:8.0 (cf. .gitlab-ci.yml).
//
// Supertest recoit directement l'objet Express `app` (pas `httpServer`) : il
// ouvre et ferme lui-meme un serveur HTTP ephemere par requete, sans jamais
// appeler app.listen() sur le port applicatif reel -- aucun conflit de port
// possible entre suites de test, aucun serveur qui traine apres les tests.

const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');

// Le pool mysql2 est cree au chargement de src/config/db.js (importe ici
// via server.js -> transitivement). Sans cette fermeture explicite, Jest
// resterait bloque sur un handle TCP ouvert en fin de suite (cf.
// jest.config.js, detectOpenHandles: true, qui aurait signale exactement ce
// probleme si ce afterAll etait retire).
afterAll(async () => {
  await pool.end();
});

describe('GET /api/health', () => {
  test('repond 200, sante applicative pure sans dependance a la base', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      message: 'Backend is running securely',
    });
  });
});

describe('GET /api/db-health', () => {
  test('repond 200 et confirme la connexion + le schema initialise avec le seed attendu', async () => {
    const response = await request(app).get('/api/db-health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('connected');
    expect(response.body.schema_initialized).toBe(true);
    // Valeur exacte du seed (02-seed.sql, 4 etudiants de demonstration) --
    // une valeur differente signalerait soit un seed non charge, soit un
    // seed modifie sans mise a jour de ce test (dans les deux cas, un signal
    // utile plutot qu'une assertion permissive qui masquerait le probleme).
    expect(response.body.etudiants_count).toBe(8);
  });
});
