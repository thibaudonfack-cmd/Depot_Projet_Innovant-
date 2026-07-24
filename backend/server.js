// server.js
// Backend minimaliste - Etape 0, Partie 2.
// Seul but a ce stade : exposer une route de sante pour valider la chaine
// complete client -> proxy Caddy (HTTPS) -> reseau Docker interne -> backend.
// Aucune logique metier (jeton, validation, geofence...) n'est encore presente :
// elle sera ajoutee brique par brique a partir du chapitre 5.

const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running securely' });
});

app.listen(PORT, () => {
  console.log(`Backend demarre sur le port ${PORT}`);
});
