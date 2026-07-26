// server.js
// Backend Express du prototype de presence numerique.
// Etape 0 - Partie 2 : route /api/health.
// Etape 1                : route /api/db-health, pool mysql2.
// Etape 2                : creation de seance (RF-01), service de jeton
//                          RS256 (RF-04), diffusion WebSocket temps reel
//                          (RF-05/RF-06).
// Strategie de test        : app et httpServer exportes pour Supertest ;
//                          httpServer.listen() n'est declenche que lorsque ce
//                          fichier est execute directement (node server.js),
//                          jamais lorsqu'il est require() par un test -- sans
//                          quoi chaque test d'integration demarrerait un
//                          vrai serveur en ecoute sur le port applicatif,
//                          en plus de rendre le fichier non testable en
//                          parallele (conflit de port entre suites de test).

const express = require('express');
const http = require('http');

const pool = require('./src/config/db');
const seanceRoutes = require('./src/routes/seanceRoutes');
const { attachQrBroadcaster } = require('./src/services/qrBroadcaster');

const app = express();
const PORT = process.env.PORT || 3000;

// Necessaire pour parser le corps JSON de POST /api/seances.
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
attachQrBroadcaster(httpServer);

// require.main === module est vrai uniquement quand ce fichier est le point
// d'entree du process (node server.js, ou CMD du Dockerfile) -- faux quand
// il est importe via require('../server') depuis un fichier de test.
if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`Backend demarre sur le port ${PORT}`);
  });
}

module.exports = { app, httpServer };
