// src/services/useSeanceTerminee.test.jsx
// Bascule "en cours" -> "terminee" cote client.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useSeanceTerminee } from './useSeanceTerminee';

function Sonde({ termineeServeur, heureFinPrevue }) {
  const terminee = useSeanceTerminee(termineeServeur, heureFinPrevue);
  return <span data-role="etat">{String(terminee)}</span>;
}

const montes = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const root of montes.splice(0)) await act(async () => { root.unmount(); });
  vi.useRealTimers();
});

async function monter(props) {
  const conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const root = createRoot(conteneur);
  montes.push(root);
  await act(async () => { root.render(<Sonde {...props} />); });
  return conteneur;
}

const lire = (c) => c.querySelector('[data-role="etat"]').textContent;

describe('useSeanceTerminee', () => {
  test('le drapeau SERVEUR prime : il est suivi sans discuter', async () => {
    const dansUneHeure = new Date(Date.now() + 3600_000).toISOString();
    const c = await monter({ termineeServeur: true, heureFinPrevue: dansUneHeure });
    // L'horloge locale dirait "pas encore", mais le serveur fait autorite.
    expect(lire(c)).toBe('true');
  });

  test("une horloge locale en retard ne peut pas faire réapparaître une séance terminée", async () => {
    // Asymétrie voulue : l'erreur possible est toujours du côté inoffensif.
    const c = await monter({
      termineeServeur: true,
      heureFinPrevue: new Date(Date.now() + 10 * 3600_000).toISOString(),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(lire(c)).toBe('true');
  });

  test('la bascule se produit SANS appel réseau quand l\'heure de fin est atteinte', async () => {
    // C'est tout l'intérêt : sans cela, la séance afficherait "En cours"
    // jusqu'au prochain rafraîchissement.
    const dans30s = new Date(Date.now() + 30_000).toISOString();
    const c = await monter({ termineeServeur: false, heureFinPrevue: dans30s });
    expect(lire(c)).toBe('false');

    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(lire(c)).toBe('true');
  });

  test('une séance déjà passée est terminée dès le premier rendu', async () => {
    const c = await monter({
      termineeServeur: false,
      heureFinPrevue: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(lire(c)).toBe('true');
  });

  test('sans heure de fin, on s\'en remet entièrement au serveur', async () => {
    // Séances créées avant l'introduction des horaires prévus : seule la
    // clôture manuelle fait alors foi.
    const c = await monter({ termineeServeur: false, heureFinPrevue: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(lire(c)).toBe('false');
  });
});
