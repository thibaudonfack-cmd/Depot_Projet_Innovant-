// tests/rapport.test.js
// Statut de seance deduit et rapport administratif (Etape 8).

const crypto = require('crypto');
const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter } = require('./aide-auth');

const UF_ID = '11111111-1111-1111-1111-111111111111';
const SALLE_ID = '22222222-2222-2222-2222-222222222222';
const AMARA = '33333333-3333-3333-3333-333333333331';
const BILAL = '33333333-3333-3333-3333-333333333332';
const DRISS = '33333333-3333-3333-3333-333333333334';
// UF a laquelle Driss n'est PAS inscrit (cf. 02-seed.sql) : sert a verifier
// qu'un present non inscrit n'est pas efface du rapport.
const UF_BUREAUTIQUE = '11111111-1111-1111-1111-111111111112';

let cookieFormateur, cookieAmara;
let seanceTerminee, seanceEnCours, seanceAutreUf;

/** Cree une seance dont la fin prevue est decalee de `heures` (negatif = passe). */
async function creerSeance(decalageFinHeures, ufId = UF_ID) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO seances (id, uf_id, salle_id, heure_debut_prevue, heure_fin_prevue)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [id, ufId, SALLE_ID, decalageFinHeures - 3, decalageFinHeures]
  );
  return id;
}

beforeAll(async () => {
  cookieFormateur = (await connecter('formateur')).cookie;
  cookieAmara = (await connecter('amara')).cookie;

  // Terminee il y a 2 h : la fenetre de rectification est donc ouverte.
  seanceTerminee = await creerSeance(-2);
  // En cours : se termine dans 2 h.
  seanceEnCours = await creerSeance(2);

  // Une seance sur une AUTRE UF, ou Driss n'est pas inscrit mais se presente.
  seanceAutreUf = await creerSeance(-2, UF_BUREAUTIQUE);
  await pool.query(
    `INSERT INTO presences (id, seance_id, etudiant_id, heure_arrivee)
     VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL 4 HOUR))`,
    [crypto.randomUUID(), seanceAutreUf, DRISS]
  );

  // Amara a scanne dans les deux, sans que son depart soit saisi.
  for (const seanceId of [seanceTerminee, seanceEnCours]) {
    await pool.query(
      `INSERT INTO presences (id, seance_id, etudiant_id, heure_arrivee)
       VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL 4 HOUR))`,
      [crypto.randomUUID(), seanceId, AMARA]
    );
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM sessions');
  await pool.end();
});

describe('Statut de seance deduit de l\'horloge', () => {
  test('une seance dont la fin prevue est passee est marquee terminee', async () => {
    // Le statut n'est PAS stocke : un champ mis a jour par un traitement
    // periodique resterait faux entre deux passages, et la seance
    // apparaitrait "en cours" des heures apres sa fin.
    const reponse = await request(app).get('/api/seances').set('Cookie', cookieFormateur);
    const terminee = reponse.body.seances.find((s) => s.id === seanceTerminee);
    const enCours = reponse.body.seances.find((s) => s.id === seanceEnCours);

    expect(terminee.terminee).toBe(true);
    expect(enCours.terminee).toBe(false);
    // La colonne statut, elle, vaut toujours 'ouverte' : c'est bien une
    // deduction et non une mise a jour.
    expect(terminee.statut).toBe('ouverte');
  });

  test('la duree validee retient la fin PREVUE quand aucun depart n\'a ete saisi', async () => {
    const reponse = await request(app)
      .get(`/api/seances/${seanceTerminee}/presences`).set('Cookie', cookieFormateur);

    const presence = reponse.body.presences.find((p) => p.etudiant_id === AMARA);
    // Arrivee il y a 4 h, fin prevue il y a 2 h : environ 120 minutes.
    expect(presence.duree_validee_minutes).toBeGreaterThan(110);
    expect(presence.duree_validee_minutes).toBeLessThan(130);
    // duree_minutes reste NULL : c'est la duree CONSTATEE, et aucun depart
    // n'a ete pointe. Les deux valeurs ne disent pas la meme chose.
    expect(presence.duree_minutes).toBeNull();
  });

  test('sur une seance EN COURS, aucune duree validee n\'est encore calculee', async () => {
    const reponse = await request(app)
      .get(`/api/seances/${seanceEnCours}/presences`).set('Cookie', cookieFormateur);
    const presence = reponse.body.presences.find((p) => p.etudiant_id === AMARA);
    expect(presence.duree_validee_minutes).toBeNull();
  });
});

describe('Fenetre de rectification', () => {
  test("elle ne s'ouvre QU'APRES la fin de la seance", async () => {
    // Signaler une erreur sur des heures encore en train de se constituer
    // n'aurait aucun sens : l'etudiant est toujours en cours.
    const reponse = await request(app).get('/api/mes-presences').set('Cookie', cookieAmara);

    const surTerminee = reponse.body.presences.find((p) => p.seance_id === seanceTerminee);
    const surEnCours = reponse.body.presences.find((p) => p.seance_id === seanceEnCours);

    expect(surTerminee.rectification_ouverte).toBe(true);
    expect(surTerminee.seance_terminee).toBe(true);

    expect(surEnCours.rectification_ouverte).toBe(false);
    expect(surEnCours.seance_terminee).toBe(false);
  });

  test('le serveur REFUSE une demande sur une seance non terminee (403)', async () => {
    // Le controle cote navigateur n'est qu'un confort ; celui-ci fait foi.
    const [lignes] = await pool.query(
      'SELECT id FROM presences WHERE seance_id = ? AND etudiant_id = ?',
      [seanceEnCours, AMARA]
    );

    const reponse = await request(app)
      .post('/api/rectifications').set('Cookie', cookieAmara)
      .send({ presence_id: lignes[0].id, motif: 'Trop tot.' });

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('DELAI_EXPIRE');
  });
});

describe('GET /api/seances/:id/rapport', () => {
  // ------------------------------------------------------------------
  // NON-REGRESSION : LE RAPPEL NE DOIT JAMAIS ETRE VIDE
  //
  // Defaut constate en test de bout en bout : "Attendus 0, Presents 0,
  // Absents 0" et tableau vide, alors qu'un etudiant avait reellement scanne.
  // Deux causes cumulees -- un seed n'inscrivant personne aux deux autres UF,
  // et une requete partant des seules inscriptions, qui effacait donc un
  // present non inscrit. Ces tests verrouillent les deux.
  // ------------------------------------------------------------------
  test('le tableau CONTIENT des etudiants : un rapport vide est toujours un defaut', async () => {
    const reponse = await request(app)
      .get(`/api/seances/${seanceTerminee}/rapport`).set('Cookie', cookieFormateur);

    expect(reponse.status).toBe(200);
    expect(Array.isArray(reponse.body.etudiants)).toBe(true);
    expect(reponse.body.etudiants.length).toBeGreaterThan(0);
    // Les trois compteurs ne peuvent pas etre simultanement nuls : ce triplet
    // est la signature exacte du defaut observe.
    expect(
      reponse.body.synthese.attendus
      + reponse.body.synthese.presents
      + reponse.body.synthese.absents
    ).toBeGreaterThan(0);
  });

  test('AUCUNE des trois UF du seed n\'est sans inscrit', async () => {
    // La cause premiere du rapport vide etait la : le formulaire de creation
    // propose les trois UF, une seule avait des inscrits.
    const [lignes] = await pool.query(
      `SELECT u.id, u.intitule, COUNT(i.id) AS nb
         FROM uf u LEFT JOIN inscriptions i ON i.uf_id = u.id
        GROUP BY u.id, u.intitule`
    );
    expect(lignes.length).toBeGreaterThanOrEqual(3);
    for (const ligne of lignes) {
      expect(ligne.nb).toBeGreaterThan(0);
    }
  });

  test('un etudiant PRESENT mais NON INSCRIT figure au rapport, signale', async () => {
    // Le pire defaut possible pour un releve d'assiduite : un absent
    // improprement compte se remarque -- l'interesse proteste. Un present
    // efface ne se remarque pas.
    const reponse = await request(app)
      .get(`/api/seances/${seanceAutreUf}/rapport`).set('Cookie', cookieFormateur);

    expect(reponse.status).toBe(200);
    const driss = reponse.body.etudiants.find((e) => e.etudiant_id === DRISS);
    expect(driss).toBeDefined();
    expect(driss.present).toBe(true);
    expect(driss.inscrit).toBe(false);
    expect(driss.minutes_validees).toBeGreaterThan(0);
    expect(reponse.body.synthese.presents_non_inscrits).toBe(1);
  });

  test('un present non inscrit ne gonfle PAS l\'effectif attendu', async () => {
    // "Attendus" compte les inscrits, pas les lignes du tableau -- sans quoi
    // l'effectif theorique de l'UF serait fausse par toute presence hors
    // cadre, et "absents" pourrait meme devenir negatif.
    const reponse = await request(app)
      .get(`/api/seances/${seanceAutreUf}/rapport`).set('Cookie', cookieFormateur);

    expect(reponse.body.synthese.attendus).toBe(3); // 3 inscrits a Bureautique
    expect(reponse.body.etudiants.length).toBe(4);  // + Driss, present hors cadre
    expect(reponse.body.synthese.absents).toBe(3);  // les 3 inscrits absents
    expect(reponse.body.synthese.absents).toBeGreaterThanOrEqual(0);
  });

  test('le rapport fait apparaitre les ABSENTS, pas seulement ceux qui sont venus', async () => {
    // Lister les presences ne montrerait que ceux qui sont venus, alors que
    // l'information administrative decisive est l'inverse.
    const reponse = await request(app)
      .get(`/api/seances/${seanceTerminee}/rapport`).set('Cookie', cookieFormateur);

    expect(reponse.status).toBe(200);
    expect(reponse.body.synthese.attendus).toBe(4); // 4 inscrits au seed
    expect(reponse.body.synthese.presents).toBe(1);
    expect(reponse.body.synthese.absents).toBe(3);
    expect(reponse.body.synthese.presents_non_inscrits).toBe(0);

    const bilal = reponse.body.etudiants.find((e) => e.etudiant_id === BILAL);
    expect(bilal).toBeDefined();
    expect(bilal.present).toBe(false);
    expect(bilal.inscrit).toBe(true);
    expect(bilal.minutes_validees).toBeNull();
  });

  test('un depart non saisi est signale comme DEDUIT et non comme constate', async () => {
    // Sans ce drapeau, la valeur paraitrait relevee alors qu'elle est
    // inferee de l'heure de fin prevue.
    const reponse = await request(app)
      .get(`/api/seances/${seanceTerminee}/rapport`).set('Cookie', cookieFormateur);

    const amara = reponse.body.etudiants.find((e) => e.etudiant_id === AMARA);
    expect(amara.present).toBe(true);
    expect(amara.heure_depart_saisie).toBeNull();
    expect(amara.depart_deduit).toBe(true);
    expect(amara.heure_fin_retenue).not.toBeNull();
    expect(amara.minutes_validees).toBeGreaterThan(110);
  });

  test('un rapport sur une seance en cours est marque PROVISOIRE', async () => {
    const reponse = await request(app)
      .get(`/api/seances/${seanceEnCours}/rapport`).set('Cookie', cookieFormateur);
    expect(reponse.body.synthese.provisoire).toBe(true);

    const termine = await request(app)
      .get(`/api/seances/${seanceTerminee}/rapport`).set('Cookie', cookieFormateur);
    expect(termine.body.synthese.provisoire).toBe(false);
  });

  test('les demandes en attente sont signalees dans la synthese', async () => {
    // Valider des credits sur un temps encore susceptible d'etre corrige
    // exposerait a devoir revenir sur la decision.
    const [lignes] = await pool.query(
      'SELECT id FROM presences WHERE seance_id = ? AND etudiant_id = ?', [seanceTerminee, AMARA]
    );
    await request(app).post('/api/rectifications').set('Cookie', cookieAmara)
      .send({ presence_id: lignes[0].id, motif: 'Je suis parti plus tot.' });

    const reponse = await request(app)
      .get(`/api/seances/${seanceTerminee}/rapport`).set('Cookie', cookieFormateur);

    expect(reponse.body.synthese.demandes_en_attente).toBe(1);
    const amara = reponse.body.etudiants.find((e) => e.etudiant_id === AMARA);
    expect(amara.demande_en_attente).toBe(true);
  });

  test('seance inconnue : 404', async () => {
    const reponse = await request(app)
      .get('/api/seances/00000000-0000-0000-0000-000000000000/rapport')
      .set('Cookie', cookieFormateur);
    expect(reponse.status).toBe(404);
  });

  test('un etudiant ne peut pas consulter le rapport (403)', async () => {
    const reponse = await request(app)
      .get(`/api/seances/${seanceTerminee}/rapport`).set('Cookie', cookieAmara);
    expect(reponse.status).toBe(403);
  });
});
