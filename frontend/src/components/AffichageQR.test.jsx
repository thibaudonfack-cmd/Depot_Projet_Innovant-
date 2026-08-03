// src/components/AffichageQR.test.jsx
// Non-regression sur le cycle de vie du flux WebSocket.
//
// Meme preoccupation que pour la camera (Etape 6) : une connexion non fermee
// ne se voit pas a l'ecran. Le serveur continuerait de pousser un jeton
// toutes les vingt secondes vers une connexion que plus personne n'ecoute,
// et chaque ouverture d'ecran en laisserait une de plus derriere elle.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import AffichageQR from './AffichageQR';

let socketsCrees;

beforeEach(() => {
  socketsCrees = [];
  class FauxWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.close = vi.fn(() => { this.readyState = 3; });
      socketsCrees.push(this);
    }
    ouvrir() { this.readyState = 1; this.onopen?.(); }
    recevoir(donnees) { this.onmessage?.({ data: JSON.stringify(donnees) }); }
  }
  globalThis.WebSocket = FauxWebSocket;
  Object.defineProperty(window, 'location', {
    value: { host: 'localhost' }, writable: true, configurable: true,
  });
});

async function monter(ui) {
  const conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const root = createRoot(conteneur);
  await act(async () => { root.render(<StrictMode>{ui}</StrictMode>); });
  return { root, conteneur };
}

describe('AffichageQR — flux de jetons', () => {
  test('sans seanceId, aucune connexion n\'est ouverte (mode statique)', async () => {
    await monter(<AffichageQR valeur="contenu-fixe" />);
    expect(socketsCrees).toHaveLength(0);
  });

  test('avec seanceId, la connexion cible bien la séance et utilise wss://', async () => {
    await monter(<AffichageQR seanceId="seance-42" />);
    expect(socketsCrees.length).toBeGreaterThan(0);
    // wss et non ws : la page est servie en HTTPS, un socket en clair serait
    // bloqué par le navigateur (contenu mixte).
    expect(socketsCrees[0].url).toBe('wss://localhost/api/ws/seances/seance-42');
  });

  test("aucun QR n'est affiché tant qu'aucun jeton n'est arrivé", async () => {
    // Mieux vaut un espace vide qu'un code que personne ne pourrait valider.
    const { conteneur } = await monter(<AffichageQR seanceId="seance-42" />);
    expect(conteneur.querySelector('svg[height]')).toBeNull();
    expect(conteneur.textContent).toMatch(/En attente du premier jeton/);
  });

  test('un jeton reçu fait apparaître le QR', async () => {
    const { conteneur } = await monter(<AffichageQR seanceId="seance-42" />);
    await act(async () => {
      socketsCrees[socketsCrees.length - 1].ouvrir();
      socketsCrees[socketsCrees.length - 1].recevoir({ type: 'token', token: 'jeton.abc.def' });
    });
    expect(conteneur.textContent).not.toMatch(/En attente du premier jeton/);
    expect(conteneur.textContent).toMatch(/Jeton renouvelé automatiquement/);
  });

  test('CAS CRITIQUE : le démontage ferme la connexion', async () => {
    const { root } = await monter(<AffichageQR seanceId="seance-42" />);
    await act(async () => { root.unmount(); });
    // Toutes les connexions ouvertes, y compris celles creees par le double
    // montage de StrictMode, doivent avoir ete fermees.
    expect(socketsCrees.every((s) => s.close.mock.calls.length > 0)).toBe(true);
  });

  test('un message inattendu ne casse pas l\'affichage', async () => {
    const { conteneur } = await monter(<AffichageQR seanceId="seance-42" />);
    await act(async () => {
      const ws = socketsCrees[socketsCrees.length - 1];
      ws.ouvrir();
      ws.onmessage({ data: 'ceci-n-est-pas-du-json' });
      ws.recevoir({ type: 'token', token: 'jeton.valide' });
    });
    // Un QR perime vaut mieux qu'un ecran blanc devant une classe.
    expect(conteneur.textContent).toMatch(/Jeton renouvelé automatiquement/);
  });
});
