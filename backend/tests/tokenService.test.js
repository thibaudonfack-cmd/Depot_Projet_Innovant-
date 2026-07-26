// tests/tokenService.test.js
// Test unitaire retroactif de l'Etape 2 (RF-04). Aucune dependance a MySQL :
// tokenService.js ne touche jamais la base de donnees. Necessite uniquement
// que les cles RS256 existent (JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH,
// ou le repli par defaut vers <racine du depot>/keys/) -- generees par
// ./generate_keys.sh, en local comme en CI (cf. .gitlab-ci.yml).

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const {
  generateSessionToken,
  ROTATION_INTERVAL_SECONDS,
  TOKEN_TTL_SECONDS,
} = require('../src/services/tokenService');

const PUBLIC_KEY_PATH = process.env.JWT_PUBLIC_KEY_PATH
  ? path.resolve(process.env.JWT_PUBLIC_KEY_PATH)
  : path.resolve(__dirname, '../../keys/public.pem');

const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');

const SESSION_ID = 'test-session-uuid';
const SALLE_ID = 'test-salle-uuid';

describe('tokenService.generateSessionToken', () => {
  test('le TTL du jeton est STRICTEMENT de 25 secondes (exp - iat)', () => {
    const token = generateSessionToken(SESSION_ID, SALLE_ID);
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

    expect(decoded.exp - decoded.iat).toBe(25);
  });

  test('le payload contient un identifiant unique a usage unique (le "nonce" du cahier des charges, implemente comme revendication JWT standard "jti")', () => {
    const token = generateSessionToken(SESSION_ID, SALLE_ID);
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

    expect(decoded).toHaveProperty('jti');
    expect(typeof decoded.jti).toBe('string');
    // Format UUID v4 : 36 caracteres, version "4" et variant "8|9|a|b" aux
    // positions imposees par la RFC 4122.
    expect(decoded.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('deux jetons generes successivement ont des jti distincts (pas de reutilisation de nonce)', () => {
    const decoded1 = jwt.verify(generateSessionToken(SESSION_ID, SALLE_ID), publicKey, { algorithms: ['RS256'] });
    const decoded2 = jwt.verify(generateSessionToken(SESSION_ID, SALLE_ID), publicKey, { algorithms: ['RS256'] });

    expect(decoded1.jti).not.toBe(decoded2.jti);
  });

  test('le payload contient exactement les session_id et salle_id fournis', () => {
    const token = generateSessionToken(SESSION_ID, SALLE_ID);
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

    expect(decoded.session_id).toBe(SESSION_ID);
    expect(decoded.salle_id).toBe(SALLE_ID);
  });

  test('la verification echoue si on force HS256 avec la cle publique comme secret (anti algorithm-confusion)', () => {
    const token = generateSessionToken(SESSION_ID, SALLE_ID);

    expect(() => {
      jwt.verify(token, publicKey, { algorithms: ['HS256'] });
    }).toThrow();
  });

  test('leve une erreur explicite si sessionId ou salleId est manquant', () => {
    expect(() => generateSessionToken(null, SALLE_ID)).toThrow();
    expect(() => generateSessionToken(SESSION_ID, undefined)).toThrow();
    expect(() => generateSessionToken('', '')).toThrow();
  });

  test('rotation (20s) et TTL (25s) respectent le recouvrement de 5s acte lors de la revue de coherence', () => {
    expect(ROTATION_INTERVAL_SECONDS).toBe(20);
    expect(TOKEN_TTL_SECONDS).toBe(25);
    expect(TOKEN_TTL_SECONDS - ROTATION_INTERVAL_SECONDS).toBe(5);
  });
});
