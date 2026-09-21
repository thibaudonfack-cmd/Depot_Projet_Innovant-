// jest.config.js
// Configuration Jest pour une application Node/Express -- pas de DOM, pas de
// navigateur, testEnvironment doit rester 'node' (jamais 'jsdom', qui serait
// le choix par defaut historique de Jest pour des projets front-end).

module.exports = {
  testEnvironment: 'node',

  // Repertoire unique des tests, conforme a l'arborescence demandee
  // (backend/tests/). Explicite plutot que de compter sur le testMatch par
  // defaut de Jest (qui aurait de toute facon trouve ces fichiers) : rend
  // l'intention lisible sans avoir a connaitre les conventions par defaut
  // de Jest.
  testMatch: ['**/tests/**/*.test.js'],

  // Detecte et signale explicitement les handles ouverts (connexions DB,
  // sockets, timers non nettoyes) en fin de suite plutot que de laisser
  // Jest se contenter d'un avertissement generique difficile a rattacher a
  // un test precis. Complement direct de la regle d'or de cette etape :
  // "gerer proprement le teardown des connexions DB/WebSockets" -- ce
  // reglage rend visible tout oubli de teardown futur, il ne le corrige pas
  // a la place du code (voir health.test.js : afterAll(() => pool.end())).
  detectOpenHandles: true,

  // Un test qui ne se termine jamais (ex : MySQL indisponible en CI, requete
  // qui pend indefiniment) ne doit pas faire tourner la pipeline
  // indefiniment -- 10s est largement suffisant pour des tests unitaires et
  // d'integration HTTP simples comme ceux de ce projet.
  testTimeout: 10000,

  verbose: true,

  // Volontairement PAS de forceExit: true. forceExit masquerait un teardown
  // incomplet au lieu de le signaler -- l'objectif ici est un teardown
  // reellement propre (pool.end() explicite), pas un contournement qui
  // reviendrait a cacher la meme classe de bug que detectOpenHandles est
  // cense reveler.
};
