// tests/geofencing.test.js
// Distance geographique et evaluation de coherence (RF-13, Etape 7e).
//
// Tests unitaires purs : aucune base, aucun reseau. Le geofencing est de
// l'arithmetique sur des coordonnees, il doit se verifier comme tel.

const {
  distanceHaversineM, evaluerPosition, coordonneeValide,
  RAYON_TOLERANCE_DEFAUT_M, PRECISION_MAX_EXPLOITABLE_M,
} = require('../src/services/geofencingService');

// Salle du jeu de demonstration (02-seed.sql), pres de Namur.
const REFERENCE = { latitude: 50.4674, longitude: 4.8718 };

/** Decale une position de `metres` vers le nord. 1 degre de latitude ~ 111 320 m. */
function versLeNord(reference, metres) {
  return { ...reference, latitude: reference.latitude + metres / 111320 };
}

describe('distanceHaversineM', () => {
  test('distance nulle entre un point et lui-meme', () => {
    expect(distanceHaversineM(50.4674, 4.8718, 50.4674, 4.8718)).toBe(0);
  });

  test('correspond a une distance connue (Paris - Londres, ~343 km)', () => {
    // Point de controle externe : sans reference connue, une formule erronee
    // resterait cohérente avec elle-meme et passerait tous les autres tests.
    const km = distanceHaversineM(48.8530, 2.3499, 51.5007, -0.1246) / 1000;
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(347);
  });

  test('un deplacement de 100 m vers le nord mesure bien ~100 m', () => {
    const d = distanceHaversineM(
      REFERENCE.latitude, REFERENCE.longitude,
      versLeNord(REFERENCE, 100).latitude, REFERENCE.longitude
    );
    expect(Math.round(d)).toBeGreaterThan(98);
    expect(Math.round(d)).toBeLessThan(102);
  });

  test('la distance est symetrique', () => {
    const a = distanceHaversineM(50.46, 4.87, 50.47, 4.88);
    const b = distanceHaversineM(50.47, 4.88, 50.46, 4.87);
    expect(Math.round(a)).toBe(Math.round(b));
  });
});

describe('coordonneeValide', () => {
  test('rejette les valeurs hors bornes et non numeriques', () => {
    expect(coordonneeValide(91, 0)).toBe(false);
    expect(coordonneeValide(0, 181)).toBe(false);
    expect(coordonneeValide(NaN, 4.87)).toBe(false);
    expect(coordonneeValide(undefined, undefined)).toBe(false);
  });

  test('rejette (0, 0), qui est en pratique une valeur mal initialisee', () => {
    // Au large du golfe de Guinee : jamais la position reelle d'un etudiant.
    expect(coordonneeValide(0, 0)).toBe(false);
  });

  test('accepte une coordonnee belge plausible', () => {
    expect(coordonneeValide(50.4674, 4.8718)).toBe(true);
  });
});

describe('evaluerPosition', () => {
  test('dans le rayon : coherente', () => {
    const r = evaluerPosition({
      reference: REFERENCE,
      scan: { ...versLeNord(REFERENCE, 30), precisionM: 10 },
    });
    expect(r.coherente).toBe(true);
    expect(r.motif).toBe('DANS_ZONE');
    expect(r.distanceM).toBeGreaterThan(25);
  });

  test('nettement hors du rayon : incoherente', () => {
    const r = evaluerPosition({
      reference: REFERENCE,
      scan: { ...versLeNord(REFERENCE, 800), precisionM: 10 },
    });
    expect(r.coherente).toBe(false);
    expect(r.motif).toBe('HORS_ZONE');
  });

  test("L'INCERTITUDE EST DEDUITE AVANT DE JUGER : 140 m avec 60 m de marge reste accepte", () => {
    // Regle centrale : on ne declare une position incoherente que si elle
    // l'est MEME en accordant a l'appareil tout le benefice de son
    // incertitude. Comparer la distance brute au rayon signalerait a tort des
    // etudiants presents dont le telephone capte mal -- exactement la
    // population que ce dispositif ne doit pas penaliser.
    const r = evaluerPosition({
      reference: REFERENCE,
      scan: { ...versLeNord(REFERENCE, 140), precisionM: 60 },
    });
    expect(r.coherente).toBe(true);
  });

  test('la meme distance sans incertitude est, elle, rejetee', () => {
    // Confirme que le test precedent tient bien a la marge et non au rayon.
    const r = evaluerPosition({
      reference: REFERENCE,
      scan: { ...versLeNord(REFERENCE, 140), precisionM: 5 },
    });
    expect(r.coherente).toBe(false);
  });

  test('TROIS ETATS : sans reference de seance, le resultat est null et non false', () => {
    // null signifie "indeterminable", false signifie "hors zone". Les
    // confondre reviendrait a signaler un etudiant alors que c'est le
    // formateur qui n'a pas partage sa position.
    const r = evaluerPosition({ reference: null, scan: { ...REFERENCE, precisionM: 10 } });
    expect(r.coherente).toBeNull();
    expect(r.motif).toBe('AUCUNE_REFERENCE');
  });

  test('sans position de l\'etudiant : null', () => {
    const r = evaluerPosition({ reference: REFERENCE, scan: null });
    expect(r.coherente).toBeNull();
    expect(r.motif).toBe('POSITION_ABSENTE');
  });

  test('precision trop mauvaise : null, mais la distance est tout de meme consignee', () => {
    const r = evaluerPosition({
      reference: REFERENCE,
      scan: { ...versLeNord(REFERENCE, 900), precisionM: PRECISION_MAX_EXPLOITABLE_M + 50 },
    });
    expect(r.coherente).toBeNull();
    expect(r.motif).toBe('PRECISION_INSUFFISANTE');
    // La distance reste exploitable a posteriori, meme si elle ne permet pas
    // de conclure aujourd'hui.
    expect(r.distanceM).toBeGreaterThan(800);
  });

  test('un rayon propre a la seance prime sur la valeur par defaut', () => {
    const scan = { ...versLeNord(REFERENCE, 300), precisionM: 5 };
    expect(evaluerPosition({ reference: REFERENCE, scan }).coherente).toBe(false);
    expect(evaluerPosition({ reference: REFERENCE, scan, rayonToleranceM: 500 }).coherente).toBe(true);
  });

  test('la tolerance par defaut est large, comme l\'exige le GPS en interieur', () => {
    // Une tolerance de quelques metres n'aurait aucun sens : en interieur le
    // telephone bascule souvent sur le Wi-Fi ou la cellule, a plusieurs
    // dizaines de metres pres.
    expect(RAYON_TOLERANCE_DEFAUT_M).toBeGreaterThanOrEqual(75);
  });
});
