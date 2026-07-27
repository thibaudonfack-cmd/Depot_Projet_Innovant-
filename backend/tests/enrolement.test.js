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

// UUID fixes du seed de demonstration (02-seed.sql).
const ETUDIANT_ENROLEMENT = '33333333-3333-3333-3333-333333333331';
const ETUDIANT_SANS_DB = '33333333-3333-3333-3333-333333333334';
const ETUDIANT_INEXISTANT = '00000000-0000-0000-0000-000000000000';

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
    const clePublique = genererClePubliquePem();

    const response = await request(app)
      .post('/api/enrolements')
      .send({
        etudiant_id: ETUDIANT_ENROLEMENT,
        public_key: clePublique,
        device_info: 'Test Suite - Appareil 1',
      });

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
    const deuxiemeClePublique = genererClePubliquePem();

    const response = await request(app)
      .post('/api/enrolements')
      .send({
        etudiant_id: ETUDIANT_ENROLEMENT,
        public_key: deuxiemeClePublique,
        device_info: 'Test Suite - Appareil 2 (remplacement)',
      });

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

  test('etudiant_id ou public_key manquant : 400 explicite, avant toute ecriture', async () => {
    const sansClePublique = await request(app)
      .post('/api/enrolements')
      .send({ etudiant_id: ETUDIANT_SANS_DB });
    expect(sansClePublique.status).toBe(400);

    const sansEtudiant = await request(app)
      .post('/api/enrolements')
      .send({ public_key: genererClePubliquePem() });
    expect(sansEtudiant.status).toBe(400);
  });

  test('etudiant_id inconnu : 400 (violation de contrainte FOREIGN KEY), transaction annulee proprement', async () => {
    const response = await request(app)
      .post('/api/enrolements')
      .send({
        etudiant_id: ETUDIANT_INEXISTANT,
        public_key: genererClePubliquePem(),
      });

    expect(response.status).toBe(400);

    // Aucune ligne ne doit avoir ete inseree malgre l'echec -- confirme que
    // le rollback de la transaction a bien eu lieu.
    const [lignes] = await pool.query(
      'SELECT id FROM appareils_enroles WHERE etudiant_id = ?',
      [ETUDIANT_INEXISTANT]
    );
    expect(lignes).toHaveLength(0);
  });
});
