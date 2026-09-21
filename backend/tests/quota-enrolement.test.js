// tests/quota-enrolement.test.js
// Quota d'enrolements : fermeture du pret d'identifiants (Etape 11).
//
// L'angle mort ferme ici n'etait pas cryptographique. Chaque enrolement,
// pris isolement, est parfaitement legitime : bonne session, bon defi, bonne
// preuve de possession. C'est leur REPETITION qui posait probleme --
// l'etudiant A prete son compte a B, B s'enrole (revoquant A), B scanne, puis
// A se re-enrole le soir. La revocation automatique, concue comme une
// protection, rendait justement le manege repetable a l'infini.
//
// Le remede est metier : rendre l'operation limitee. Ces tests verifient que
// la limite est REELLE, y compris face a deux requetes simultanees.

const crypto = require('crypto');
const request = require('supertest');
const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter } = require('./aide-auth');
const { QUOTA_ENROLEMENTS_MAX } = require('../src/controllers/enrolementController');

// Etudiants dedies : le quota est un compteur PERSISTANT, deux scenarios ne
// peuvent donc pas partager le meme compte sans se contaminer.
const ELENA = '33333333-3333-3333-3333-333333333335';
const FARID = '33333333-3333-3333-3333-333333333336';
const GWENDOLINE = '33333333-3333-3333-3333-333333333337';

let cookieElena, cookieFarid, cookieGwendoline;

async function genererPaire() {
  const paire = await crypto.webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  );
  const brut = await crypto.webcrypto.subtle.exportKey('spki', paire.publicKey);
  const base64 = Buffer.from(brut).toString('base64').match(/.{1,64}/g).join('\n');
  return { paire, pem: `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----\n` };
}

async function signer(paire, texte) {
  const signature = await crypto.webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, paire.privateKey, new TextEncoder().encode(texte)
  );
  return Buffer.from(signature).toString('base64');
}

/** Enrolement complet et correct : defi, paire, signature, envoi. */
async function enroler(cookie, info = 'Appareil de test') {
  const defiRep = await request(app).post('/api/enrolements/defi').set('Cookie', cookie);
  expect(defiRep.status).toBe(201);
  const { paire, pem } = await genererPaire();
  const signature = await signer(paire, defiRep.body.defi.valeur);
  return request(app).post('/api/enrolements').set('Cookie', cookie)
    .send({
      public_key: pem, device_info: info,
      defi_id: defiRep.body.defi.id, signature_defi: signature,
    });
}

const compteur = async (id) => {
  const [l] = await pool.query('SELECT compteur_enrolements FROM etudiants WHERE id = ?', [id]);
  return l[0].compteur_enrolements;
};

beforeAll(async () => {
  cookieElena = (await connecter('elena')).cookie;
  cookieFarid = (await connecter('farid')).cookie;
  cookieGwendoline = (await connecter('gwendoline')).cookie;
});

afterAll(async () => {
  await pool.query('DELETE FROM sessions');
  await pool.end();
});

// ==========================================================================
describe('Quota d\'enrolements', () => {
  test('le quota est de 2 : un enrolement initial, plus un remplacement', () => {
    // Fige la valeur : la relever silencieusement rouvrirait l'angle mort
    // que cette etape ferme.
    expect(QUOTA_ENROLEMENTS_MAX).toBe(2);
  });

  test('un etudiant neuf part de zero', async () => {
    expect(await compteur(ELENA)).toBe(0);
  });

  test('LE TEST CENTRAL : le 3e enrolement est refuse (403)', async () => {
    // Les deux premiers reussissent, le troisieme est bloque.
    const premier = await enroler(cookieElena, 'Telephone initial');
    expect(premier.status).toBe(201);
    expect(await compteur(ELENA)).toBe(1);

    const second = await enroler(cookieElena, 'Telephone de remplacement');
    expect(second.status).toBe(201);
    expect(await compteur(ELENA)).toBe(2);

    const troisieme = await enroler(cookieElena, 'Telephone de l\'ami');
    expect(troisieme.status).toBe(403);
    expect(troisieme.body.code).toBe('QUOTA_ENROLEMENT_ATTEINT');
    // Le message doit indiquer la SEULE issue reelle : un humain.
    expect(troisieme.body.message).toMatch(/secretariat/i);
  });

  test('un refus ne consomme PAS de credit supplementaire', async () => {
    // Sinon le compteur deriverait a chaque tentative, et un etudiant de
    // bonne foi verrait son cas s'aggraver a chaque essai.
    const avant = await compteur(ELENA);
    await enroler(cookieElena, 'Nouvelle tentative');
    expect(await compteur(ELENA)).toBe(avant);
  });

  test("L'ANGLE MORT FERME : l'appareil actif reste celui du 2e enrolement", async () => {
    // C'est le point de tout le dispositif. Apres le refus, le compte ne
    // revient PAS a l'appareil de l'ami : le scenario du pret s'arrete la.
    const [appareils] = await pool.query(
      `SELECT info_appareil FROM appareils_enroles
        WHERE etudiant_id = ? AND statut = 'actif'`,
      [ELENA]
    );
    expect(appareils).toHaveLength(1);
    expect(appareils[0].info_appareil).toBe('Telephone de remplacement');
  });

  test('le refus intervient APRES la preuve de possession', async () => {
    // Ordre volontaire. Si le quota etait verifie en premier, une requete
    // non authentifiee cryptographiquement pourrait epuiser le credit d'un
    // camarade -- on offrirait un moyen de bloquer le compte d'autrui.
    const defiRep = await request(app).post('/api/enrolements/defi').set('Cookie', cookieElena);
    const { pem } = await genererPaire();
    const { paire: autrePaire } = await genererPaire();
    // Signature faite avec une AUTRE cle que celle transmise.
    const signatureInvalide = await signer(autrePaire, defiRep.body.defi.valeur);

    const reponse = await request(app).post('/api/enrolements').set('Cookie', cookieElena)
      .send({
        public_key: pem, device_info: 'Cle depareillee',
        defi_id: defiRep.body.defi.id, signature_defi: signatureInvalide,
      });

    // 401 (preuve invalide) et NON 403 (quota) : la cascade s'arrete avant.
    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('PREUVE_POSSESSION_INVALIDE');
  });

  test('la reinitialisation administrative debloque le compte', async () => {
    // Procedure documentee dans ANALYSE_CODE.md : un administrateur remet le
    // compteur a zero apres verification d'identite. Ce test verifie que la
    // procedure fonctionne reellement -- une consigne non testee n'engage
    // personne.
    await pool.query('UPDATE etudiants SET compteur_enrolements = 0 WHERE id = ?', [ELENA]);
    const reponse = await enroler(cookieElena, 'Apres reinitialisation');
    expect(reponse.status).toBe(201);
    expect(await compteur(ELENA)).toBe(1);
  });

  test('le quota est PAR ETUDIANT, jamais global', async () => {
    // Un compteur partage bloquerait toute la promotion des que deux
    // etudiants auraient change de telephone.
    const reponse = await enroler(cookieFarid, 'Telephone de Farid');
    expect(reponse.status).toBe(201);
    expect(await compteur(FARID)).toBe(1);
  });

  test('DEUX ENROLEMENTS SIMULTANES ne consomment pas un seul credit', async () => {
    // Un SELECT-puis-UPDATE laisserait les deux requetes lire la meme valeur,
    // conclure toutes deux "autorise", et enroler deux appareils pour un seul
    // credit : le quota serait contournable en cliquant deux fois.
    await pool.query('UPDATE etudiants SET compteur_enrolements = 1 WHERE id = ?', [GWENDOLINE]);

    const [a, b] = await Promise.all([
      enroler(cookieGwendoline, 'Simultane A'),
      enroler(cookieGwendoline, 'Simultane B'),
    ]);

    const statuts = [a.status, b.status].sort();
    // Exactement UNE reussite et UN refus : le moteur a tranche.
    expect(statuts).toEqual([201, 403]);
    expect(await compteur(GWENDOLINE)).toBe(QUOTA_ENROLEMENTS_MAX);
  });
});

// ==========================================================================
describe('GET /api/mon-appareil -- exposition du quota', () => {
  test('le quota restant est renvoye, pour avertir AVANT de bloquer', async () => {
    // Un utilisateur qui apprend la limite au moment ou elle le bloque la
    // subit ; informe en amont, il peut decider.
    const reponse = await request(app).get('/api/mon-appareil').set('Cookie', cookieFarid);

    expect(reponse.status).toBe(200);
    expect(reponse.body.quota).toBeDefined();
    expect(reponse.body.quota.maximum).toBe(QUOTA_ENROLEMENTS_MAX);
    expect(reponse.body.quota.consommes).toBe(1);
    expect(reponse.body.quota.restants).toBe(1);
  });

  test('restants n\'est JAMAIS negatif', async () => {
    // Un compteur remis a une valeur superieure au maximum par une
    // manipulation en base afficherait sinon "-1 association restante".
    await pool.query('UPDATE etudiants SET compteur_enrolements = 9 WHERE id = ?', [FARID]);
    const reponse = await request(app).get('/api/mon-appareil').set('Cookie', cookieFarid);
    expect(reponse.body.quota.restants).toBe(0);
  });
});
