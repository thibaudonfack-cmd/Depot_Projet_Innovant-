// src/services/exportCsv.test.js
// Export CSV du rapport d'assiduite.
//
// Ces tests portent sur des fonctions PURES, deliberement sorties du
// composant. Un CSV se casse silencieusement : le fichier se telecharge, le
// tableur l'ouvre, et le defaut n'apparait qu'a la lecture d'une ligne
// particuliere -- souvent chez le destinataire. Le verifier a l'assemblage
// est le seul moment ou c'est bon marche.

import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  echapperCsv, construireCsv, nommerFichier, telechargerCsv,
  formaterDureeCsv, formaterInstantCsv,
} from './exportCsv';

function rapport(surcharges = {}) {
  return {
    seance: {
      uf_intitule: 'Français langue étrangère',
      salle_nom: 'B-104',
      heure_debut_prevue: '2026-09-01T09:00:00.000Z',
      heure_fin_prevue: '2026-09-01T12:00:00.000Z',
    },
    synthese: {
      attendus: 2, presents: 1, absents: 1, presents_non_inscrits: 0,
      minutes_validees_total: 180, provisoire: false, demandes_en_attente: 0,
    },
    etudiants: [
      {
        etudiant_id: 1, nom: 'Amara Diallo', email: 'amara@example.be', present: true, inscrit: true,
        heure_arrivee: '2026-09-01T09:05:00.000Z',
        heure_depart_saisie: null,
        heure_fin_retenue: '2026-09-01T12:00:00.000Z',
        depart_deduit: true, minutes_validees: 175,
        position_coherente: true, demande_en_attente: false,
      },
      {
        etudiant_id: 2, nom: 'Bruno Mertens', email: 'bruno@example.be', present: false, inscrit: true,
        heure_arrivee: null,
        heure_depart_saisie: null,
        // Le serveur renseigne cette valeur meme pour un absent : elle vient
        // de la seance, pas de l'etudiant.
        heure_fin_retenue: '2026-09-01T12:00:00.000Z',
        depart_deduit: false, minutes_validees: null,
        position_coherente: null, demande_en_attente: false,
      },
    ],
    ...surcharges,
  };
}

const lignes = (csv) => csv.replace('﻿', '').split('\r\n');

describe('echappement', () => {
  test('une valeur contenant le séparateur est mise entre guillemets', () => {
    // Sans cela, un motif saisi librement décalerait toutes les colonnes
    // suivantes de la ligne.
    expect(echapperCsv('Dupont; Jean')).toBe('"Dupont; Jean"');
  });

  test('les guillemets internes sont doublés (RFC 4180)', () => {
    expect(echapperCsv('dit "Bob"')).toBe('"dit ""Bob"""');
  });

  test('un saut de ligne force la mise entre guillemets', () => {
    expect(echapperCsv('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });

  test('null et undefined donnent une cellule vide, jamais le mot "null"', () => {
    expect(echapperCsv(null)).toBe('');
    expect(echapperCsv(undefined)).toBe('');
  });

  test('une valeur ordinaire reste nue', () => {
    expect(echapperCsv('Amara Diallo')).toBe('Amara Diallo');
  });
});

describe('formatage', () => {
  test('les minutes deviennent des heures lisibles, minutes sur deux chiffres', () => {
    expect(formaterDureeCsv(175)).toBe('2h55');
    expect(formaterDureeCsv(120)).toBe('2h00');
    expect(formaterDureeCsv(5)).toBe('0h05');
  });

  test('une durée absente donne une cellule vide, et non "0h00"', () => {
    // Un absent n'a pas fait zéro minute : il n'a pas de durée du tout. Les
    // deux ne doivent pas se confondre dans une colonne qu'on additionne.
    expect(formaterDureeCsv(null)).toBe('');
  });

  test('un instant absent donne une cellule vide', () => {
    expect(formaterInstantCsv(null)).toBe('');
  });
});

describe('construction du fichier', () => {
  test('le BOM UTF-8 ouvre le fichier', () => {
    // C'est lui qui évite qu'Excel affiche "FranÃ§ais" à la place de
    // "Français". Sans BOM, le fichier reste valide mais paraît corrompu.
    expect(construireCsv(rapport()).startsWith('﻿')).toBe(true);
  });

  test('la première ligne est l\'en-tête, séparée par des points-virgules', () => {
    const [entete] = lignes(construireCsv(rapport()));
    expect(entete.split(';')[0]).toBe('Nom');
    expect(entete).toContain('Depart deduit');
  });

  test('TOUS les inscrits figurent, présents comme absents', () => {
    // Le point de conception central de l'étape 8 : un rapport qui n'affiche
    // que les présents ne répond pas à la question administrative.
    const csv = construireCsv(rapport());
    expect(csv).toContain('Amara Diallo');
    expect(csv).toContain('Bruno Mertens');
  });

  test('un départ déduit est marqué comme tel dans le fichier', () => {
    const [, premier] = lignes(construireCsv(rapport()));
    const colonnes = premier.split(';');
    expect(colonnes[2]).toBe('Present');
    expect(colonnes[3]).toBe('Oui');   // Inscrit
    expect(colonnes[6]).toBe('Oui');   // Depart deduit
    expect(colonnes[7]).toBe('2h55');  // Temps valide
  });

  test('un absent n\'hérite PAS de l\'heure de fin de séance comme départ', () => {
    // Le serveur renvoie `heure_fin_retenue` même pour un absent ; l'écrire
    // telle quelle donnerait à quelqu'un qui n'est jamais venu une heure de
    // sortie, relue en aval comme une présence.
    const [, , second] = lignes(construireCsv(rapport()));
    const colonnes = second.split(';');
    expect(colonnes[2]).toBe('Absent');
    expect(colonnes[4]).toBe(''); // Arrivee
    expect(colonnes[5]).toBe(''); // Depart
    expect(colonnes[7]).toBe(''); // Temps valide
  });

  test('la synthèse porte la mention OFFICIEL quand rien n\'est en attente', () => {
    expect(construireCsv(rapport())).toContain('Statut;OFFICIEL');
  });

  test('une demande en attente bascule la synthèse en PROVISOIRE', () => {
    const r = rapport();
    r.synthese.demandes_en_attente = 1;
    r.etudiants[0].demande_en_attente = true;
    expect(construireCsv(r)).toContain('Statut;PROVISOIRE');
  });

  test('un present NON INSCRIT est marque dans une colonne dediee', () => {
    // Colonne distincte du statut : un present non inscrit reste present.
    // Fusionner les deux obligerait a relire le libelle pour trier.
    const r = rapport();
    r.etudiants[0].inscrit = false;
    r.synthese.presents_non_inscrits = 1;
    const csv = construireCsv(r);
    const [, premier] = lignes(csv);
    expect(premier.split(';')[3]).toBe('Non');
    expect(csv).toContain('Presents non inscrits;1');
  });

  test('les fins de ligne sont en CRLF', () => {
    expect(construireCsv(rapport())).toContain('\r\n');
  });

  test('un nom contenant un point-virgule ne décale pas les colonnes', () => {
    const r = rapport();
    r.etudiants[0].nom = 'Diallo; Amara';
    const [entete, premier] = lignes(construireCsv(r));
    // Le nombre de séparateurs HORS guillemets doit rester constant.
    const compter = (l) => l.replace(/"[^"]*"/g, '').split(';').length;
    expect(compter(premier)).toBe(compter(entete));
  });
});

describe('nommage du fichier', () => {
  test('un rapport sans contestation est nommé OFFICIEL', () => {
    expect(nommerFichier(rapport())).toContain('OFFICIEL');
  });

  test('une demande en attente force PROVISOIRE dans le NOM', () => {
    // Le nom, pas seulement le contenu : un fichier transféré par courriel
    // arrive souvent détaché de son contexte.
    const r = rapport();
    r.synthese.demandes_en_attente = 2;
    const nom = nommerFichier(r);
    expect(nom).toContain('PROVISOIRE');
    expect(nom).not.toContain('OFFICIEL');
  });

  test('une séance non terminée est provisoire, même sans contestation', () => {
    const r = rapport();
    r.synthese.provisoire = true;
    expect(nommerFichier(r)).toContain('PROVISOIRE');
  });

  test('les accents et espaces de l\'intitulé sont normalisés', () => {
    // Un nom de fichier contenant "é" ou une espace survit mal aux
    // transferts entre systèmes.
    const nom = nommerFichier(rapport());
    expect(nom).toContain('francais-langue-etrangere');
    expect(nom).toMatch(/^[a-zA-Z0-9.-]+$/);
  });

  test('l\'extension et la date sont présentes', () => {
    expect(nommerFichier(rapport())).toMatch(/-2026-09-01\.csv$/);
  });
});

describe('téléchargement', () => {
  afterEach(() => vi.restoreAllMocks());

  test('un lien est créé, cliqué, retiré, et l\'URL objet libérée', () => {
    // La libération n'est pas cosmétique : sans elle, chaque export laisse
    // une copie du fichier en mémoire jusqu'au rechargement de la page.
    const creer = vi.fn(() => 'blob:faux');
    const liberer = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: creer, revokeObjectURL: liberer });

    let clique = 0;
    const vraiCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((balise) => {
      const element = vraiCreateElement(balise);
      if (balise === 'a') element.click = () => { clique += 1; };
      return element;
    });

    telechargerCsv(rapport());

    expect(creer).toHaveBeenCalledTimes(1);
    expect(clique).toBe(1);
    expect(liberer).toHaveBeenCalledWith('blob:faux');
    // Aucun lien résiduel dans le document.
    expect(document.querySelectorAll('a[download]').length).toBe(0);
  });
});
