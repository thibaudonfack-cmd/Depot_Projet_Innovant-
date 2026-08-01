// tests/auth.test.js
// Tests d'integration de l'authentification par cookie de session (Etape 7a).
//
// Commande : docker compose exec backend npm test

const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter, COMPTES } = require('./aide-auth');
const { hacherMotDePasse, verifierMotDePasse } = require('../src/services/passwordService');

afterAll(async () => {
  // Les sessions ouvertes par ces tests sont supprimables : app_logs dispose
  // de DELETE sur sessions (03-privileges.sh), precisement pour que la
  // deconnexion soit reelle.
  await pool.query('DELETE FROM sessions');
  await pool.end();
});

describe('passwordService (scrypt)', () => {
  test('un mot de passe correct est verifie, un mot de passe errone est refuse', async () => {
    const hachage = await hacherMotDePasse('MotDePasse-Correct-123');
    expect(await verifierMotDePasse('MotDePasse-Correct-123', hachage)).toBe(true);
    expect(await verifierMotDePasse('MotDePasse-Errone-123', hachage)).toBe(false);
  });

  test('le meme mot de passe produit deux empreintes DIFFERENTES (sel aleatoire par compte)', async () => {
    // Sans sel par compte, une seule table precalculee casserait tous les
    // comptes partageant un mot de passe -- ce qui est le cas des quatre
    // etudiants du seed.
    const a = await hacherMotDePasse('IdentiqueDesDeuxCotes!');
    const b = await hacherMotDePasse('IdentiqueDesDeuxCotes!');
    expect(a).not.toBe(b);
    expect(await verifierMotDePasse('IdentiqueDesDeuxCotes!', a)).toBe(true);
    expect(await verifierMotDePasse('IdentiqueDesDeuxCotes!', b)).toBe(true);
  });

  test('une empreinte malformee retourne false, sans lever d\'exception', async () => {
    // Une exception ici remonterait en 500 et distinguerait, pour un
    // attaquant, un hachage corrompu d'un simple mot de passe errone.
    for (const invalide of ['', 'nimportequoi', 'scrypt$abc', 'bcrypt$1$2$3$4$5']) {
      expect(await verifierMotDePasse('x', invalide)).toBe(false);
    }
  });

  test('le seed contient de VRAIS hachages scrypt, verifiables avec les mots de passe documentes', async () => {
    const [lignes] = await pool.query(
      'SELECT mot_de_passe_hash FROM utilisateurs WHERE email = ?',
      [COMPTES.amara.email]
    );
    expect(lignes).toHaveLength(1);
    expect(lignes[0].mot_de_passe_hash.startsWith('scrypt$')).toBe(true);
    expect(await verifierMotDePasse(COMPTES.amara.mot_de_passe, lignes[0].mot_de_passe_hash)).toBe(true);
  });
});

describe('POST /api/auth/login', () => {
  test('connexion valide : 200, cookie httpOnly/Secure/SameSite=Strict, et AUCUN jeton dans le corps', async () => {
    const reponse = await request(app).post('/api/auth/login').send(COMPTES.amara);

    expect(reponse.status).toBe(200);
    expect(reponse.body.utilisateur.role).toBe('etudiant');
    expect(reponse.body.utilisateur.etudiant_id).toBe('33333333-3333-3333-3333-333333333331');

    const setCookie = reponse.headers['set-cookie'].join(';');
    expect(setCookie).toMatch(/presence_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);

    // Le jeton de session ne doit JAMAIS apparaitre dans le corps : l'y
    // mettre le rendrait accessible a JavaScript et annulerait l'interet du
    // httpOnly. On verifie qu'aucune valeur du corps ne ressemble au jeton.
    const corpsTexte = JSON.stringify(reponse.body);
    const jeton = setCookie.match(/presence_session=([^;]+)/)[1];
    expect(corpsTexte).not.toContain(jeton);
  });

  test('le hash du mot de passe n\'est jamais renvoye au client', async () => {
    const reponse = await request(app).post('/api/auth/login').send(COMPTES.formateur);
    expect(reponse.status).toBe(200);
    expect(JSON.stringify(reponse.body)).not.toMatch(/scrypt\$/);
    expect(reponse.body.utilisateur.mot_de_passe_hash).toBeUndefined();
  });

  test('mot de passe errone : 401', async () => {
    const reponse = await request(app)
      .post('/api/auth/login')
      .send({ email: COMPTES.amara.email, mot_de_passe: 'PasLeBon!' });

    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('IDENTIFIANTS_INVALIDES');
    expect(reponse.headers['set-cookie']).toBeUndefined();
  });

  test('ANTI-ENUMERATION : un compte inexistant donne exactement le meme statut ET le meme message qu\'un mot de passe errone', async () => {
    // Distinguer les deux permettrait de tester une liste d'adresses pour
    // determiner lesquelles ont un compte -- exploitable pour du hameconnage
    // cible, et donnee personnelle au sens du RGPD.
    const inconnu = await request(app)
      .post('/api/auth/login')
      .send({ email: 'personne@example.org', mot_de_passe: 'PeuImporte!' });
    const mauvaisMdp = await request(app)
      .post('/api/auth/login')
      .send({ email: COMPTES.amara.email, mot_de_passe: 'PeuImporte!' });

    expect(inconnu.status).toBe(mauvaisMdp.status);
    expect(inconnu.body.code).toBe(mauvaisMdp.body.code);
    expect(inconnu.body.message).toBe(mauvaisMdp.body.message);
  });

  test('champs manquants : 400', async () => {
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: 'a@b.c' })).status).toBe(400);
  });
});

describe('GET /api/auth/moi', () => {
  test('avec une session valide : renvoie l\'utilisateur courant', async () => {
    const { cookie } = await connecter('formateur');
    const reponse = await request(app).get('/api/auth/moi').set('Cookie', cookie);

    expect(reponse.status).toBe(200);
    expect(reponse.body.utilisateur.role).toBe('formateur');
    // Un formateur n'a pas de ligne dans etudiants : contrainte
    // chk_utilisateur_role_lien (01-schema.sql).
    expect(reponse.body.utilisateur.etudiant_id).toBeNull();
  });

  test('sans cookie : 401 NON_AUTHENTIFIE', async () => {
    const reponse = await request(app).get('/api/auth/moi');
    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('NON_AUTHENTIFIE');
  });

  test('avec un jeton invente : 401 SESSION_INVALIDE', async () => {
    const reponse = await request(app)
      .get('/api/auth/moi')
      .set('Cookie', 'presence_session=ceci-nest-pas-un-jeton');
    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('SESSION_INVALIDE');
  });
});

describe('POST /api/auth/logout', () => {
  test('la deconnexion supprime REELLEMENT la session en base : le cookie ne fonctionne plus', async () => {
    // C'est la propriete qu'un JWT auto-porteur ne peut pas offrir, et la
    // raison principale du choix d'une session cote serveur.
    const { cookie } = await connecter('chiara');

    const avant = await request(app).get('/api/auth/moi').set('Cookie', cookie);
    expect(avant.status).toBe(200);

    const deconnexion = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(deconnexion.status).toBe(200);

    // Le MEME cookie est rejoue : s'il fonctionnait encore, la deconnexion
    // n'aurait ete qu'un effacement cote navigateur.
    const apres = await request(app).get('/api/auth/moi').set('Cookie', cookie);
    expect(apres.status).toBe(401);
    expect(apres.body.code).toBe('SESSION_INVALIDE');
  });

  test('la deconnexion est idempotente : sans session, elle repond 200', async () => {
    const reponse = await request(app).post('/api/auth/logout');
    expect(reponse.status).toBe(200);
  });
});

describe('Stockage des sessions', () => {
  test('le jeton n\'est JAMAIS stocke en clair : seule son empreinte SHA-256 figure en base', async () => {
    // Une fuite de la base ne doit pas permettre d'usurper une session en
    // cours (cf. commentaire de la table sessions, 01-schema.sql).
    const { cookie } = await connecter('driss');
    const jeton = cookie.match(/presence_session=([^;]+)/)[1];

    const [parJeton] = await pool.query('SELECT id FROM sessions WHERE jeton_hash = ?', [jeton]);
    expect(parJeton).toHaveLength(0);

    const empreinte = require('crypto').createHash('sha256').update(jeton).digest('hex');
    const [parEmpreinte] = await pool.query('SELECT id FROM sessions WHERE jeton_hash = ?', [empreinte]);
    expect(parEmpreinte).toHaveLength(1);
  });
});
