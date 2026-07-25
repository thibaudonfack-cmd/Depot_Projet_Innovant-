// src/services/qrBroadcaster.js
// Diffusion temps reel du jeton de seance vers l'affichage formateur
// (RF-05, RF-06). Un WebSocket par connexion formateur, attache directement
// au serveur HTTP existant (pas de port separe) -- cf. server.js.
//
// URL de connexion : /api/ws/seances/<seance_id>
// Choisie volontairement SOUS le prefixe /api/ deja proxy par Caddy
// (Caddyfile : handle /api/* { reverse_proxy backend:3000 }). Caddy relaie
// nativement les upgrades WebSocket a travers reverse_proxy sans
// configuration supplementaire : rester sous /api/* evite de toucher au
// Caddyfile a cette etape, une seule regle de routage a maintenir.

const { WebSocketServer } = require('ws');
const pool = require('../config/db');
const { generateSessionToken, ROTATION_INTERVAL_SECONDS } = require('./tokenService');

const WS_PATH_PATTERN = /^\/api\/ws\/seances\/([^/]+)\/?$/;

/**
 * Attache le serveur WebSocket au serveur HTTP Express existant.
 * @param {import('http').Server} httpServer
 */
function attachQrBroadcaster(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const match = url.pathname.match(WS_PATH_PATTERN);

    if (!match) {
      // Chemin WS inconnu : on ne detourne pas la connexion, on la laisse
      // echouer proprement plutot que de l'accepter par erreur.
      socket.destroy();
      return;
    }

    const seanceId = match[1];

    // La salle_id embarquee dans chaque jeton signe est lue en base,
    // JAMAIS fournie par le client qui ouvre la connexion WS. Un salle_id
    // errone ou falsifie a cet endroit corromprait silencieusement le
    // controle de geofencing qui s'appuiera sur ce champ (RF-13, etape
    // suivante) -- l'autorite sur cette donnee reste exclusivement la base.
    // Ceci ferme egalement RF-02 par effet de bord : une seance cloturee ou
    // inexistante ne recoit plus de rotation de jeton.
    let seance;
    try {
      const [rows] = await pool.query(
        'SELECT salle_id, statut FROM seances WHERE id = ?',
        [seanceId]
      );
      seance = rows[0];
    } catch (error) {
      console.error('[qrBroadcaster] Erreur lors de la verification de la seance :', error.message);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!seance) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    if (seance.statut !== 'ouverte') {
      socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, seanceId, seance.salle_id);
    });
  });

  wss.on('connection', (ws, seanceId, salleId) => {
    console.log(`[qrBroadcaster] Formateur connecte : seance=${seanceId} salle=${salleId}`);

    function envoyerNouveauJeton() {
      let token;
      try {
        token = generateSessionToken(seanceId, salleId);
      } catch (error) {
        console.error('[qrBroadcaster] Erreur de generation du jeton :', error.message);
        return;
      }
      ws.send(JSON.stringify({ type: 'token', token }));
    }

    // Envoi immediat du premier jeton (RF-04/RF-06) : le formateur ne doit
    // pas attendre le premier intervalle de 20s pour voir un QR s'afficher.
    envoyerNouveauJeton();

    // Rotation stricte toutes les 20s (RF-05). Chaque appel genere un nouveau
    // jti (tokenService.js) -- aucune coordination avec le jeton precedent
    // n'est necessaire : le recouvrement de validite (5s) est une propriete
    // EMERGENTE du TTL individuel de chaque jeton, pas un mecanisme code ici
    // (cf. ANALYSE_CODE.md, Etape 2, pour le detail de ce choix).
    const intervalId = setInterval(envoyerNouveauJeton, ROTATION_INTERVAL_SECONDS * 1000);

    // Nettoyage systematique de l'intervalle a la fermeture -- sans ce
    // clearInterval, chaque connexion/deconnexion repetee (rechargement de
    // la page formateur, perte reseau) laisserait tourner un minuteur
    // orphelin indefiniment : fuite memoire ET generation continue de jetons
    // qui ne seront jamais affiches ni scannes.
    function nettoyer(raison) {
      clearInterval(intervalId);
      console.log(`[qrBroadcaster] Rotation arretee pour la seance ${seanceId} (${raison}).`);
    }

    ws.on('close', () => nettoyer('deconnexion formateur'));
    ws.on('error', (error) => {
      console.error(`[qrBroadcaster] Erreur WebSocket (seance ${seanceId}) :`, error.message);
      nettoyer('erreur socket');
    });
  });

  return wss;
}

module.exports = { attachQrBroadcaster };
