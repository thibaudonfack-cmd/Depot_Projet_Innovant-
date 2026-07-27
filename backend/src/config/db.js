// src/config/db.js
// Pool de connexions MySQL (mysql2/promise), consomme par server.js et par
// toute la logique metier a venir (chapitre 5). Choix "SQL brut" -- voir
// ANALYSE_CODE.md, section Etape 1, pour la justification academique complete
// du refus d'un ORM sur ce projet.

const mysql = require('mysql2/promise');

// Fail-fast : sans ces variables, mysql2 se connecterait silencieusement
// avec host/user/password/database valant undefined -- ce que le driver
// convertit en chaine vide, et que MySQL refuse avec un message qui ne dit
// RIEN de la vraie cause : "Access denied for user ''@'...' (using
// password: NO)". Un developpeur qui lance par erreur "npm test" hors de
// Docker/CI (aucun .env charge, aucune variable MYSQL_* injectee) se
// retrouve alors a deboguer un probleme d'authentification MySQL qui n'en
// est pas un. Verifier ICI, au chargement du module, et lever une erreur
// explicite immediatement -- meme strategie fail-fast que
// tokenService.js/verificationService.js pour les cles RS256.
//
// Noms retenus : MYSQL_HOST / MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD.
// Deliberement PAS "DB_USER"/"DB_PASSWORD" (noms generiques parfois utilises
// par convention ailleurs) : ce sont les noms REELLEMENT definis partout
// dans ce projet (.env.example, docker-compose.yml, .gitlab-ci.yml,
// database/03-privileges.sh) -- en exiger d'autres aurait fait echouer ce
// controle sur CHAQUE demarrage normal (Docker et CI compris), puisque
// personne ne definit jamais DB_USER ici. Cf. ANALYSE_CODE.md, section
// Etape 3, pour cette correction.
//
// MYSQL_PORT est volontairement absent de cette liste : contrairement aux
// quatre variables ci-dessous, une valeur par defaut (3306, le port
// standard MySQL) a un sens fonctionnel reel -- ce n'est pas le cas d'un
// host/utilisateur/mot de passe/base de donnees par defaut, qui n'existent
// pas de maniere securisee ou correcte "par defaut".
const VARIABLES_CRITIQUES = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
const variablesManquantes = VARIABLES_CRITIQUES.filter((nom) => !process.env[nom]);

if (variablesManquantes.length > 0) {
  throw new Error(
    `Variables d'environnement DB manquantes (${variablesManquantes.join(', ')}) -- ` +
    `Executez-vous le code dans Docker ? Ce module attend un environnement ` +
    `injecte par docker-compose (fichier .env a la racine du projet) ou par ` +
    `la CI (.gitlab-ci.yml). Lance hors de ces deux contextes -- par exemple ` +
    `"npm test" execute directement sur la machine hote -- ces variables ne ` +
    `sont jamais definies, et MySQL echouerait sinon avec un message trompeur ` +
    `("Access denied for user ''@'...'") qui ne mentionne jamais la cause reelle.`
  );
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,

  // Un pool, pas une connexion unique : chaque requete HTTP emprunte une
  // connexion au pool le temps de sa requete SQL puis la restitue, au lieu
  // d'ouvrir/fermer une connexion TCP a chaque appel (couteux) ou de
  // partager une connexion unique entre requetes concurrentes (dangereux :
  // les resultats se melangeraient entre requetes paralleles).
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  // Renvoie les colonnes DECIMAL/BIGINT en tant que chaines plutot que
  // nombres JS pour eviter toute perte de precision silencieuse -- non
  // utilise par la route /api/db-health mais pose des maintenant comme
  // reglage par defaut pour la logique metier a venir (montants, compteurs).
  decimalNumbers: false,
});

module.exports = pool;
