// tests/seance.test.js
// Tests d'integration de la creation de seance (RF-01, Etape 7d).
//
// Commande : docker compose exec backend npm test

const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter } = require('./aide-auth');

const UF_ID = '11111111-1111-1111-1111-111111111111';
const SALLE_ID = '22222222-2222-2222-2222-222222222222';
const INEXISTANT = '00000000-0000-0000-0000-000000000000';

let cookieFormateur;
let cookieEtudiant;
const seancesCreees = [];

beforeAll(async () => {
  cookieFormateur = (await connecter('formateur')).cookie;
  cookieEtudiant = (await connecter('amara')).cookie;
});

afterAll(async () => {
  for (const id of seancesCreees) {
    await pool.query('DELETE FROM seances WHERE id = ?', [id]);
  }
  await pool.query('DELETE FROM sessions');
  await pool.end();
});

async function creer(cookie, corps) {
  const reponse = await request(app).post('/api/seances').set('Cookie', cookie).send(corps);
  if (reponse.status === 201) seancesCreees.push(reponse.body.seance.id);
  return reponse;
}

describe('POST /api/seances — creation de seance (RF-01)', () => {
  test('un formateur cree une seance avec ses heures prevues (201)', async () => {
    const debut = '2026-09-01T09:00:00.000Z';
    const fin = '2026-09-01T12:00:00.000Z';

    const reponse = await creer(cookieFormateur, {
      uf_id: UF_ID, salle_id: SALLE_ID,
      heure_debut_prevue: debut, heure_fin_prevue: fin,
    });

    expect(reponse.status).toBe(201);
    expect(reponse.body.seance.statut).toBe('ouverte');
    expect(reponse.body.seance.uf_id).toBe(UF_ID);

    // Verification EN BASE que les heures sont bien stockees en UTC : le
    // client a envoye 09:00Z, la colonne DATETIME doit contenir 09:00 et non
    // une valeur decalee par le fuseau de la connexion.
    const [lignes] = await pool.query(
      "SELECT DATE_FORMAT(heure_debut_prevue, '%Y-%m-%d %H:%i:%s') AS debut, DATE_FORMAT(heure_fin_prevue, '%Y-%m-%d %H:%i:%s') AS fin FROM seances WHERE id = ?",
      [reponse.body.seance.id]
    );
    expect(lignes[0].debut).toBe('2026-09-01 09:00:00');
    expect(lignes[0].fin).toBe('2026-09-01 12:00:00');
  });

  test('les heures prevues sont facultatives (compatibilite avec les seances anterieures)', async () => {
    const reponse = await creer(cookieFormateur, { uf_id: UF_ID, salle_id: SALLE_ID });
    expect(reponse.status).toBe(201);
    expect(reponse.body.seance.heure_debut_prevue).toBeNull();
  });

  test('une heure de fin anterieure au debut est refusee (400), avant toute ecriture', async () => {
    const reponse = await creer(cookieFormateur, {
      uf_id: UF_ID, salle_id: SALLE_ID,
      heure_debut_prevue: '2026-09-01T12:00:00.000Z',
      heure_fin_prevue: '2026-09-01T09:00:00.000Z',
    });
    expect(reponse.status).toBe(400);

    // Aucune seance ne doit avoir ete creee malgre l'echec.
    const [lignes] = await pool.query(
      "SELECT id FROM seances WHERE heure_debut_prevue = '2026-09-01 12:00:00'"
    );
    expect(lignes).toHaveLength(0);
  });

  test('une date inexploitable est refusee (400)', async () => {
    const reponse = await creer(cookieFormateur, {
      uf_id: UF_ID, salle_id: SALLE_ID, heure_debut_prevue: 'pas-une-date',
    });
    expect(reponse.status).toBe(400);
  });

  test('uf_id ou salle_id manquant : 400', async () => {
    expect((await creer(cookieFormateur, { salle_id: SALLE_ID })).status).toBe(400);
    expect((await creer(cookieFormateur, { uf_id: UF_ID })).status).toBe(400);
  });

  test('uf_id inconnu : 400 (violation de cle etrangere)', async () => {
    const reponse = await creer(cookieFormateur, { uf_id: INEXISTANT, salle_id: SALLE_ID });
    expect(reponse.status).toBe(400);
  });

  test('sans session : 401', async () => {
    const reponse = await request(app)
      .post('/api/seances').send({ uf_id: UF_ID, salle_id: SALLE_ID });
    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('NON_AUTHENTIFIE');
  });

  test('un etudiant ne peut pas ouvrir de seance (403)', async () => {
    // Point central de l'Etape 7d cote securite : ouvrir une seance est une
    // prerogative du formateur. Un etudiant qui le pourrait genererait ses
    // propres jetons et validerait sa presence sans cours.
    const reponse = await creer(cookieEtudiant, { uf_id: UF_ID, salle_id: SALLE_ID });
    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('ROLE_INSUFFISANT');
  });
});
