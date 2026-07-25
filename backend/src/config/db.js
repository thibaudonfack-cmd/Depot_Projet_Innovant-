// src/config/db.js
// Pool de connexions MySQL (mysql2/promise), consomme par server.js et par
// toute la logique metier a venir (chapitre 5). Choix "SQL brut" -- voir
// ANALYSE_CODE.md, section Etape 1, pour la justification academique complete
// du refus d'un ORM sur ce projet.

const mysql = require('mysql2/promise');

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
