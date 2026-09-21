// src/components/comptesDemo.js
// Comptes du jeu de demonstration (database/02-seed.sql).
//
// SOURCE UNIQUE, et c'est le point : ces valeurs etaient auparavant recopiees
// dans Connexion.jsx. La refonte du seed a l'Etape 10 a renomme le compte
// formateur, et les boutons de pre-remplissage ont continue d'injecter une
// adresse qui n'existait plus -- sans aucune erreur visible avant la
// soumission du formulaire. Une donnee dupliquee finit toujours par diverger
// de sa source.
//
// Le fichier est un module ordinaire (.js) et non un composant : ces
// constantes doivent pouvoir etre importees par les tests sans monter
// d'interface, et Fast Refresh exige qu'un fichier .jsx n'exporte que des
// composants.

/**
 * Mot de passe COMMUN a tous les comptes de demonstration, par role.
 * Documente en clair ici comme dans 02-seed.sql : ce jeu n'est jamais charge
 * en production (cf. docker-compose.prod.yml, qui ne monte pas le seed).
 */
export const MOT_DE_PASSE_ETUDIANT = 'Etudiant123!';
export const MOT_DE_PASSE_FORMATEUR = 'Formateur123!';

/**
 * Les trois formateurs, avec les UF qu'ils encadrent.
 *
 * Le detail des UF n'est pas decoratif : c'est ce qui permet de choisir le
 * bon compte pour demontrer le cloisonnement multi-tenants. Nadia Cherif
 * n'encadre qu'une seule UF et ne doit voir aucune donnee des trois autres.
 */
export const FORMATEURS = [
  {
    nom: 'Sophie Lambert',
    email: 'sophie.lambert@example.org',
    perimetre: 'Architecture Logicielle, Développement Web',
  },
  {
    nom: 'Marc Dupont',
    email: 'marc.dupont@example.org',
    perimetre: 'Développement Web, Cybersécurité',
  },
  {
    nom: 'Nadia Cherif',
    email: 'nadia.cherif@example.org',
    perimetre: 'DevOps uniquement',
  },
];

/** Les huit etudiants, dans l'ordre alphabetique du seed. */
export const ETUDIANTS = [
  { nom: 'Amara Diallo', email: 'amara.diallo@example.org' },
  { nom: 'Bilal Ozturk', email: 'bilal.ozturk@example.org' },
  { nom: 'Chiara Rossi', email: 'chiara.rossi@example.org' },
  { nom: 'Driss El Amrani', email: 'driss.elamrani@example.org' },
  { nom: 'Elena Petrova', email: 'elena.petrova@example.org' },
  { nom: 'Farid Benali', email: 'farid.benali@example.org' },
  { nom: 'Gwendoline Moreau', email: 'gwendoline.moreau@example.org' },
  { nom: 'Hugo Vandenberghe', email: 'hugo.vandenberghe@example.org' },
];
