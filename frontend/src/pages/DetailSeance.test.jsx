// src/pages/DetailSeance.test.jsx
// Etats visuels du tableau des presences selon le cycle de vie de la seance.
//
// Le defaut corrige ici etait purement visuel, et c'est precisement pour cela
// qu'il merite un test : une seance terminee affichait un tiret dans la
// colonne Depart et un badge vert "En cours". Rien ne plantait, rien
// n'apparaissait dans les journaux -- le formateur lisait simplement autre
// chose que ce que le serveur comptait. Ce genre de regression revient
// silencieusement a la premiere retouche de mise en page.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import DetailSeance from './DetailSeance';

/** Une seance terminee depuis longtemps : aucune ambiguite d'horloge. */
const FIN_PASSEE = new Date(Date.now() - 2 * 3600_000).toISOString();
const DEBUT_PASSE = new Date(Date.now() - 4 * 3600_000).toISOString();
/** Une seance encore en cours. */
const FIN_FUTURE = new Date(Date.now() + 3600_000).toISOString();

function reponsePresences({ terminee, heureFinPrevue, presences }) {
  return {
    status: 'ok',
    seance: {
      id: 'seance-1', statut: 'ouverte', uf_intitule: 'Français langue étrangère',
      salle_nom: 'B-104', heure_debut_prevue: DEBUT_PASSE,
      heure_fin_prevue: heureFinPrevue, terminee,
    },
    presences,
  };
}

const SANS_DEPART = {
  id: 'p1', etudiant_id: 'e1', etudiant_nom: 'Amara Diallo',
  heure_arrivee: DEBUT_PASSE, heure_depart: null, source: 'scan',
  position_coherente: null, distance_m: null, precision_m: null,
  duree_minutes: null, duree_validee_minutes: 120,
};

const AVEC_DEPART = {
  ...SANS_DEPART, id: 'p2', etudiant_id: 'e2', etudiant_nom: 'Bruno Mertens',
  heure_depart: FIN_PASSEE, duree_minutes: 118, duree_validee_minutes: 118,
};

let corpsPresences;

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const corps = String(url).includes('/rectifications')
      ? { status: 'ok', rectifications: [] }
      : corpsPresences;
    return { status: 200, ok: true, json: async () => corps };
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
    root.render(<DetailSeance seanceId="seance-1" onRetour={() => {}} />);
  });
  return conteneur;
}

const texte = (c) => c.textContent;
const bouton = (c, libelle) =>
  [...c.querySelectorAll('button')].find((b) => b.textContent.includes(libelle));

describe('séance EN COURS', () => {
  beforeEach(() => {
    corpsPresences = reponsePresences({
      terminee: false, heureFinPrevue: FIN_FUTURE, presences: [SANS_DEPART],
    });
  });

  test('un départ non pointé reste un tiret : rien n\'est encore déduit', async () => {
    const c = await monter();
    expect(texte(c)).toContain('—');
    expect(texte(c)).not.toContain('déduit');
  });

  test('le badge "En cours" est légitime tant que la séance dure', async () => {
    expect(texte(await monter())).toContain('En cours');
  });

  test('le rapport n\'est PAS proposé : il serait incomplet par construction', async () => {
    // L'offrir inviterait à valider des crédits sur des chiffres mouvants.
    expect(bouton(await monter(), "rapport d'assiduité")).toBeUndefined();
  });
});

describe('séance TERMINÉE', () => {
  beforeEach(() => {
    corpsPresences = reponsePresences({
      terminee: true, heureFinPrevue: FIN_PASSEE, presences: [SANS_DEPART],
    });
  });

  test('le badge "En cours" a DISPARU', async () => {
    // Le défaut signalé, dans sa formulation la plus directe.
    const c = await monter();
    expect(texte(c)).not.toContain('En cours');
    expect(texte(c)).toContain('Terminé');
  });

  test('la colonne Départ affiche l\'heure de fin prévue, marquée "déduit"', async () => {
    const c = await monter();
    expect(texte(c)).toContain('déduit');
    const attendue = new Date(FIN_PASSEE).toLocaleTimeString('fr-BE', {
      hour: '2-digit', minute: '2-digit',
    });
    expect(texte(c)).toContain(attendue);
  });

  test('l\'infobulle explique la déduction sans jargon', async () => {
    const c = await monter();
    const marque = [...c.querySelectorAll('[title]')]
      .find((n) => n.getAttribute('title').includes('Départ automatique'));
    expect(marque).toBeDefined();
  });

  test('la durée affichée est celle VALIDÉE, pas un tiret', async () => {
    // duree_minutes vaut null (pas de départ pointé) ; c'est
    // duree_validee_minutes qui fait foi une fois la séance close.
    expect(texte(await monter())).toContain('2 h');
  });

  test('la légende décrit la PROCÉDURE du second scan, sans accuser', async () => {
    // Un départ déduit est le fonctionnement normal, pas une faute. Le texte
    // doit dire quoi faire pour obtenir mieux.
    const t = texte(await monter());
    expect(t).toContain('Départ automatique');
    expect(t).toContain('scanner le QR code une seconde fois');
    expect(t).not.toContain("n'ont pas pointé");
  });

  test('la mention "Actualisation automatique" disparaît : plus rien ne bouge', async () => {
    expect(texte(await monter())).not.toContain('Actualisation automatique');
  });

  test('le bouton du rapport d\'assiduité est proposé', async () => {
    expect(bouton(await monter(), "rapport d'assiduité")).toBeDefined();
  });

  test('un départ RÉELLEMENT pointé s\'affiche normalement, sans mention', async () => {
    corpsPresences = reponsePresences({
      terminee: true, heureFinPrevue: FIN_PASSEE, presences: [AVEC_DEPART],
    });
    const c = await monter();
    expect(texte(c)).not.toContain('déduit');
    expect(texte(c)).toContain('1 h 58');
  });
});

describe('séance terminée d\'après l\'HORLOGE LOCALE seulement', () => {
  test('la bascule ne dépend pas du drapeau serveur', async () => {
    // Le serveur n'a pas encore rebasculé (dernier rafraîchissement antérieur
    // à la fin), mais l'heure de fin est passée : l'affichage doit suivre
    // sans attendre le prochain appel réseau.
    corpsPresences = reponsePresences({
      terminee: false, heureFinPrevue: FIN_PASSEE, presences: [SANS_DEPART],
    });
    const c = await monter();
    expect(texte(c)).not.toContain('En cours');
    expect(texte(c)).toContain('déduit');
  });
});

describe('séance sans heure de fin prévue', () => {
  test('aucune heure n\'est inventée : le tiret demeure', async () => {
    // Le serveur ne déduit rien non plus dans ce cas (COALESCE sur une valeur
    // absente). Afficher une heure serait afficher autre chose que ce qui est
    // compté.
    corpsPresences = reponsePresences({
      terminee: true, heureFinPrevue: null, presences: [SANS_DEPART],
    });
    const c = await monter();
    expect(texte(c)).not.toContain('déduit');
    expect(texte(c)).toContain('—');
  });
});
