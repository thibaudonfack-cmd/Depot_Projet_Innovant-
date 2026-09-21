// src/components/taux.test.js
// Paliers administratifs d'assiduite.
//
// Ces seuils viennent du reglement de la promotion sociale, pas d'un choix
// graphique. Les figer dans un test evite qu'une retouche visuelle ne les
// deplace incidemment : une jauge qui vire au vert a 75 % laisserait croire
// a une validation acquise.

import { describe, test, expect } from 'vitest';
import {
  palier, formaterTaux, formaterRatio, SEUIL_VALIDATION, SEUIL_DECROCHAGE,
} from './taux';

describe('paliers', () => {
  test('les seuils reglementaires sont 80 % et 50 %', () => {
    expect(SEUIL_VALIDATION).toBe(80);
    expect(SEUIL_DECROCHAGE).toBe(50);
  });

  test('les bornes sont INCLUSIVES', () => {
    // Exactement 80 % valide. Une comparaison stricte priverait de leur
    // validation les etudiants pile au seuil, ce qui ne se remarquerait que
    // sur un cas reel.
    expect(palier(80)).toBe('atteint');
    expect(palier(79.9)).toBe('partiel');
    expect(palier(50)).toBe('partiel');
    expect(palier(49.9)).toBe('insuffisant');
  });

  test('un taux inconnu n\'est pas traite comme un zero', () => {
    expect(palier(null)).toBe('inconnu');
    expect(palier(undefined)).toBe('inconnu');
    expect(palier(0)).toBe('insuffisant');
  });
});

describe('mise en forme', () => {
  test('la virgule decimale francophone est respectee', () => {
    expect(formaterTaux(92.5)).toBe('92,5 %');
    expect(formaterTaux(100)).toBe('100 %');
  });

  test('un taux absent affiche un tiret, jamais "null %"', () => {
    expect(formaterTaux(null)).toBe('—');
  });

  test('le ratio affiche TOUJOURS son denominateur', () => {
    // « 2 h 30 » ne se compare a rien ; « 2 h 30 / 3 h 00 » se lit d'un coup.
    expect(formaterRatio(150, 180)).toBe('2 h 30 / 3 h 00');
    expect(formaterRatio(0, 180)).toBe('0 h 00 / 3 h 00');
  });

  test('sans reference, seule la duree est affichee', () => {
    expect(formaterRatio(150, 0)).toBe('2 h 30');
    expect(formaterRatio(null, null)).toBe('—');
  });
});
