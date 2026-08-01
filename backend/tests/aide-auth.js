// tests/aide-auth.js
// Utilitaire partage par les tests d'integration : ouvre une session et
// retourne l'en-tete Cookie a rejouer sur les requetes protegees.
//
// Ce fichier n'est PAS une suite de tests (il ne correspond pas au motif
// **/tests/**/*.test.js de jest.config.js) : il ne sera donc jamais execute
// comme tel.
//
// POURQUOI NE PAS UTILISER request.agent(app), QUI GERE LES COOKIES SEUL ?
// Parce que le cookie de session porte l'attribut Secure (sessionService.js),
// et que le magasin de cookies de superagent -- comme un vrai navigateur --
// REFUSE de renvoyer un cookie Secure sur une connexion en clair. Or
// Supertest sert l'application en HTTP simple sur un port ephemere. Un agent
// obtiendrait donc bien le Set-Cookie a la connexion, puis ne le renverrait
// jamais : toutes les routes protegees repondraient 401, et le diagnostic
// serait trompeur (on croirait a un bug d'authentification).
//
// La tentation serait de conditionner secure a NODE_ENV (secure: false en
// test). C'est ecarte deliberement : cela reviendrait a ne PAS tester la
// configuration reellement deployee, et ce type de reglage conditionnel
// finit regulierement par se retrouver actif en production. On preserve donc
// la configuration stricte, et on rejoue le cookie explicitement ici -- ce
// qui a l'avantage de rendre visible, dans chaque test, ce que le navigateur
// enverrait.

const request = require('supertest');
const { app } = require('../server');

// Identifiants du jeu de donnees de demonstration (database/02-seed.sql).
const COMPTES = {
  amara:     { email: 'amara.diallo@example.org',    mot_de_passe: 'Etudiant123!' },
  bilal:     { email: 'bilal.ozturk@example.org',    mot_de_passe: 'Etudiant123!' },
  chiara:    { email: 'chiara.rossi@example.org',    mot_de_passe: 'Etudiant123!' },
  driss:     { email: 'driss.elamrani@example.org',  mot_de_passe: 'Etudiant123!' },
  formateur: { email: 'formateur@example.org',       mot_de_passe: 'Formateur123!' },
};

/**
 * Ouvre une session et retourne { cookie, utilisateur }.
 * @param {keyof typeof COMPTES} cle
 */
async function connecter(cle) {
  const identifiants = COMPTES[cle];
  if (!identifiants) throw new Error(`Compte de test inconnu : ${cle}`);

  const reponse = await request(app).post('/api/auth/login').send(identifiants);
  if (reponse.status !== 200) {
    throw new Error(
      `Echec de connexion pour ${cle} (${reponse.status}) : ${JSON.stringify(reponse.body)}`
    );
  }

  const entetes = reponse.headers['set-cookie'];
  if (!entetes || entetes.length === 0) {
    throw new Error(`Aucun cookie de session emis pour ${cle}.`);
  }

  // On ne conserve que la paire nom=valeur : les attributs (Path, HttpOnly,
  // Secure, SameSite) sont des directives destinees au navigateur, ils n'ont
  // pas leur place dans un en-tete Cookie de requete.
  const cookie = entetes.map((e) => e.split(';')[0]).join('; ');
  return { cookie, utilisateur: reponse.body.utilisateur };
}

module.exports = { connecter, COMPTES };
