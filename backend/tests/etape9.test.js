// tests/etape9.test.js
// Bilan global par UF, cloture RGPD, et bornes de la rectification (Etape 9).
//
// Ces trois sujets sont regroupes parce qu'ils partagent le meme jeu de
// donnees : une UF complete, avec des seances terminees et des presences.
// Les separer obligerait a reconstruire trois fois le meme decor.

const crypto = require('crypto');
const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter } = require('./aide-auth');

const SALLE_ID = '22222222-2222-2222-2222-222222222222';
const AMARA = '33333333-3333-3333-3333-333333333331';
const BILAL = '33333333-3333-3333-3333-333333333332';

let cookieFormateur, cookieAmara;
let ufBilan, ufCloture;
let seanceA, seanceB, seanceEnCours;
let presenceAmaraA;

/** UF creee a la volee : la cloture est irreversible, chaque test veut la sienne. */
async function creerUf(intitule) {
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO uf (id, intitule) VALUES (?, ?)', [id, intitule]);
  return id;
}

async function creerSeance(ufId, decalageFinHeures) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO seances (id, uf_id, salle_id, heure_debut_prevue, heure_fin_prevue)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [id, ufId, SALLE_ID, decalageFinHeures - 3, decalageFinHeures]
  );
  return id;
}

async function creerPresence(seanceId, etudiantId, avecDepart = false) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO presences
       (id, seance_id, etudiant_id, heure_arrivee, heure_depart,
        latitude_scan, longitude_scan, precision_m, distance_m, position_coherente)
     SELECT ?, s.id, ?, s.heure_debut_prevue,
            ${avecDepart ? 's.heure_fin_prevue' : 'NULL'},
            50.46700000, 4.87180000, 25, 12, 1
       FROM seances s WHERE s.id = ?`,
    [id, etudiantId, seanceId]
  );
  return id;
}

beforeAll(async () => {
  cookieFormateur = (await connecter('formateur')).cookie;
  cookieAmara = (await connecter('amara')).cookie;

  ufBilan = await creerUf('Test bilan global');
  ufCloture = await creerUf('Test cloture RGPD');

  for (const etudiantId of [AMARA, BILAL]) {
    await pool.query('INSERT INTO inscriptions (etudiant_id, uf_id) VALUES (?, ?), (?, ?)',
      [etudiantId, ufBilan, etudiantId, ufCloture]);
  }

  // Deux seances terminees + une en cours : le denominateur doit ignorer
  // la troisieme.
  seanceA = await creerSeance(ufBilan, -5);
  seanceB = await creerSeance(ufBilan, -2);
  seanceEnCours = await creerSeance(ufBilan, 2);

  // Amara : presente aux deux seances terminees (une avec depart pointe).
  presenceAmaraA = await creerPresence(seanceA, AMARA, true);
  await creerPresence(seanceB, AMARA, false);
  // Bilal : presente a une seule.
  await creerPresence(seanceA, BILAL, true);
});

afterAll(async () => {
  await pool.query('DELETE FROM sessions');
  await pool.end();
});

// ==========================================================================
describe('GET /api/uf/:id/rapport-global', () => {
  test('le denominateur ne compte que les seances TERMINEES', async () => {
    // Une seance en cours n'a pas de duree definitive. L'inclure ferait
    // varier le bilan d'une minute a l'autre : un formateur qui l'imprime a
    // 10 h obtiendrait autre chose qu'a 11 h pour les memes faits.
    const r = await request(app)
      .get(`/api/uf/${ufBilan}/rapport-global`).set('Cookie', cookieFormateur);

    expect(r.status).toBe(200);
    expect(r.body.synthese.seances_total).toBe(3);
    expect(r.body.synthese.seances_terminees).toBe(2);
    expect(r.body.etudiants.every((e) => e.seances_prevues === 2)).toBe(true);
  });

  test('le denominateur est COMMUN a tous les etudiants', async () => {
    // Le calculer a partir des lignes de presence donnerait un taux de 100 %
    // a quelqu'un venu une seule fois sur douze seances.
    const r = await request(app)
      .get(`/api/uf/${ufBilan}/rapport-global`).set('Cookie', cookieFormateur);

    const amara = r.body.etudiants.find((e) => e.etudiant_id === AMARA);
    const bilal = r.body.etudiants.find((e) => e.etudiant_id === BILAL);

    expect(amara.presences).toBe(2);
    expect(amara.taux_presence).toBe(100);
    expect(bilal.presences).toBe(1);
    expect(bilal.taux_presence).toBe(50);
    expect(bilal.absences).toBe(1);
  });

  test('un etudiant JAMAIS venu figure au bilan avec 0, pas NULL', async () => {
    // Meme lecon qu'a l'Etape 8. Une case vide dans une colonne d'heures se
    // lit comme une donnee manquante, pas comme une absence totale.
    const ufVide = await creerUf('Test aucun present');
    await pool.query('INSERT INTO inscriptions (etudiant_id, uf_id) VALUES (?, ?)', [AMARA, ufVide]);
    await creerSeance(ufVide, -2);

    const r = await request(app)
      .get(`/api/uf/${ufVide}/rapport-global`).set('Cookie', cookieFormateur);

    expect(r.body.etudiants).toHaveLength(1);
    expect(r.body.etudiants[0].presences).toBe(0);
    expect(r.body.etudiants[0].minutes_validees).toBe(0);
    expect(r.body.etudiants[0].taux_presence).toBe(0);
  });

  test('une UF sans aucune seance terminee ne produit pas NaN', async () => {
    // Division par zero : le taux vaut null, jamais NaN -- qui s'afficherait
    // tel quel dans le tableau.
    const ufNeuve = await creerUf('Test sans seance terminee');
    await pool.query('INSERT INTO inscriptions (etudiant_id, uf_id) VALUES (?, ?)', [AMARA, ufNeuve]);
    await creerSeance(ufNeuve, 5);

    const r = await request(app)
      .get(`/api/uf/${ufNeuve}/rapport-global`).set('Cookie', cookieFormateur);

    expect(r.body.etudiants[0].taux_presence).toBeNull();
    expect(Number.isNaN(r.body.etudiants[0].taux_presence)).toBe(false);
  });

  test('les heures cumulees additionnent bien les seances', async () => {
    const r = await request(app)
      .get(`/api/uf/${ufBilan}/rapport-global`).set('Cookie', cookieFormateur);
    const amara = r.body.etudiants.find((e) => e.etudiant_id === AMARA);
    // Deux seances de 3 h : depart pointe sur l'une, deduit sur l'autre.
    expect(amara.minutes_validees).toBe(360);
    expect(amara.departs_deduits).toBe(1);
  });

  test('un etudiant ne peut pas consulter le bilan (403)', async () => {
    // Il y verrait les heures de tous ses camarades.
    const r = await request(app)
      .get(`/api/uf/${ufBilan}/rapport-global`).set('Cookie', cookieAmara);
    expect(r.status).toBe(403);
  });

  test('UF inconnue : 404', async () => {
    const r = await request(app)
      .get(`/api/uf/${crypto.randomUUID()}/rapport-global`).set('Cookie', cookieFormateur);
    expect(r.status).toBe(404);
  });
});

// ==========================================================================
describe('Rectification : bornes de l\'heure demandee', () => {
  test("l'heure d'ARRIVEE n'est pas contestable (400)", async () => {
    // Elle resulte d'un scan signe : la laisser modifier reviendrait a
    // laisser une declaration libre ecraser une preuve cryptographique.
    const r = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({
        presence_id: presenceAmaraA,
        motif: 'Je pense etre arrive plus tot.',
        heure_arrivee_demandee: new Date().toISOString(),
      });

    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ARRIVEE_NON_CONTESTABLE');
  });

  test('LE TEST CENTRAL : un depart apres la fin prevue est refuse (400)', async () => {
    // Sans cette borne, un etudiant parti a 10 h pourrait demander un depart
    // a 23 h et se voir crediter des heures qui n'ont jamais eu lieu. La
    // fenetre de 24 h rend la manoeuvre naturelle : elle s'ouvre APRES la
    // seance, donc a un moment ou une heure tardive parait plausible.
    const [seances] = await pool.query(
      'SELECT heure_fin_prevue FROM seances WHERE id = ?', [seanceA]
    );
    const troisHeuresApres = new Date(
      new Date(seances[0].heure_fin_prevue).getTime() + 3 * 3600_000
    ).toISOString();

    const r = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({
        presence_id: presenceAmaraA,
        motif: 'Je suis reste plus longtemps que prevu.',
        heure_depart_demandee: troisHeuresApres,
      });

    expect(r.status).toBe(400);
    expect(r.body.code).toBe('DEPART_APRES_FIN_SEANCE');
  });

  test('un depart AVANT la fin prevue est accepte', async () => {
    // Contre-epreuve : la borne ne doit pas bloquer le cas legitime, qui est
    // precisement le depart anticipe.
    const [seances] = await pool.query(
      'SELECT heure_fin_prevue FROM seances WHERE id = ?', [seanceA]
    );
    const uneHeureAvant = new Date(
      new Date(seances[0].heure_fin_prevue).getTime() - 3600_000
    ).toISOString();

    const r = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({
        presence_id: presenceAmaraA,
        motif: 'Je suis parti a 11 h pour un rendez-vous medical.',
        heure_depart_demandee: uneHeureAvant,
      });

    expect(r.status).toBe(201);
  });

  test('un depart ANTERIEUR a l\'arrivee est refuse (400)', async () => {
    const presence = await creerPresence(seanceB, BILAL, false);
    const [p] = await pool.query('SELECT heure_arrivee FROM presences WHERE id = ?', [presence]);
    const avantArrivee = new Date(
      new Date(p[0].heure_arrivee).getTime() - 3600_000
    ).toISOString();

    const cookieBilal = (await connecter('bilal')).cookie;
    const r = await request(app)
      .post('/api/rectifications').set('Cookie', cookieBilal)
      .send({ presence_id: presence, motif: 'Test borne basse.', heure_depart_demandee: avantArrivee });

    expect(r.status).toBe(400);
    expect(r.body.code).toBe('DEPART_AVANT_ARRIVEE');
  });
});

// ==========================================================================
describe('POST /api/uf/:id/cloture-rgpd', () => {
  test('sans confirmation explicite : 400', async () => {
    // Une modale ne protege que d'un clic distrait ; elle ne protege pas d'un
    // appel direct a l'API.
    const r = await request(app)
      .post(`/api/uf/${ufCloture}/cloture-rgpd`).set('Cookie', cookieFormateur).send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CONFIRMATION_MANQUANTE');
  });

  test('un etudiant ne peut pas cloturer (403)', async () => {
    const r = await request(app)
      .post(`/api/uf/${ufCloture}/cloture-rgpd`).set('Cookie', cookieAmara)
      .send({ confirmation: 'CLOTURER' });
    expect(r.status).toBe(403);
  });

  test('LA PURGE : la localisation est detruite, les heures survivent', async () => {
    const seance = await creerSeance(ufCloture, -2);
    const presence = await creerPresence(seance, AMARA, true);
    await pool.query(
      "INSERT INTO scans (id, seance_id, etudiant_id, jti, resultat) VALUES (?, ?, ?, ?, 'valide')",
      [crypto.randomUUID(), seance, AMARA, `jeton-reel-${crypto.randomUUID()}`]
    );

    const [avant] = await pool.query(
      'SELECT latitude_scan, heure_arrivee, heure_depart FROM presences WHERE id = ?', [presence]
    );
    expect(avant[0].latitude_scan).not.toBeNull();

    const r = await request(app)
      .post(`/api/uf/${ufCloture}/cloture-rgpd`).set('Cookie', cookieFormateur)
      .send({ confirmation: 'CLOTURER' });

    expect(r.status).toBe(200);
    expect(r.body.detruit.positions).toBeGreaterThan(0);

    const [apres] = await pool.query(
      `SELECT latitude_scan, longitude_scan, precision_m, distance_m, position_coherente,
              heure_arrivee, heure_depart, etudiant_id
         FROM presences WHERE id = ?`, [presence]
    );
    // Detruit.
    expect(apres[0].latitude_scan).toBeNull();
    expect(apres[0].longitude_scan).toBeNull();
    expect(apres[0].precision_m).toBeNull();
    expect(apres[0].distance_m).toBeNull();
    expect(apres[0].position_coherente).toBeNull();
    // Conserve : c'est l'archive administrative.
    expect(apres[0].etudiant_id).toBe(AMARA);
    expect(apres[0].heure_arrivee).not.toBeNull();
    expect(apres[0].heure_depart).not.toBeNull();
  });

  test('les LIGNES de scans survivent, seul le jti est anonymise', async () => {
    // Supprimer les lignes detruirait la preuve que la presence repose sur
    // des scans, et non sur une saisie manuelle : on affaiblirait l'archive
    // au nom de sa protection.
    const [scans] = await pool.query(
      `SELECT sc.jti FROM scans sc JOIN seances s ON s.id = sc.seance_id WHERE s.uf_id = ?`,
      [ufCloture]
    );
    expect(scans.length).toBeGreaterThan(0);
    for (const scan of scans) {
      expect(scan.jti).toMatch(/^purge:/);
      expect(scan.jti).not.toMatch(/^jeton-reel-/);
    }
  });

  test('la cloture est consignee au journal d\'audit', async () => {
    // Une destruction sans trace serait indefendable devant une inspection.
    const [journal] = await pool.query(
      `SELECT champ, motif, origine FROM db_attestations.journal_modifications
        WHERE table_cible = 'uf' AND ligne_id = ?`, [ufCloture]
    );
    expect(journal).toHaveLength(1);
    expect(journal[0].champ).toBe('date_cloture_rgpd');
    expect(journal[0].motif).toMatch(/minimisation/i);
  });

  test('une UF deja cloturee ne se repurge pas (409)', async () => {
    const r = await request(app)
      .post(`/api/uf/${ufCloture}/cloture-rgpd`).set('Cookie', cookieFormateur)
      .send({ confirmation: 'CLOTURER' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DEJA_CLOTUREE');
  });

  test('VERROU : plus aucune rectification apres cloture (409)', async () => {
    // Une archive dont le contenu reste modifiable n'est pas une archive.
    const [presences] = await pool.query(
      `SELECT p.id FROM presences p JOIN seances s ON s.id = p.seance_id
        WHERE s.uf_id = ? AND p.etudiant_id = ? LIMIT 1`, [ufCloture, AMARA]
    );
    const r = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({ presence_id: presences[0].id, motif: 'Tentative apres cloture.' });

    expect(r.status).toBe(409);
    expect(r.body.code).toBe('UF_CLOTUREE');
  });

  test('VERROU : le FORMATEUR non plus ne peut plus modifier (409)', async () => {
    const [presences] = await pool.query(
      `SELECT p.id FROM presences p JOIN seances s ON s.id = p.seance_id
        WHERE s.uf_id = ? LIMIT 1`, [ufCloture]
    );
    const r = await request(app)
      .put(`/api/presences/${presences[0].id}`).set('Cookie', cookieFormateur)
      .send({ heure_depart: null, motif: 'Tentative apres cloture.' });

    expect(r.status).toBe(409);
    expect(r.body.code).toBe('UF_CLOTUREE');
  });

  test('une contestation pendante EMPECHE la cloture (409)', async () => {
    // Purger avant d'avoir tranche priverait le formateur des elements du
    // dossier. Le droit a la minimisation ne prime pas sur le droit d'etre
    // entendu.
    const ufContestee = await creerUf('Test contestation pendante');
    await pool.query('INSERT INTO inscriptions (etudiant_id, uf_id) VALUES (?, ?)', [AMARA, ufContestee]);
    const seance = await creerSeance(ufContestee, -2);
    const presence = await creerPresence(seance, AMARA, false);
    await pool.query(
      `INSERT INTO demandes_rectification (id, presence_id, motif, statut)
       VALUES (?, ?, 'Contestation en cours.', 'en_attente')`,
      [crypto.randomUUID(), presence]
    );

    const r = await request(app)
      .post(`/api/uf/${ufContestee}/cloture-rgpd`).set('Cookie', cookieFormateur)
      .send({ confirmation: 'CLOTURER' });

    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DEMANDES_EN_ATTENTE');
  });
});
