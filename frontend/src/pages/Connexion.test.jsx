// src/pages/Connexion.test.jsx
// Non-regression sur la redirection apres connexion.
//
// Ce test existe a cause d'un defaut concret : la premiere version naviguait
// depuis DEUX endroits (la fonction de soumission et un effet), et ne
// remettait jamais envoiEnCours a false en cas de succes. Des que la
// navigation tardait, le bouton restait fige sur "Connexion en cours" sans
// message d'erreur, et seul un rafraichissement manuel debloquait la page.
//
// Les appels reseau sont volontairement RALENTIS : un mock instantane masque
// completement ce type de course.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';

const ETUDIANT = { id: 'u1', email: 'amara.diallo@example.org', nom: 'Amara Diallo', role: 'etudiant', etudiant_id: 'e1' };
const FORMATEUR = { id: 'u5', email: 'formateur@example.org', nom: 'Sophie Lambert', role: 'formateur', etudiant_id: null };

let utilisateurConnecte = null;

function installerReseau(profil) {
  utilisateurConnecte = null;
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    await new Promise((r) => setTimeout(r, 25));
    const rep = (statut, corps) => ({ status: statut, ok: statut < 400, json: async () => corps });

    if (url === '/api/auth/moi') {
      return utilisateurConnecte
        ? rep(200, { status: 'ok', utilisateur: utilisateurConnecte })
        : rep(401, { status: 'error', code: 'NON_AUTHENTIFIE' });
    }
    if (url === '/api/auth/login' && options.method === 'POST') {
      utilisateurConnecte = profil;
      return rep(200, { status: 'ok', utilisateur: profil });
    }
    return rep(200, { status: 'ok' });
  });
}

beforeEach(() => {
  window.history.pushState({}, '', '/login');
  navigator.mediaDevices = { getUserMedia: vi.fn(() => new Promise(() => {})) };
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});

async function monterApplication() {
  const conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const root = createRoot(conteneur);
  await act(async () => { root.render(<StrictMode><App /></StrictMode>); });
  await stabiliser();
  return conteneur;
}

async function stabiliser() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

async function soumettreConnexion(conteneur, email, motDePasse) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    const champEmail = conteneur.querySelector('#email');
    const champMdp = conteneur.querySelector('#mot-de-passe');
    setter.call(champEmail, email);
    champEmail.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(champMdp, motDePasse);
    champMdp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    conteneur.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await stabiliser();
}

describe('Connexion — redirection', () => {
  test('un étudiant arrive sur son tableau de bord sans rechargement', async () => {
    installerReseau(ETUDIANT);
    const conteneur = await monterApplication();
    await soumettreConnexion(conteneur, ETUDIANT.email, 'Etudiant123!');

    expect(window.location.pathname).toBe('/etudiant');
    expect(conteneur.textContent).toMatch(/Espace étudiant/);
    // Le formulaire ne doit plus etre a l'ecran.
    expect(conteneur.querySelector('#mot-de-passe')).toBeNull();
  });

  test('un formateur arrive sur son tableau de bord sans rechargement', async () => {
    installerReseau(FORMATEUR);
    const conteneur = await monterApplication();
    await soumettreConnexion(conteneur, FORMATEUR.email, 'Formateur123!');

    expect(window.location.pathname).toBe('/formateur');
    expect(conteneur.textContent).toMatch(/Espace formateur/);
  });

  test("le bouton ne reste jamais bloqué sur « Connexion en cours »", async () => {
    // Symptome exact du defaut corrige : en cas d'echec, le bouton restait
    // en etat de chargement et la page paraissait figee.
    installerReseau(ETUDIANT);
    globalThis.fetch = vi.fn(async (url) => {
      await new Promise((r) => setTimeout(r, 25));
      if (url === '/api/auth/moi') return { status: 401, ok: false, json: async () => ({ code: 'NON_AUTHENTIFIE' }) };
      return { status: 401, ok: false, json: async () => ({ status: 'error', code: 'IDENTIFIANTS_INVALIDES', message: 'Email ou mot de passe incorrect.' }) };
    });

    const conteneur = await monterApplication();
    await soumettreConnexion(conteneur, ETUDIANT.email, 'mauvais');

    expect(window.location.pathname).toBe('/login');
    expect(conteneur.textContent).toMatch(/Email ou mot de passe incorrect/);
    expect(conteneur.textContent).not.toMatch(/Connexion en cours/);
  });

  test("une destination mémorisée incompatible avec le rôle n'est pas suivie", async () => {
    // Un etudiant ayant tente d'ouvrir /formateur ne doit pas y etre envoye
    // apres connexion, sous peine d'un aller-retour visible.
    installerReseau(ETUDIANT);
    window.history.pushState({ usr: { depuis: '/formateur' } }, '', '/login');
    const conteneur = await monterApplication();
    await soumettreConnexion(conteneur, ETUDIANT.email, 'Etudiant123!');

    expect(window.location.pathname).toBe('/etudiant');
  });
});
