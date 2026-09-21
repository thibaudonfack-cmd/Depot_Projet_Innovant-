// src/components/QRScanner.test.jsx
//
// Commande : docker compose exec frontend npm test
//
// Ce fichier ne teste PAS le rendu du scanner (son apparence releve de la
// revue visuelle) ni le decodage lui-meme (c'est le travail de jsQR, deja
// teste en amont par ses auteurs). Il teste UNE SEULE chose, mais celle qui
// ne se voit pas : la liberation du flux camera.
//
// Pourquoi ce test existe : une fuite ici laisse la camera du telephone
// ALLUMEE en arriere-plan, sans aucun signe dans l'interface. L'utilisateur
// ne s'en apercoit qu'a l'autonomie qui s'effondre -- et le developpeur,
// jamais, puisque tout "a l'air" de fonctionner. C'est exactement le type de
// defaut qu'une revue de code ou un test manuel ne peuvent pas attraper.
//
// Valeur de ce test verifiee par MUTATION (et pas seulement par le fait
// qu'il passe) : en retirant les garde-fous de QRScanner.jsx, le premier
// test ci-dessous echoue bien ; en les restaurant, il repasse. Un test qui
// passe quoi qu'il arrive ne prouverait rien.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import QRScanner from './QRScanner';

/** Faux MediaStream instrumente : permet de compter les appels a track.stop(). */
function fauxFlux() {
  const tracks = [{ kind: 'video', stop: vi.fn(), addEventListener() {}, removeEventListener() {} }];
  return { getTracks: () => tracks, _tracks: tracks };
}

let resoudreGetUserMedia;
let fluxCourant;

beforeEach(() => {
  fluxCourant = fauxFlux();
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  // getUserMedia VOLONTAIREMENT laisse en attente : c'est pendant cette
  // fenetre -- le temps que l'utilisateur reponde a la demande de permission,
  // parfois plusieurs secondes -- que le cas de course se produit.
  navigator.mediaDevices = {
    getUserMedia: vi.fn(() => new Promise((res) => { resoudreGetUserMedia = () => res(fluxCourant); })),
  };
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});

async function monter(ui, { strict = false } = {}) {
  const conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const root = createRoot(conteneur);
  await act(async () => { root.render(strict ? <StrictMode>{ui}</StrictMode> : ui); });
  return { root, conteneur };
}

describe('QRScanner — cycle de vie de la caméra', () => {
  test("CAS CRITIQUE : démontage PENDANT que getUserMedia() est en attente → le flux qui arrive ensuite est bien coupé", async () => {
    const { root } = await monter(<QRScanner onDetection={() => {}} />);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();

    // L'utilisateur ferme le scanner AVANT d'avoir repondu a la permission.
    // La fonction de nettoyage s'execute alors qu'aucun flux n'existe encore :
    // elle n'a rien a arreter.
    await act(async () => { root.unmount(); });

    // La permission est accordee APRES : le flux arrive pour un composant
    // demonte. Sans garde-fou, il ne serait JAMAIS coupe.
    await act(async () => { resoudreGetUserMedia(); await Promise.resolve(); });

    expect(fluxCourant._tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  test('démontage après un démarrage normal → les tracks sont coupés', async () => {
    const { root } = await monter(<QRScanner onDetection={() => {}} />);
    await act(async () => { resoudreGetUserMedia(); await Promise.resolve(); });
    expect(fluxCourant._tracks[0].stop).not.toHaveBeenCalled();

    await act(async () => { root.unmount(); });
    expect(fluxCourant._tracks[0].stop).toHaveBeenCalled();
  });

  test('StrictMode (double montage en développement) ne laisse aucun flux orphelin', async () => {
    // React StrictMode monte, demonte puis remonte chaque composant en
    // developpement, precisement pour reveler les effets mal nettoyes.
    const { root } = await monter(<QRScanner onDetection={() => {}} />, { strict: true });
    await act(async () => { resoudreGetUserMedia?.(); await Promise.resolve(); });
    await act(async () => { root.unmount(); });
    expect(fluxCourant._tracks[0].stop).toHaveBeenCalled();
  });

  test('permission refusée → message actionnable, pas un code technique brut', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(() =>
      Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
    const { conteneur } = await monter(<QRScanner onDetection={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(conteneur.textContent).toMatch(/Accès à la caméra refusé/i);
  });

  test('aucune caméra détectée → message distinct, orientant vers la saisie manuelle', async () => {
    // Message DIFFERENT de celui du refus de permission : les deux exigent
    // des actions opposees de la part de l'utilisateur (autoriser vs changer
    // de methode). Les confondre enverrait l'utilisateur chercher un reglage
    // qui ne resoudra rien.
    navigator.mediaDevices.getUserMedia = vi.fn(() =>
      Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' })));
    const { conteneur } = await monter(<QRScanner onDetection={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(conteneur.textContent).toMatch(/Aucune caméra détectée/i);
  });
});
