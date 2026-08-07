// src/pages/BilanUf.test.jsx
// Bilan global par UF et garde-fous de la cloture RGPD (Etape 9).

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { FournisseurAuth } from '../context/AuthContext';
import BilanUf from './BilanUf';

const UF = [
  { id: 'uf-1', intitule: 'Anglais - Niveau 2', date_cloture_rgpd: null, cloturee_rgpd: false },
  { id: 'uf-2', intitule: 'Bureautique', date_cloture_rgpd: '2026-06-30T10:00:00.000Z', cloturee_rgpd: true },
];

function bilan(surcharges = {}) {
  return {
    status: 'ok',
    uf: { id: 'uf-1', intitule: 'Anglais - Niveau 2', date_cloture_rgpd: null, cloturee_rgpd: false },
    synthese: {
      inscrits: 2, seances_total: 3, seances_terminees: 2,
      premiere_seance: '2026-02-01T09:00:00.000Z', derniere_seance: '2026-05-30T12:00:00.000Z',
      minutes_validees_total: 540, provisoire: true, demandes_en_attente: 0,
    },
    etudiants: [
      {
        etudiant_id: 'e1', nom: 'Amara Diallo', email: 'amara@example.be',
        seances_prevues: 2, presences: 2, absences: 0, minutes_validees: 360,
        departs_deduits: 1, demandes_en_attente: 0, taux_presence: 100,
      },
      {
        etudiant_id: 'e2', nom: 'Bilal Ozturk', email: 'bilal@example.be',
        seances_prevues: 2, presences: 1, absences: 1, minutes_validees: 180,
        departs_deduits: 0, demandes_en_attente: 0, taux_presence: 50,
      },
    ],
    ...surcharges,
  };
}

let reponseBilan;
let appelsCloture;

// jsdom n'implemente pas showModal()/close() de <dialog>. Le comportement
// natif n'est pas ce qui est teste ici -- seul compte le contenu rendu et
// l'etat des boutons -- d'ou ce complement minimal qui se contente de
// refleter l'attribut `open`.
beforeEach(() => {
  if (!window.HTMLDialogElement.prototype.showModal) {
    window.HTMLDialogElement.prototype.showModal = function ouvrir() { this.open = true; };
    window.HTMLDialogElement.prototype.close = function fermer() { this.open = false; };
  }
});

beforeEach(() => {
  reponseBilan = bilan();
  appelsCloture = [];
  globalThis.fetch = vi.fn(async (url, options) => {
    const u = String(url);
    if (u.includes('cloture-rgpd')) {
      appelsCloture.push(JSON.parse(options.body));
      return {
        status: 200, ok: true,
        json: async () => ({ status: 'ok', detruit: { positions: 7, scans_anonymises: 12 } }),
      };
    }
    if (u.includes('rapport-global')) return { status: 200, ok: true, json: async () => reponseBilan };
    // EnTeteApplication consomme le contexte d'authentification, qui
    // interroge /api/auth/moi au montage.
    if (u.includes('/auth/moi')) {
      return {
        status: 200, ok: true,
        json: async () => ({
          status: 'ok',
          utilisateur: { id: 'u1', email: 'formateur@example.be', role: 'formateur', nom: 'Formateur Test' },
        }),
      };
    }
    return { status: 200, ok: true, json: async () => ({ status: 'ok', uf: UF }) };
  });
});

const montes = [];
afterEach(async () => {
  for (const root of montes.splice(0)) await act(async () => { root.unmount(); });
  vi.restoreAllMocks();
});

async function monter() {
  const conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const root = createRoot(conteneur);
  montes.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter><FournisseurAuth><BilanUf /></FournisseurAuth></MemoryRouter>
    );
  });
  return conteneur;
}

const texte = (c) => c.textContent;
const bouton = (c, libelle) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes(libelle));

describe('tableau du bilan', () => {
  test('chaque inscrit figure avec son cumul', async () => {
    const c = await monter();
    expect(texte(c)).toContain('Amara Diallo');
    expect(texte(c)).toContain('Bilal Ozturk');
    expect(texte(c)).toContain('2 / 2');
    expect(texte(c)).toContain('1 / 2');
  });

  test('le taux est affiché en chiffres, pas seulement en couleur', async () => {
    // Une barre seule serait invisible pour une personne daltonienne et
    // illisible à l'impression noir et blanc (WCAG 1.4.1).
    const c = await monter();
    expect(texte(c)).toContain('100 %');
    expect(texte(c)).toContain('50 %');
  });

  test('les départs automatiques sont signalés sous le total', async () => {
    expect(texte(await monter())).toContain('1 départ(s) automatique(s)');
  });

  test('une UF dont aucune séance n\'est terminée n\'affiche pas NaN', async () => {
    reponseBilan.etudiants.forEach((e) => { e.taux_presence = null; e.seances_prevues = 0; });
    const c = await monter();
    expect(texte(c)).not.toContain('NaN');
  });

  test('un bilan incomplet est signalé comme provisoire', async () => {
    const c = await monter();
    expect(texte(c)).toContain('Provisoire');
    expect(texte(c)).toContain("ne sont pas encore terminées");
  });

  test('une contestation pendante affiche la bannière ambre', async () => {
    reponseBilan.synthese.demandes_en_attente = 1;
    reponseBilan.etudiants[0].demandes_en_attente = 1;
    const c = await monter();
    expect(texte(c)).toContain('Ce bilan est provisoire');
    expect(texte(c)).toContain('Contestation en cours');
  });
});

describe('clôture RGPD', () => {
  test('le bouton de clôture est proposé sur une UF non clôturée', async () => {
    expect(bouton(await monter(), 'purger les métadonnées')).toBeDefined();
  });

  test('il DISPARAÎT sur une UF déjà clôturée', async () => {
    // Rien ne doit inviter à relancer une destruction déjà faite.
    reponseBilan.uf.cloturee_rgpd = true;
    reponseBilan.uf.date_cloture_rgpd = '2026-06-30T10:00:00.000Z';
    const c = await monter();
    expect(bouton(c, 'purger les métadonnées')).toBeUndefined();
    expect(texte(c)).toContain('Clôturée');
    expect(texte(c)).toContain('ont été détruites');
  });

  test('la modale distingue ce qui est détruit de ce qui est conservé', async () => {
    const c = await monter();
    await act(async () => { bouton(c, 'purger les métadonnées').click(); });
    const modale = document.querySelector('dialog');
    expect(modale.textContent).toContain('Détruit');
    expect(modale.textContent).toContain('Coordonnées GPS');
    expect(modale.textContent).toContain('Conservé 5 ans');
    expect(modale.textContent).toContain("Heures d'arrivée et de départ");
    expect(modale.textContent).toContain('irréversible');
  });

  test('LE GARDE-FOU : le bouton reste désactivé sans la saisie exacte', async () => {
    // Une action irréversible ne doit pas pouvoir partir sur un clic réflexe.
    const c = await monter();
    await act(async () => { bouton(c, 'purger les métadonnées').click(); });
    const valider = bouton(c, 'Clôturer et purger');
    expect(valider.disabled).toBe(true);

    const champ = document.querySelector('#confirmation-cloture');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;

    await act(async () => {
      setter.call(champ, 'peu importe');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(bouton(c, 'Clôturer et purger').disabled).toBe(true);

    await act(async () => {
      setter.call(champ, 'CLOTURER');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(bouton(c, 'Clôturer et purger').disabled).toBe(false);
  });

  test('la confirmation est bien transmise au serveur', async () => {
    // La modale ne protège que d'un clic distrait ; le serveur revérifie.
    const c = await monter();
    await act(async () => { bouton(c, 'purger les métadonnées').click(); });
    const champ = document.querySelector('#confirmation-cloture');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    await act(async () => {
      setter.call(champ, 'CLOTURER');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { bouton(c, 'Clôturer et purger').click(); });

    expect(appelsCloture).toHaveLength(1);
    expect(appelsCloture[0].confirmation).toBe('CLOTURER');
  });
});
