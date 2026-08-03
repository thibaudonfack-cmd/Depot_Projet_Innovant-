// tests/rectification.test.js
// Demandes de rectification, modification manuelle et journal d'audit.

const crypto = require('crypto');
const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter } = require('./aide-auth');

const UF_ID = '11111111-1111-1111-1111-111111111111';
const SALLE_ID = '22222222-2222-2222-2222-222222222222';
const AMARA = '33333333-3333-3333-3333-333333333331';
const BILAL = '33333333-3333-3333-3333-333333333332';

let cookieFormateur, cookieAmara;
let presenceOuverte, presenceFermee, presenceBilal;

/** Cree une seance dont la fin prevue est decalee de `heures` par rapport a maintenant. */
async function creerSeance(decalageHeures) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO seances (id, uf_id, salle_id, heure_debut_prevue, heure_fin_prevue)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [id, UF_ID, SALLE_ID, decalageHeures - 3, decalageHeures]
  );
  return id;
}

async function creerPresence(seanceId, etudiantId, avecDepart) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO presences (id, seance_id, etudiant_id, heure_arrivee, heure_depart)
     VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL 3 HOUR), ${avecDepart ? 'NOW()' : 'NULL'})`,
    [id, seanceId, etudiantId]
  );
  return id;
}

beforeAll(async () => {
  cookieFormateur = (await connecter('formateur')).cookie;
  cookieAmara = (await connecter('amara')).cookie;

  // Seance TERMINEE il y a 1 h : la fenetre de 24 h est donc ouverte.
  const seanceRecente = await creerSeance(-1);
  presenceFermee = await creerPresence(seanceRecente, AMARA, true);
  presenceBilal = await creerPresence(seanceRecente, BILAL, true);

  // Seance terminee il y a 30 h : fenetre FERMEE.
  const seanceAncienne = await creerSeance(-30);
  presenceOuverte = await creerPresence(seanceAncienne, AMARA, true);
});

afterAll(async () => {
  await pool.query('DELETE FROM sessions');
  await pool.end();
});

describe('POST /api/rectifications (etudiant)', () => {
  test('une demande dans la fenetre de 24 h est acceptee (201)', async () => {
    const reponse = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({ presence_id: presenceFermee, motif: 'Je suis parti a 11h, pas a 12h.' });

    expect(reponse.status).toBe(201);
    expect(reponse.body.statut).toBe('en_attente');
  });

  test('une seconde demande en attente est refusee (409)', async () => {
    // Sans ce controle, un etudiant pourrait en empiler plusieurs et le
    // formateur ne saurait laquelle traiter.
    const reponse = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({ presence_id: presenceFermee, motif: 'Encore une.' });
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('DEMANDE_DEJA_EN_ATTENTE');
  });

  test('LA FENETRE EST VERIFIEE PAR LE SERVEUR : au-dela de 24 h, refus (403)', async () => {
    // Le controle equivalent cote navigateur n'est qu'un confort visuel :
    // appeler l'API directement le contourne. C'est cette verification-ci
    // qui fait foi.
    const reponse = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({ presence_id: presenceOuverte, motif: 'Trop tard.' });

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('DELAI_EXPIRE');
  });

  test("on ne peut pas soumettre pour la presence d'un autre etudiant (404)", async () => {
    const reponse = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({ presence_id: presenceBilal, motif: 'Pas la mienne.' });
    // 404 et non 403 : ne pas confirmer l'existence de la presence d'autrui.
    expect(reponse.status).toBe(404);
  });

  test('motif manquant : 400', async () => {
    const reponse = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({ presence_id: presenceFermee, motif: '   ' });
    expect(reponse.status).toBe(400);
  });

  test('un formateur ne peut pas soumettre de demande (403)', async () => {
    const reponse = await request(app)
      .post('/api/rectifications').set('Cookie', cookieFormateur)
      .send({ presence_id: presenceFermee, motif: 'x' });
    expect(reponse.status).toBe(403);
  });
});

describe('PUT /api/presences/:id (formateur)', () => {
  test('LE MOTIF EST OBLIGATOIRE (400 sans lui)', async () => {
    const reponse = await request(app)
      .put(`/api/presences/${presenceBilal}`).set('Cookie', cookieFormateur)
      .send({ heure_depart: new Date().toISOString() });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('MOTIF_REQUIS');
  });

  test('la modification ecrit dans le journal d\'audit, dans la meme transaction', async () => {
    // Lecture en CHAINE et non en Date : comparer une Date JavaScript (rendue
    // en heure locale par toString()) a la valeur du journal (une chaine UTC)
    // ferait echouer l'assertion pour une simple difference de
    // representation, alors que les deux designent le meme instant.
    const [avant] = await pool.query(
      "SELECT DATE_FORMAT(heure_depart, '%Y-%m-%d %H:%i:%s') AS heure_depart FROM presences WHERE id = ?",
      [presenceBilal]
    );

    // Ici l'ISO cote client est LEGITIME : c'est exactement ce que le
    // navigateur enverra, et le controleur le convertit en UTC. Le point de
    // reference est donc coherent de bout en bout, contrairement au cas
    // ci-dessous ou une valeur etait ecrite directement en base.
    const [[{ depart }]] = await pool.query(
      "SELECT DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 30 MINUTE), '%Y-%m-%dT%H:%i:%s') AS depart"
    );
    const reponse = await request(app)
      .put(`/api/presences/${presenceBilal}`).set('Cookie', cookieFormateur)
      .send({ heure_depart: `${depart}Z`, motif: 'Depart anticipe, rendez-vous medical.' });

    expect(reponse.status).toBe(200);

    const [journal] = await pool.query(
      `SELECT champ, valeur_avant, valeur_apres, motif, origine, role_auteur
       FROM db_attestations.journal_modifications
       WHERE table_cible = 'presences' AND ligne_id = ?
       ORDER BY horodatage DESC LIMIT 1`,
      [presenceBilal]
    );

    expect(journal).toHaveLength(1);
    expect(journal[0].champ).toBe('heure_depart');
    expect(journal[0].motif).toBe('Depart anticipe, rendez-vous medical.');
    expect(journal[0].origine).toBe('formateur');
    expect(journal[0].role_auteur).toBe('formateur');
    // La valeur precedente est conservee : c'est ce qui permet de reconstituer
    // l'historique lors d'un controle.
    expect(journal[0].valeur_avant).not.toBeNull();
    expect(journal[0].valeur_avant).toBe(avant[0].heure_depart);
  });

  test('une heure de depart anterieure a l\'arrivee est refusee (400)', async () => {
    const reponse = await request(app)
      .put(`/api/presences/${presenceBilal}`).set('Cookie', cookieFormateur)
      .send({
        heure_depart: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
        motif: 'Test de coherence.',
      });
    expect(reponse.status).toBe(400);
  });

  test('un etudiant ne peut pas modifier une presence (403)', async () => {
    const reponse = await request(app)
      .put(`/api/presences/${presenceBilal}`).set('Cookie', cookieAmara)
      .send({ heure_depart: new Date().toISOString(), motif: 'Tentative.' });
    expect(reponse.status).toBe(403);
  });
});

describe('PATCH /api/rectifications/:id (formateur)', () => {
  let demandeId;

  beforeAll(async () => {
    const [lignes] = await pool.query(
      "SELECT id FROM demandes_rectification WHERE presence_id = ? AND statut = 'en_attente' LIMIT 1",
      [presenceFermee]
    );
    demandeId = lignes[0].id;
  });

  test('le motif de decision est obligatoire, y compris pour un refus (400)', async () => {
    const reponse = await request(app)
      .patch(`/api/rectifications/${demandeId}`).set('Cookie', cookieFormateur)
      .send({ decision: 'refusee' });
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('MOTIF_REQUIS');
  });

  test('accepter applique les heures demandees ET consigne le changement', async () => {
    // L'heure demandee est calculee PAR LA BASE (DATE_SUB(NOW(), ...)) et non
    // cote JavaScript. Une premiere version utilisait
    // new Date(...).toISOString(), donc de l'UTC, alors que heure_arrivee
    // avait ete posee avec NOW() de MySQL, exprime dans le fuseau de la
    // session. Selon le decalage, le depart demande se retrouvait AVANT
    // l'arrivee et le controle de coherence rejetait a juste titre. Melanger
    // les deux horloges est exactement le piege que ce projet cherche a
    // eviter ; le test ne doit pas l'introduire lui-meme.
    await pool.query(
      'UPDATE demandes_rectification SET heure_depart_demandee = DATE_SUB(NOW(), INTERVAL 90 MINUTE) WHERE id = ?',
      [demandeId]
    );

    const reponse = await request(app)
      .patch(`/api/rectifications/${demandeId}`).set('Cookie', cookieFormateur)
      .send({ decision: 'acceptee', motif_decision: 'Verifie avec le registre papier.' });

    expect(reponse.status).toBe(200);

    const [presence] = await pool.query(
      'SELECT source FROM presences WHERE id = ?', [presenceFermee]
    );
    expect(presence[0].source).toBe('rectification_validee');

    const [journal] = await pool.query(
      `SELECT origine, motif FROM db_attestations.journal_modifications
       WHERE ligne_id = ? ORDER BY horodatage DESC LIMIT 1`,
      [presenceFermee]
    );
    expect(journal[0].origine).toBe('rectification');
    expect(journal[0].motif).toBe('Verifie avec le registre papier.');
  });

  test('une demande deja traitee ne peut pas l\'etre a nouveau (409)', async () => {
    const reponse = await request(app)
      .patch(`/api/rectifications/${demandeId}`).set('Cookie', cookieFormateur)
      .send({ decision: 'refusee', motif_decision: 'Deuxieme tentative.' });
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('DEJA_TRAITEE');
  });
});

describe("Inalterabilite du journal d'audit", () => {
  test("l'application ne peut ni modifier ni supprimer une entree du journal", async () => {
    // Garantie portee par les PRIVILEGES MySQL, pas par la discipline du
    // code : c'est ce qui donne sa valeur probatoire au journal.
    await expect(
      pool.query('DELETE FROM db_attestations.journal_modifications LIMIT 1')
    ).rejects.toThrow();

    await expect(
      pool.query("UPDATE db_attestations.journal_modifications SET motif = 'falsifie'")
    ).rejects.toThrow();
  });
});
