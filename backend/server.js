// server.js
// Backend Express du prototype de presence numerique.
// Etape 0 - Partie 2 : route /api/health (sante applicative pure).
// Etape 1                : route /api/db-health (sante de la connexion MySQL
//                          + preuve que le schema et le seed sont bien charges).
// Aucune logique metier (jeton, cascade de validation V1-V4...) n'est encore
// presente : elle sera ajoutee brique par brique a partir du chapitre 5.

const express = require('express');
const pool = require('./src/config/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running securely' });
});

// GET /api/db-health
// Ne fait volontairement pas un simple "SELECT 1" : compter les etudiants
// prouve trois choses a la fois -- (1) le pool mysql2 atteint bien MySQL au
// travers du reseau Docker interne, (2) le script 01-schema.sql a bien cree
// la table etudiants, (3) le script 02-seed.sql a bien insere les 4 lignes de
// demonstration. Un "SELECT 1" n'aurait valide que le point (1).
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

app.listen(PORT, () => {
  console.log(`Backend demarre sur le port ${PORT}`);
});
