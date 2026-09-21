// src/pages/RapportSeance.test.jsx
// Rapport d'assiduite : presence des absents, statuts, banniere de conformite.
//
// Ce document sert a valider des credits de formation. Les trois choses qui
// doivent etre vraies quoi qu'il arrive : tous les inscrits y figurent, une
// valeur deduite n'est jamais presentee comme constatee, et une contestation
// pendante est signalee AVANT les chiffres qu'elle relativise.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import RapportSeance from './RapportSeance';

const DEBUT = new Date(Date.now() - 4 * 3600_000).toISOString();
const FIN = new Date(Date.now() - 2 * 3600_000).toISOString();

function corps(surcharges = {}) {
  return {
    status: 'ok',
    seance: {
      id: 'seance-1', uf_intitule: 'Français langue étrangère', salle_nom: 'B-104',
      heure_debut_prevue: DEBUT, heure_fin_prevue: FIN, terminee: true,
    },
    synthese: {
      attendus: 3, presents: 2, absents: 1, presents_non_inscrits: 0,
      minutes_validees_total: 235, provisoire: false, demandes_en_attente: 0,
    },
    etudiants: [
      {
        etudiant_id: 'e1', nom: 'Amara Diallo', email: 'amara@example.be', present: true, inscrit: true,
        heure_arrivee: DEBUT, heure_depart_saisie: null, heure_fin_retenue: FIN,
        depart_deduit: true, minutes_validees: 120,
        position_coherente: true, demande_en_attente: false,
      },
      {
        etudiant_id: 'e2', nom: 'Bruno Mertens', email: 'bruno@example.be', present: true, inscrit: true,
        heure_arrivee: DEBUT, heure_depart_saisie: FIN, heure_fin_retenue: FIN,
        depart_deduit: false, minutes_validees: 115,
        position_coherente: null, demande_en_attente: false,
      },
      {
        etudiant_id: 'e3', nom: 'Chiara Rossi', email: 'chiara@example.be', present: false, inscrit: true,
        heure_arrivee: null, heure_depart_saisie: null, heure_fin_retenue: FIN,
        depart_deduit: false, minutes_validees: null,
        position_coherente: null, demande_en_attente: false,
      },
    ],
    ...surcharges,
  };
}

let reponse;

beforeEach(() => {
  reponse = corps();
  globalThis.fetch = vi.fn(async () => ({ status: 200, ok: true, json: async () => reponse }));
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
    root.render(<RapportSeance seanceId="seance-1" onRetour={() => {}} />);
  });
  return conteneur;
}

const texte = (c) => c.textContent;
const bouton = (c, libelle) =>
  [...c.querySelectorAll('button')].find((b) => b.textContent.includes(libelle));

describe('en-tête officiel', () => {
  test("l'UF, le local et les horaires identifient la séance", async () => {
    // Sur une feuille imprimée détachée de l'écran, ce sont les seules
    // informations permettant de savoir de quelle séance il s'agit.
    const c = await monter();
    expect(texte(c)).toContain('Français langue étrangère');
    expect(texte(c)).toContain('B-104');
  });

  test('le quota présents / attendus est affiché', async () => {
    const c = await monter();
    expect(texte(c)).toContain('Attendus');
    expect(texte(c)).toContain('Présents');
    expect(texte(c)).toContain('Absents');
  });
});

describe('tableau', () => {
  test('un étudiant ABSENT figure au rapport', async () => {
    // Le point de conception central : lister les présents ne répondrait pas
    // à la question administrative, qui est de savoir qui manquait.
    const c = await monter();
    expect(texte(c)).toContain('Chiara Rossi');
    expect(texte(c)).toContain('Absent');
  });

  test('les trois statuts sont distincts', async () => {
    reponse.etudiants[1].demande_en_attente = true;
    reponse.synthese.demandes_en_attente = 1;
    const c = await monter();
    expect(texte(c)).toContain('Présent (validé)');
    expect(texte(c)).toContain('Absent');
    expect(texte(c)).toContain('Contestation en cours');
  });

  test('la contestation PRIME sur le statut de présence', async () => {
    // Un étudiant présent ET contesté doit apparaître comme contesté : c'est
    // le seul état qui doit interrompre une validation.
    reponse.etudiants[0].demande_en_attente = true;
    reponse.synthese.demandes_en_attente = 1;
    const lignes = [...(await monter()).querySelectorAll('tbody tr')];
    expect(lignes[0].textContent).toContain('Contestation en cours');
    expect(lignes[0].textContent).not.toContain('Présent (validé)');
  });

  test('un départ déduit est marqué, jamais présenté comme constaté', async () => {
    const lignes = [...(await monter()).querySelectorAll('tbody tr')];
    expect(lignes[0].textContent).toContain('déduit');
    // Celui qui a réellement pointé ne porte aucune mention.
    expect(lignes[1].textContent).not.toContain('déduit');
  });

  test("un absent n'affiche NI arrivée NI départ", async () => {
    // `heure_fin_retenue` est renseignée par le serveur même pour un absent :
    // l'afficher donnerait une heure de sortie à quelqu'un jamais venu.
    const lignes = [...(await monter()).querySelectorAll('tbody tr')];
    const cellules = [...lignes[2].querySelectorAll('td')].map((t) => t.textContent);
    expect(cellules[2]).toBe('—');
    expect(cellules[3]).toBe('—');
    expect(cellules[4]).toBe('—');
  });

  test('un PRESENT NON INSCRIT est affiché et signalé, jamais effacé', async () => {
    // Le pire défaut possible pour un relevé d'assiduité : un absent
    // improprement compté se remarque, l'intéressé proteste. Un présent
    // effacé ne se remarque pas.
    reponse.etudiants.push({
      etudiant_id: 'e4', nom: 'Driss El Amrani', email: 'driss@example.be',
      present: true, inscrit: false, heure_arrivee: DEBUT,
      heure_depart_saisie: null, heure_fin_retenue: FIN, depart_deduit: true,
      minutes_validees: 120, position_coherente: null, demande_en_attente: false,
    });
    reponse.synthese.presents_non_inscrits = 1;
    const c = await monter();
    expect(texte(c)).toContain('Driss El Amrani');
    expect(texte(c)).toContain('Présent (non inscrit)');
    expect(texte(c)).toContain('sans être inscrit');
  });

  test('le temps validé est affiché en heures et minutes', async () => {
    expect(texte(await monter())).toContain('2 h');
  });
});

describe('bannière de conformité', () => {
  test('absente quand aucune demande n\'est en attente', async () => {
    const c = await monter();
    expect(texte(c)).not.toContain('Ce rapport est provisoire');
    expect(texte(c)).toContain('Officiel');
  });

  test('présente et explicite dès qu\'une demande est en attente', async () => {
    reponse.synthese.demandes_en_attente = 1;
    reponse.etudiants[0].demande_en_attente = true;
    const c = await monter();
    expect(texte(c)).toContain('Ce rapport est provisoire');
    expect(texte(c)).toContain('ne validez pas de crédits');
    expect(texte(c)).toContain('Provisoire');
  });

  test('le pluriel est correct au-delà d\'une demande', async () => {
    // Un « 2 demande de rectification est en attente » sur un document
    // administratif décrédibilise l'ensemble.
    reponse.synthese.demandes_en_attente = 2;
    const c = await monter();
    expect(texte(c)).toContain('2 demandes de rectification sont en attente');
  });

  test('elle précède le tableau dans le document', async () => {
    // Une mention placée en pied serait lue après la décision qu'elle
    // devait empêcher.
    reponse.synthese.demandes_en_attente = 1;
    const c = await monter();
    const html = c.innerHTML;
    expect(html.indexOf('Ce rapport est provisoire')).toBeLessThan(html.indexOf('<tbody'));
  });

  test('une séance non terminée est signalée séparément, plus discrètement', async () => {
    // Deux causes de provisoire, de gravité différente : les confondre
    // banaliserait l'avertissement le plus important.
    reponse.synthese.provisoire = true;
    const c = await monter();
    expect(texte(c)).toContain("La séance n'est pas terminée");
    expect(texte(c)).not.toContain('Ce rapport est provisoire.');
  });
});

describe('export', () => {
  test('le bouton CSV annonce le nom du fichier qui sera téléchargé', async () => {
    const c = await monter();
    expect(bouton(c, 'Exporter en CSV').getAttribute('title')).toContain('OFFICIEL');
  });

  test('le nom bascule en PROVISOIRE avec une demande en attente', async () => {
    reponse.synthese.demandes_en_attente = 1;
    const c = await monter();
    expect(bouton(c, 'Exporter en CSV').getAttribute('title')).toContain('PROVISOIRE');
  });

  test('un clic déclenche bien un téléchargement', async () => {
    const creer = vi.fn(() => 'blob:faux');
    vi.stubGlobal('URL', { ...URL, createObjectURL: creer, revokeObjectURL: vi.fn() });
    // Le clic sur un <a download> ferait tenter une navigation a jsdom, qui
    // ne l'implemente pas et journalise un avertissement. On neutralise le
    // seul clic natif : ce qui est teste ici est la chaine jusqu'au Blob.
    const vraiCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((balise) => {
      const element = vraiCreateElement(balise);
      if (balise === 'a') element.click = () => {};
      return element;
    });
    const c = await monter();
    await act(async () => { bouton(c, 'Exporter en CSV').click(); });
    expect(creer).toHaveBeenCalledTimes(1);
  });

  test('le bouton Imprimer appelle window.print', async () => {
    const imprimer = vi.fn();
    vi.stubGlobal('print', imprimer);
    const c = await monter();
    await act(async () => { bouton(c, 'Imprimer').click(); });
    expect(imprimer).toHaveBeenCalledTimes(1);
  });

  test('les actions portent la classe masquée à l\'impression', async () => {
    // C'est cette classe que cible @media print dans index.css.
    expect((await monter()).querySelector('.zone-actions')).not.toBeNull();
  });

  test('le pied de document mentionne le caractère provisoire', async () => {
    reponse.synthese.demandes_en_attente = 1;
    const c = await monter();
    const pied = c.querySelector('.mention-impression');
    expect(pied.textContent).toContain('PROVISOIRE');
  });
});
