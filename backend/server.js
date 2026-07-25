// server.js
// Backend Express du prototype de presence numerique.
// Etape 0 - Partie 2 : route /api/health.
// Etape 1                : route /api/db-health, pool mysql2.
// Etape 2                : creation de seance (RF-01), service de jeton
//                          RS256 (RF-04), diffusion WebSocket temps reel
//                          (RF-05/RF-06).
//
// Le serveur HTTP est cree explicitement via http.createServer(app) plutot
// que via le raccourci app.listen() : le WebSocketServer de qrBroadcaster.js
// doit s'attacher au MEME serveur HTTP (evenement 'upgrade'), pas ecouter un
// port separe -- un seul point d'entree pour tout le trafic backend,
// conforme au schema de deploiement (chap. 4.3) ou seul Caddy est expose.

const express = require('express');
const http = require('http');

const pool = require('./src/config/db');
const seanceRoutes = require('./src/routes/seanceRoutes');
const { attachQrBroadcaster } = require('./src/services/qrBroadcaster');

const app = express();
const PORT = process.env.PORT || 3000;

// Necessaire pour parser le corps JSON de POST /api/seances (absent avant
// cette etape, aucune route ne le requerait encore).
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running securely' });
});

app.get('/api/db-health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS total FROM etudiants');
    const total = rows[0].total;

    res.json({
      status: 'ok',
      database: 'connected',
      schema_initialized: true,
      etudiants_count: total,
    });
  } catch (error) {
    console.error('Erreur /api/db-health :', error.message);
    res.status(500).json({
      status: 'error',
      database: 'unreachable',
      message: error.message,
    });
  }
});

app.use('/api/seances', seanceRoutes);

const httpServer = http.createServer(app);

// Branche le WebSocket sur le serveur HTTP existant (evenement 'upgrade').
// Chemin : /api/ws/seances/<seance_id> -- voir qrBroadcaster.js pour le
// detail du routage et de la verification en base.
attachQrBroadcaster(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Backend demarre sur le port ${PORT}`);
});
