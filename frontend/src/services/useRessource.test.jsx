// src/services/useRessource.test.jsx
// Non-regression sur le rafraichissement periodique.
//
// Trois comportements sont testes parce qu'ils ne se voient pas a l'oeil et
// que leur absence degrade l'experience sans provoquer d'erreur : le
// rafraichissement doit etre SILENCIEUX, la boucle doit s'arreter au
// demontage, et elle doit se suspendre quand l'onglet est masque.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useRessource } from './useRessource';

let appels;

function Sonde({ chemin, intervalleMs, suspendu }) {
  const { donnees, chargement } = useRessource(chemin, { intervalleMs, suspendu });
  return (
    <div>
      <span data-role="chargement">{String(chargement)}</span>
      <span data-role="valeur">{donnees?.valeur ?? ''}</span>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  appels = 0;
  globalThis.fetch = vi.fn(async () => {
    appels += 1;
    return { status: 200, ok: true, json: async () => ({ valeur: `appel-${appels}` }) };
  });
  Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
});

// Les composants montes sont demontes apres CHAQUE test. Sans cela, ceux des
// tests precedents restent attaches au document : leurs ecouteurs
// visibilitychange repondent encore et declenchent des appels
// supplementaires, ce qui faisait echouer le dernier test avec un compteur
// superieur d'une unite. Un test qui ne nettoie pas derriere lui pollue les
// suivants, et le symptome apparait loin de la cause.
const montes = [];

afterEach(async () => {
  for (const root of montes.splice(0)) {
    await act(async () => { root.unmount(); });
  }
  vi.useRealTimers();
});

async function monter(props) {
  const conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const root = createRoot(conteneur);
  montes.push(root);
  await act(async () => { root.render(<Sonde {...props} />); });
  return { root, conteneur };
}

const lire = (c, role) => c.querySelector(`[data-role="${role}"]`).textContent;

describe('useRessource', () => {
  test('charge une premiere fois et signale le chargement initial', async () => {
    const { conteneur } = await monter({ chemin: '/api/x' });
    expect(appels).toBe(1);
    expect(lire(conteneur, 'valeur')).toBe('appel-1');
    expect(lire(conteneur, 'chargement')).toBe('false');
  });

  test("les rafraichissements suivants sont SILENCIEUX (chargement reste faux)", async () => {
    // Un indicateur qui reapparait toutes les cinq secondes serait pire que
    // pas de rafraichissement du tout : la liste clignoterait sous le curseur.
    const { conteneur } = await monter({ chemin: '/api/x', intervalleMs: 5000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(appels).toBe(2);
    expect(lire(conteneur, 'valeur')).toBe('appel-2');
    expect(lire(conteneur, 'chargement')).toBe('false');
  });

  test('CAS CRITIQUE : le demontage arrete la boucle', async () => {
    const { root } = await monter({ chemin: '/api/x', intervalleMs: 5000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(appels).toBe(2);

    await act(async () => { root.unmount(); });
    montes.splice(montes.indexOf(root), 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });

    // Sans nettoyage, l'application continuerait d'interroger le serveur
    // indefiniment apres avoir quitte l'ecran.
    expect(appels).toBe(2);
  });

  test('suspendu : aucune interrogation periodique', async () => {
    await monter({ chemin: '/api/x', intervalleMs: 5000, suspendu: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    // Le chargement initial a bien eu lieu, mais pas la boucle.
    expect(appels).toBe(1);
  });

  test("l'onglet masque suspend la boucle, le retour declenche un rafraichissement immediat", async () => {
    await monter({ chemin: '/api/x', intervalleMs: 5000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(appels).toBe(2);

    document.hidden = true;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(appels).toBe(2); // rien pendant que l'onglet est masque

    document.hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    // Rafraichissement immediat au retour : attendre le prochain tour
    // laisserait l'ecran perime au moment ou on le regarde.
    expect(appels).toBe(3);
  });
});
