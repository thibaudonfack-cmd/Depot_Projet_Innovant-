// tests/enrolement.test.js
// Test d'integration (Supertest + vrai MySQL) de l'enrolement d'appareil
// (RF-07/RF-09, Etape 4). Meme discipline que scan.test.js et health.test.js :
// AUCUN mock du pool -- le point precis de ce fichier est de prouver que la
// contrainte UNIQUE(actif_key) (01-schema.sql) empeche reellement deux
// appareils actifs simultanes pour le meme etudiant, et que la transaction
// de enrolementController.js (revocation puis insertion) produit bien cet
// etat, pas seulement que le code s'execute sans erreur.

const crypto = require('crypto');
const request = require('supertest');

const { app } = require('../server');
const pool = require('../src/config/db');
const { connecter } = require('./aide-auth');

// UUID fixes du seed de demonstration (02-seed.sql).
const ETUDIANT_ENROLEMENT = '33333333-3333-3333-3333-333333333331';

// ETAPE 7c : etudiant_id vient desormais de la session. Les tests
// "etudiant_id manquant" et "etudiant_id inconnu" de l'Etape 4 n'ont donc
// plus d'objet -- un client ne peut plus fournir cette valeur du tout. Ils
// sont remplaces par des tests d'authentification et d'autorisation, qui
// couvrent la meme surface de risque au bon niveau.
let cookieAmara;

// Cles PEM REELLES (pas des chaines arbitraires) : genere deux paires ECDSA
// P-256 distinctes via l'API crypto native de Node (independante de
// WebCrypto/CryptoService.js -- ce test verifie le backend, pas le
// frontend), pour soumettre des donnees representatives de ce qu'un vrai
// client enverrait.
function genererClePubliquePem() {
  const { publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', // == P-256
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return publicKey;
}

/**
 * Paire ECDSA generee via WebCrypto, comme le fait le navigateur.
 * generateKeyPairSync + createSign produiraient des signatures DER, que le
 * backend rejette : il attend le format brut r||s (ieee-p1363) de WebCrypto.
 * Des tests ecrits ainsi valideraient un format que le vrai client n'envoie
 * jamais.
 */
async function genererPaireWebCrypto() {
  const paire = await crypto.webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
  );
  const spki = await crypto.webcrypto.subtle.exportKey('spki', paire.publicKey);
  const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(spki).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
  return { paire, pem };
}

async function signerAvec(paire, texte) {
  const signature = await crypto.webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, paire.privateKey, new TextEncoder().encode(texte)
  );
  return Buffer.from(signature).toString('base64');
}

/** Demande un defi et retourne { id, valeur }. */
async function demanderDefi(cookie) {
  const reponse = await request(app)
    .post('/api/enrolements/defi').set('Cookie', cookie);
  expect(reponse.status).toBe(201);
  return reponse.body.defi;
}

/** Enrolement complet : defi, generation, signature, envoi. */
async function enrolerCorrectement(cookie, infoAppareil = 'Test Suite') {
  const defi = await demanderDefi(cookie);
  const { paire, pem } = await genererPaireWebCrypto();
  const signature = await signerAvec(paire, defi.valeur);
  const reponse = await request(app)
    .post('/api/enrolements').set('Cookie', cookie)
    .send({ public_key: pem, device_info: infoAppareil, defi_id: defi.id, signature_defi: signature });
  return { reponse, paire, pem, defi };
}

beforeAll(async () => {
  const { cookie, utilisateur } = await connecter('amara');
  cookieAmara = cookie;
  // Coherence du seed : la session doit bien correspondre a l'etudiant teste.
  expect(utilisateur.etudiant_id).toBe(ETUDIANT_ENROLEMENT);
});

// ETAPE 11 : le quota d'enrolements est un compteur PERSISTANT, et cette
// suite enrole le meme etudiant bien plus de deux fois -- chaque test
// verifiant un aspect different de la cascade cryptographique.
//
// Le remettre a zero avant chaque test n'affaiblit rien : le quota a sa
// propre suite dediee (quota-enrolement.test.js), qui verifie precisement
// qu'il bloque. Ici on isole les tests les uns des autres, ce qui est la
// regle habituelle -- un test ne doit pas echouer a cause de ce qu'un autre
// a consomme.
beforeEach(async () => {
  await pool.query(
    'UPDATE etudiants SET compteur_enrolements = 0 WHERE id = ?',
    [ETUDIANT_ENROLEMENT]
  );
});

afterAll(async () => {
  // Nettoyage : contrairement a scans (Etape 3, volontairement en ecriture
  // seule pour app_logs -- RF-18/RNF-13), appareils_enroles autorise
  // explicitement UPDATE et DELETE pour app_logs depuis l'Etape 1
  // (database/03-privileges.sh, "revocation de cle, RF-08") -- ce nettoyage
  // ne se heurte donc a aucune restriction de privileges, a la difference
  // de ce qui avait ete observe sur scans.
  await pool.query('DELETE FROM appareils_enroles WHERE etudiant_id = ?', [ETUDIANT_ENROLEMENT]);
  await pool.end();
});

describe('POST /api/enrolements -- enrolement cryptographique (RF-07/RF-09)', () => {
  test('premier enrolement pour un etudiant : accepte (201), aucun appareil precedent', async () => {
    const { reponse: response, pem: clePublique } =
      await enrolerCorrectement(cookieAmara, 'Test Suite - Appareil 1');

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ok');
    expect(response.body.statut).toBe('actif');
    expect(response.body.appareil_precedent_revoque).toBe(false);

    const [lignes] = await pool.query(
      'SELECT statut, cle_publique, info_appareil FROM appareils_enroles WHERE id = ?',
      [response.body.appareil_id]
    );
    expect(lignes).toHaveLength(1);
    expect(lignes[0].statut).toBe('actif');
    expect(lignes[0].cle_publique.trim()).toBe(clePublique.trim());
    expect(lignes[0].info_appareil).toBe('Test Suite - Appareil 1');
  });

  test('RF-09 : un second enrolement pour le MEME etudiant revoque le premier et active le second', async () => {
    const { reponse: response } =
      await enrolerCorrectement(cookieAmara, 'Test Suite - Appareil 2 (remplacement)');

    expect(response.status).toBe(201);
    expect(response.body.appareil_precedent_revoque).toBe(true);

    // Verification EN BASE, pas seulement sur la reponse HTTP : exactement
    // UN SEUL appareil actif pour cet etudiant, jamais zero ni deux --
    // c'est precisement ce que la contrainte UNIQUE(actif_key) et la
    // transaction du controller doivent garantir ensemble.
    const [actifs] = await pool.query(
      "SELECT id FROM appareils_enroles WHERE etudiant_id = ? AND statut = 'actif'",
      [ETUDIANT_ENROLEMENT]
    );
    expect(actifs).toHaveLength(1);
    expect(actifs[0].id).toBe(response.body.appareil_id);

    const [revoques] = await pool.query(
      "SELECT id, date_revocation FROM appareils_enroles WHERE etudiant_id = ? AND statut = 'revoque'",
      [ETUDIANT_ENROLEMENT]
    );
    expect(revoques).toHaveLength(1);
    expect(revoques[0].date_revocation).not.toBeNull();
  });

  test('champs obligatoires manquants : 400 explicite, avant toute ecriture', async () => {
    const sansRien = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara).send({});
    expect(sansRien.status).toBe(400);

    // La cle publique seule ne suffit plus : sans defi signe, il n'y a
    // aucune preuve que l'expediteur detient la cle privee associee.
    const sansDefi = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara)
      .send({ public_key: genererClePubliquePem() });
    expect(sansDefi.status).toBe(400);
  });

  // --------------------------------------------------------------------
  // ETAPE 7c : l'identite ne vient plus du client
  // --------------------------------------------------------------------

  test('ETAPE 7c : sans cookie de session, l\'enrolement est refuse (401)', async () => {
    const response = await request(app)
      .post('/api/enrolements')
      .send({ public_key: genererClePubliquePem() });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('NON_AUTHENTIFIE');
  });

  test('la demande de defi exige aussi une session (401)', async () => {
    expect((await request(app).post('/api/enrolements/defi')).status).toBe(401);
  });

  test("ETAPE 7c : un etudiant_id glisse dans le corps est IGNORE -- l'appareil est enrole pour l'utilisateur de la session", async () => {
    // Amara est authentifiee, mais tente d'enroler un appareil au nom de
    // Bilal. C'etait, jusqu'a l'Etape 7c, le contournement le plus direct de
    // toute la chaine : enroler SON appareil sous l'identite d'un autre
    // permettait ensuite de scanner legitimement a sa place.
    const AUTRE_ETUDIANT = '33333333-3333-3333-3333-333333333332';
    const defi = await demanderDefi(cookieAmara);
    const { paire, pem } = await genererPaireWebCrypto();
    const signature = await signerAvec(paire, defi.valeur);

    const response = await request(app)
      .post('/api/enrolements')
      .set('Cookie', cookieAmara)
      .send({
        public_key: pem,
        device_info: 'Test Suite - tentative usurpation',
        defi_id: defi.id,
        signature_defi: signature,
        etudiant_id: AUTRE_ETUDIANT, // ignore
      });

    expect(response.status).toBe(201);
    expect(response.body.etudiant_id).toBe(ETUDIANT_ENROLEMENT);

    // Verification EN BASE : rien n'a ete enrole pour l'autre etudiant.
    const [lignes] = await pool.query(
      'SELECT id FROM appareils_enroles WHERE etudiant_id = ? AND info_appareil = ?',
      [AUTRE_ETUDIANT, 'Test Suite - tentative usurpation']
    );
    expect(lignes).toHaveLength(0);
  });

  test('ETAPE 7c : un formateur ne peut pas enroler d\'appareil (403)', async () => {
    const { cookie } = await connecter('formateur');
    const response = await request(app)
      .post('/api/enrolements')
      .set('Cookie', cookie)
      .send({ public_key: genererClePubliquePem() });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ROLE_INSUFFISANT');
  });
});

// ---------------------------------------------------------------------------
// Preuve de possession (challenge-response)
// ---------------------------------------------------------------------------

describe('Preuve de possession a l\'enrolement', () => {
  test('le defi emis est aleatoire et jamais identique d\'une demande a l\'autre', async () => {
    // Un defi predictible permettrait de preparer une signature a l'avance.
    const a = await demanderDefi(cookieAmara);
    const b = await demanderDefi(cookieAmara);
    expect(a.valeur).not.toBe(b.valeur);
    expect(a.valeur).toMatch(/^[0-9a-f]{64}$/);
  });

  test('CAS CENTRAL : signer avec une AUTRE cle que celle transmise est refuse (401)', async () => {
    // C'est precisement l'attaque que le mecanisme ferme : soumettre la cle
    // publique d'un tiers (elle est publique et se recupere aisement) sans
    // detenir la cle privee correspondante.
    const defi = await demanderDefi(cookieAmara);
    const { paire: paireA } = await genererPaireWebCrypto();
    const { pem: pemB } = await genererPaireWebCrypto();
    const signatureDeA = await signerAvec(paireA, defi.valeur);

    const reponse = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara)
      .send({ public_key: pemB, defi_id: defi.id, signature_defi: signatureDeA });

    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('PREUVE_POSSESSION_INVALIDE');
  });

  test('signer une AUTRE valeur que le defi est refuse (401)', async () => {
    const defi = await demanderDefi(cookieAmara);
    const { paire, pem } = await genererPaireWebCrypto();
    const signature = await signerAvec(paire, 'une-valeur-qui-n-est-pas-le-defi');

    const reponse = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara)
      .send({ public_key: pem, defi_id: defi.id, signature_defi: signature });

    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('PREUVE_POSSESSION_INVALIDE');
  });

  test('REJEU : un defi deja consomme ne peut pas resservir (400)', async () => {
    const defi = await demanderDefi(cookieAmara);
    const { paire, pem } = await genererPaireWebCrypto();
    const signature = await signerAvec(paire, defi.valeur);
    const corps = { public_key: pem, defi_id: defi.id, signature_defi: signature };

    const premier = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara).send(corps);
    expect(premier.status).toBe(201);

    // Rejouer EXACTEMENT le meme couple (defi, signature), comme le ferait
    // un attaquant l'ayant intercepte.
    const rejeu = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara).send(corps);
    expect(rejeu.status).toBe(400);
    expect(rejeu.body.code).toBe('DEFI_INVALIDE');
  });

  test('un defi expire est refuse (400)', async () => {
    const defi = await demanderDefi(cookieAmara);
    // Expiration forcee en base plutot que par une attente reelle de deux
    // minutes : le comportement teste est celui du serveur, pas la patience
    // de la suite de tests.
    await pool.query(
      'UPDATE defis_enrolement SET date_expiration = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
      [defi.id]
    );

    const { paire, pem } = await genererPaireWebCrypto();
    const signature = await signerAvec(paire, defi.valeur);
    const reponse = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara)
      .send({ public_key: pem, defi_id: defi.id, signature_defi: signature });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('DEFI_INVALIDE');
  });

  test("le defi d'un AUTRE etudiant ne peut pas servir (400)", async () => {
    const { cookie: cookieBilal } = await connecter('bilal');
    const defiDeBilal = await demanderDefi(cookieBilal);
    const { paire, pem } = await genererPaireWebCrypto();
    const signature = await signerAvec(paire, defiDeBilal.valeur);

    // Amara presente un defi emis pour Bilal, correctement signe.
    const reponse = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara)
      .send({ public_key: pem, defi_id: defiDeBilal.id, signature_defi: signature });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('DEFI_INVALIDE');
  });

  test('une cle publique illisible est signalee distinctement (400)', async () => {
    const defi = await demanderDefi(cookieAmara);
    const reponse = await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara)
      .send({ public_key: 'pas-un-pem', defi_id: defi.id, signature_defi: 'AAAA' });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('CLE_PUBLIQUE_INVALIDE');
  });

  test("un enrolement refuse ne cree AUCUN appareil (transaction annulee)", async () => {
    const [avant] = await pool.query(
      'SELECT COUNT(*) AS n FROM appareils_enroles WHERE etudiant_id = ?', [ETUDIANT_ENROLEMENT]
    );

    const defi = await demanderDefi(cookieAmara);
    const { paire } = await genererPaireWebCrypto();
    const { pem: autrePem } = await genererPaireWebCrypto();
    await request(app)
      .post('/api/enrolements').set('Cookie', cookieAmara)
      .send({
        public_key: autrePem, defi_id: defi.id,
        signature_defi: await signerAvec(paire, defi.valeur),
      });

    const [apres] = await pool.query(
      'SELECT COUNT(*) AS n FROM appareils_enroles WHERE etudiant_id = ?', [ETUDIANT_ENROLEMENT]
    );
    expect(apres[0].n).toBe(avant[0].n);
  });
});
