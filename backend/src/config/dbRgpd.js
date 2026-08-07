// src/config/dbRgpd.js
// Pool SEPARE, dedie a la seule cloture RGPD (Etape 9).
//
// POURQUOI UN SECOND POOL PLUTOT QUE D'ELARGIR LES DROITS DU PREMIER
//
// La minimisation exige de detruire des donnees dans db_logs.scans. Or
// l'utilisateur applicatif ordinaire n'a volontairement ni UPDATE ni DELETE
// sur cette table : c'est la garantie la plus forte de toute l'architecture,
// parce qu'elle ne depend pas de la correction du code. Une injection SQL,
// un endpoint mal protege ou une dependance compromise ne peuvent pas
// reecrire l'historique des scans -- le refus vient du moteur.
//
// Accorder UPDATE sur scans a l'utilisateur applicatif ferait disparaitre
// cette garantie pour TOUTES les routes, au benefice d'une seule. Le prix
// serait sans commune mesure avec le gain.
//
// D'ou cette identite distincte, avec ses propres identifiants, que SEUL
// rgpdController.js importe. La capacite d'effacement devient ainsi
// elle-meme un privilege isole, ce qui est exactement ce qu'on attend d'une
// operation irreversible : restreinte et tracable, jamais diffuse dans tout
// le code.
//
// Le compte n'a que UPDATE (jti) sur scans -- privilege de COLONNE, pas de
// table : il ne peut ni reattribuer un scan a un autre etudiant, ni en
// changer l'horodatage. Il n'a pas non plus DELETE : la cloture anonymise,
// elle ne supprime pas (cf. rgpdController.js).

const mysql = require('mysql2/promise');

const REQUISES = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_RGPD_USER', 'MYSQL_RGPD_PASSWORD'];
const manquantes = REQUISES.filter((cle) => !process.env[cle]);

if (manquantes.length > 0) {
  // Meme strategie fail-fast que db.js : mieux vaut refuser de demarrer que
  // decouvrir l'absence de configuration au moment d'une operation
  // irreversible, la moitie du travail deja faite.
  throw new Error(
    `Variables d'environnement manquantes pour le pool RGPD (${manquantes.join(', ')}). `
    + 'Ce pool sert la cloture RGPD (Etape 9) et exige une identite SQL distincte de '
    + "l'utilisateur applicatif. Voir .env.example et database/03-privileges.sh."
  );
}

const poolRgpd = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_RGPD_USER,
  password: process.env.MYSQL_RGPD_PASSWORD,

  // Deux connexions suffisent : la cloture est une operation rare, declenchee
  // manuellement en fin de semestre. Un pool large immobiliserait des
  // connexions MySQL pour une route appelee quelques fois par an.
  waitForConnections: true,
  connectionLimit: 2,
  queueLimit: 0,
  decimalNumbers: false,
});

module.exports = poolRgpd;
