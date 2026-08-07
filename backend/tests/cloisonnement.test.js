// tests/cloisonnement.test.js
// Isolation multi-tenants entre formateurs (Etape 10).
//
// Ces tests portent sur une faille de CONFIDENTIALITE, pas sur un confort
// d'affichage : un formateur qui consulte les presences d'etudiants qu'il
// n'encadre pas accede a des donnees personnelles sans finalite (RGPD
// art. 5.1.b).
//
// PRINCIPE DE CES TESTS : ils n'interrogent JAMAIS l'interface. Masquer une
// UF dans une liste deroulante ne protege de rien -- il suffit de poster
// l'identifiant a la main. Chaque route est donc appelee directement avec
// l'identifiant d'une ressource hors perimetre.

const crypto = require('crypto');
const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter } = require('./aide-auth');

// Seed (02-seed.sql) :
//   Sophie Lambert -> Architecture Logicielle + Developpement Web
//   Marc Dupont    -> Developpement Web + Cybersecurite
//   Nadia Cherif   -> DevOps UNIQUEMENT
const UF_ARCHI = '11111111-1111-1111-1111-111111111111';
const UF_WEB = '11111111-1111-1111-1111-111111111112';
const UF_CYBER = '11111111-1111-1111-1111-111111111113';
const UF_DEVOPS = '11111111-1111-1111-1111-111111111114';
const SALLE = '22222222-2222-2222-2222-222222222222';
const AMARA = '33333333-3333-3333-3333-333333333331';

let sophie, nadia, marc, etudiant;
let seanceSophie, seanceNadia, presenceSophie;

async function creerSeance(ufId, decalageFinHeures = -2) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO seances (id, uf_id, salle_id, heure_debut_prevue, heure_fin_prevue)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [id, ufId, SALLE, decalageFinHeures - 3, decalageFinHeures]
  );
  return id;
}

beforeAll(async () => {
  sophie = (await connecter('formateur')).cookie;
  marc = (await connecter('marc')).cookie;
  nadia = (await connecter('nadia')).cookie;
  etudiant = (await connecter('amara')).cookie;

  seanceSophie = await creerSeance(UF_ARCHI);
  seanceNadia = await creerSeance(UF_DEVOPS);

  presenceSophie = crypto.randomUUID();
  await pool.query(
    `INSERT INTO presences (id, seance_id, etudiant_id, heure_arrivee)
     SELECT ?, s.id, ?, s.heure_debut_prevue FROM seances s WHERE s.id = ?`,
    [presenceSophie, AMARA, seanceSophie]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM sessions');
  await pool.end();
});

// ==========================================================================
describe('Liste des UF', () => {
  test('chaque formateur ne recoit QUE ses unites de formation', async () => {
    const rNadia = await request(app).get('/api/uf?toutes=1').set('Cookie', nadia);
    const ids = rNadia.body.uf.map((u) => u.id);

    expect(ids).toContain(UF_DEVOPS);
    expect(ids).not.toContain(UF_ARCHI);
    expect(ids).not.toContain(UF_WEB);
    expect(ids).not.toContain(UF_CYBER);
    expect(rNadia.body.uf).toHaveLength(1);
  });

  test('une UF CO-ENCADREE apparait chez les DEUX formateurs', async () => {
    // Le cas d'usage qui a motive la table de liaison plutot qu'un simple
    // `createur_id` : deux formateurs se partagent theorie et laboratoire.
    const rSophie = await request(app).get('/api/uf?toutes=1').set('Cookie', sophie);
    const rMarc = await request(app).get('/api/uf?toutes=1').set('Cookie', marc);

    expect(rSophie.body.uf.map((u) => u.id)).toContain(UF_WEB);
    expect(rMarc.body.uf.map((u) => u.id)).toContain(UF_WEB);
  });

  test('EXISTS et non JOIN : une UF co-encadree n\'apparait qu\'UNE fois', async () => {
    // Avec une jointure, l'UF partagee produirait une ligne par affectation.
    const r = await request(app).get('/api/uf?toutes=1').set('Cookie', sophie);
    const web = r.body.uf.filter((u) => u.id === UF_WEB);
    expect(web).toHaveLength(1);
  });

  test('un ETUDIANT continue de recevoir la liste complete', async () => {
    // Elle ne contient aucune donnee personnelle, et il en a besoin pour
    // lire l'intitule de ses propres seances.
    const r = await request(app).get('/api/uf?toutes=1').set('Cookie', etudiant);
    expect(r.body.uf.length).toBeGreaterThanOrEqual(4);
  });
});

// ==========================================================================
describe('Seances', () => {
  test('la liste ne montre que les seances de ses UF', async () => {
    const r = await request(app).get('/api/seances').set('Cookie', nadia);
    const ids = r.body.seances.map((s) => s.id);
    expect(ids).toContain(seanceNadia);
    expect(ids).not.toContain(seanceSophie);
  });

  test('appeler DIRECTEMENT les presences d\'une seance hors perimetre : 404', async () => {
    // Le test qui compte : l'identifiant est connu, l'interface est
    // contournee, et l'acces doit tout de meme etre refuse.
    const r = await request(app)
      .get(`/api/seances/${seanceSophie}/presences`).set('Cookie', nadia);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('HORS_PERIMETRE');
  });

  test('404 et NON 403 : ne pas confirmer l\'existence de la ressource', async () => {
    // Repondre "interdit" apprendrait a un formateur curieux quelles UF
    // existent et combien de seances chacune compte. "Introuvable" ne
    // distingue pas l'absence de l'interdiction.
    const inexistante = await request(app)
      .get(`/api/seances/${crypto.randomUUID()}/presences`).set('Cookie', nadia);
    const horsPerimetre = await request(app)
      .get(`/api/seances/${seanceSophie}/presences`).set('Cookie', nadia);
    expect(horsPerimetre.status).toBe(inexistante.status);
  });

  test('le titulaire, lui, y accede normalement', async () => {
    // Contre-epreuve indispensable : un filtre qui bloque tout le monde
    // passerait tous les tests negatifs.
    const r = await request(app)
      .get(`/api/seances/${seanceSophie}/presences`).set('Cookie', sophie);
    expect(r.status).toBe(200);
    expect(r.body.presences.length).toBeGreaterThan(0);
  });

  test('ouvrir une seance sur l\'UF d\'un collegue est refuse', async () => {
    // Sans ce controle, un formateur ferait apparaitre chez un collegue un
    // evenement que celui-ci n'a pas programme.
    const r = await request(app).post('/api/seances').set('Cookie', nadia)
      .send({ uf_id: UF_ARCHI, salle_id: SALLE });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('HORS_PERIMETRE');
  });
});

// ==========================================================================
describe('Rapports et bilans', () => {
  test('le rapport de seance d\'un collegue est inaccessible', async () => {
    const r = await request(app)
      .get(`/api/seances/${seanceSophie}/rapport`).set('Cookie', nadia);
    expect(r.status).toBe(404);
  });

  test('LE BILAN D\'UNE UF NON ENCADREE EST INACCESSIBLE', async () => {
    // La route la plus sensible du role formateur : elle expose les heures
    // cumulees de TOUS les inscrits.
    const r = await request(app)
      .get(`/api/uf/${UF_ARCHI}/rapport-global`).set('Cookie', nadia);
    expect(r.status).toBe(404);
    expect(r.body.etudiants).toBeUndefined();
  });

  test('le titulaire obtient bien son bilan', async () => {
    const r = await request(app)
      .get(`/api/uf/${UF_ARCHI}/rapport-global`).set('Cookie', sophie);
    expect(r.status).toBe(200);
    expect(r.body.etudiants.length).toBeGreaterThan(0);
  });

  test('les demandes de rectification d\'une seance hors perimetre : 404', async () => {
    // Elles contiennent le motif redige librement par l'etudiant, souvent
    // d'ordre personnel.
    const r = await request(app)
      .get(`/api/seances/${seanceSophie}/rectifications`).set('Cookie', nadia);
    expect(r.status).toBe(404);
  });
});

// ==========================================================================
describe('Ecritures hors perimetre', () => {
  test('modifier l\'horaire d\'un etudiant qu\'on n\'encadre pas : 404', async () => {
    const r = await request(app)
      .put(`/api/presences/${presenceSophie}`).set('Cookie', nadia)
      .send({ heure_depart: null, motif: 'Tentative hors perimetre.' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('HORS_PERIMETRE');
  });

  test('CLOTURER une UF qu\'on n\'encadre pas : 404', async () => {
    // La pire consequence possible d'une faille de cloisonnement : elle ne
    // se repare pas.
    const r = await request(app)
      .post(`/api/uf/${UF_ARCHI}/cloture-rgpd`).set('Cookie', nadia)
      .send({ confirmation: 'CLOTURER' });
    expect(r.status).toBe(404);

    // Verification en base : rien n'a ete detruit.
    const [ufs] = await pool.query('SELECT date_cloture_rgpd FROM uf WHERE id = ?', [UF_ARCHI]);
    expect(ufs[0].date_cloture_rgpd).toBeNull();
  });

  test('trancher la demande d\'un etudiant hors perimetre : 404', async () => {
    const demandeId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO demandes_rectification (id, presence_id, motif, statut)
       VALUES (?, ?, 'Test cloisonnement.', 'en_attente')`,
      [demandeId, presenceSophie]
    );

    const r = await request(app)
      .patch(`/api/rectifications/${demandeId}`).set('Cookie', nadia)
      .send({ decision: 'acceptee', motif_decision: 'Tentative hors perimetre.' });
    expect(r.status).toBe(404);

    const [d] = await pool.query('SELECT statut FROM demandes_rectification WHERE id = ?', [demandeId]);
    expect(d[0].statut).toBe('en_attente');
  });
});
