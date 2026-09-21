// src/pages/TableauBordEtudiant.test.jsx
// Le bouton d'association ne doit PAS etre propose sur un appareil deja lie.
//
// Defaut corrige (Etape 12) : sur un telephone deja enrole, le bouton restait
// cliquable sous le libelle "Associer a nouveau cet appareil". Un clic par
// megarde regenerait une paire de cles sur ce meme appareil et consommait
// l'unique credit de secours du quota -- sans rien apporter, puisque
// l'appareil etait deja lie.
//
// C'etait une friction PUNITIVE : elle sanctionnait la maladresse, pas la
// fraude. Ces tests verrouillent la correction, et surtout ses limites : le
// bouton doit rester propose dans tous les autres cas, y compris quand l'etat
// de l'appareil n'a pas pu etre verifie.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { FournisseurAuth } from '../context/AuthContext';

// IndexedDB et WebCrypto n'existent pas dans jsdom. Ce qui est teste ici est
// la DECISION d'afficher ou non le bouton a partir de l'etat local, pas la
// cryptographie elle-meme -- deja couverte cote backend.
const etatLocal = { idAppareil: null, possedeCle: false };
vi.mock('../services/CryptoService', () => ({
  lireIdAppareil: async () => etatLocal.idAppareil,
  possedeDejaUneCle: async () => etatLocal.possedeCle,
  generateAndStoreKeyPair: async () => {},
  exportPublicKey: async () => 'pem-factice',
  signData: async () => 'signature-factice',
  memoriserIdAppareil: async () => {},
}));

// Le lecteur de QR ouvre la camera au montage : hors sujet ici.
vi.mock('../components/QRScanner', () => ({ default: () => null }));

const TableauBordEtudiant = (await import('./TableauBordEtudiant')).default;

const APPAREIL_SERVEUR = {
  id: 'appareil-1',
  info_appareil: 'Pixel 7',
  date_enrolement: '2026-08-01T09:00:00.000Z',
};

let reponseAppareil;

beforeEach(() => {
  etatLocal.idAppareil = null;
  etatLocal.possedeCle = false;
  reponseAppareil = {
    status: 'ok',
    appareil: APPAREIL_SERVEUR,
    quota: { consommes: 1, maximum: 2, restants: 1 },
  };

  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    const rep = (corps) => ({ status: 200, ok: true, json: async () => corps });
    if (u.includes('/api/mon-appareil')) return rep(reponseAppareil);
    if (u.includes('/api/mes-presences')) return rep({ status: 'ok', presences: [] });
    if (u.includes('/api/auth/moi')) {
      return rep({
        status: 'ok',
        utilisateur: {
          id: 'u1', email: 'amara.diallo@example.org', nom: 'Amara Diallo',
          role: 'etudiant', etudiant_id: 'e1',
        },
      });
    }
    return rep({ status: 'ok' });
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
      <MemoryRouter><FournisseurAuth><TableauBordEtudiant /></FournisseurAuth></MemoryRouter>
    );
  });
  return conteneur;
}

const boutonAssocier = (conteneur) =>
  [...conteneur.querySelectorAll('button')].find((b) => b.textContent.includes('Associer'));

// ==========================================================================
describe('Appareil DEJA ASSOCIE', () => {
  beforeEach(() => {
    // Les trois conditions de l'etat 'actif' : cle presente, identifiant
    // memorise, et identifiant egal a celui que le serveur declare actif.
    etatLocal.idAppareil = APPAREIL_SERVEUR.id;
    etatLocal.possedeCle = true;
  });

  test('LE TEST CENTRAL : le bouton d\'association n\'est PAS rendu', async () => {
    // Ni desactive, ni masque visuellement : absent du DOM. Un bouton
    // desactive reste annonce par les lecteurs d'ecran et suggere une action
    // possible.
    const conteneur = await monter();
    expect(boutonAssocier(conteneur)).toBeUndefined();
  });

  test('un message de confirmation prend sa place', async () => {
    const conteneur = await monter();
    expect(conteneur.textContent).toContain('Cet appareil est déjà lié à votre compte');
    expect(conteneur.textContent).toContain('Aucune action');
  });

  test('l\'avertissement de quota DISPARAIT : il n\'avertit plus de rien', async () => {
    // Sans bouton a l'ecran, il ne previendrait aucune action et ne ferait
    // qu'inquieter.
    const conteneur = await monter();
    expect(conteneur.textContent).not.toContain('par mesure de sécurité');
  });

  test('le solde restant est tout de meme rappele, sobrement', async () => {
    // Utile pour anticiper un futur changement de telephone.
    const conteneur = await monter();
    expect(conteneur.textContent).toContain('une association');
  });
});

// ==========================================================================
describe('Cas ou le bouton DOIT rester propose', () => {
  test('appareil vierge : aucune cle locale, aucun appareil serveur', async () => {
    reponseAppareil.appareil = null;
    reponseAppareil.quota = { consommes: 0, maximum: 2, restants: 2 };
    const conteneur = await monter();
    expect(boutonAssocier(conteneur)).toBeDefined();
  });

  test('appareil vierge alors qu\'un AUTRE est actif cote serveur', async () => {
    // Cas du nouveau telephone : le serveur connait un appareil, celui-ci
    // n'a aucune cle. C'est precisement la situation ou l'association sert.
    etatLocal.idAppareil = null;
    etatLocal.possedeCle = false;
    const conteneur = await monter();
    expect(boutonAssocier(conteneur)).toBeDefined();
  });

  test('appareil DISSOCIE : une cle locale, mais un autre appareil actif', async () => {
    etatLocal.idAppareil = 'ancien-appareil';
    etatLocal.possedeCle = true;
    const conteneur = await monter();
    expect(boutonAssocier(conteneur)).toBeDefined();
    expect(conteneur.textContent).toContain('Cet appareil a été dissocié');
  });

  test('identifiant memorise SANS cle privee : le bouton reste propose', async () => {
    // IndexedDB vide par le navigateur, ou identifiant recopie sans la cle.
    // Sans cle privee, impossible de signer : l'appareil doit se ré-enrôler.
    etatLocal.idAppareil = APPAREIL_SERVEUR.id;
    etatLocal.possedeCle = false;
    const conteneur = await monter();
    expect(boutonAssocier(conteneur)).toBeDefined();
  });

  test('ETAT INCONNU : le bouton reste propose plutot que de bloquer', async () => {
    // Choix delibere. Bloquer sur un etat non verifie empecherait un etudiant
    // sur un telephone neuf de s'enroler pour une simple coupure reseau --
    // defaut plus grave que celui corrige ici.
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/mon-appareil')) throw new Error('Reseau indisponible');
      return { status: 200, ok: true, json: async () => ({ status: 'ok', presences: [] }) };
    });
    const conteneur = await monter();
    expect(boutonAssocier(conteneur)).toBeDefined();
    expect(conteneur.textContent).toContain('Impossible de vérifier');
  });

  test('QUOTA EPUISE : le bouton existe mais est desactive', async () => {
    // Distinction voulue avec le cas "deja associe" : ici l'action serait
    // legitime, c'est le credit qui manque. Le bouton doit donc rester
    // visible pour que le refus soit comprehensible.
    etatLocal.idAppareil = 'ancien-appareil';
    etatLocal.possedeCle = true;
    reponseAppareil.quota = { consommes: 2, maximum: 2, restants: 0 };
    const conteneur = await monter();

    const bouton = boutonAssocier(conteneur);
    expect(bouton).toBeDefined();
    expect(bouton.disabled).toBe(true);
    expect(conteneur.textContent).toContain('Nombre maximal d\'associations atteint');
  });
});
