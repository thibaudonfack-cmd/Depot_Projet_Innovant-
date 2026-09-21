// src/routes/enrolementRoutes.js
const express = require('express');
const { enrolerAppareil, emettreDefi } = require('../controllers/enrolementController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

// Meme raisonnement que scanRoutes.js : seul un etudiant authentifie enrole
// un appareil, et il ne peut l'enroler que pour lui-meme.
// Phase 1 : le serveur emet un defi. Phase 2 : le client le renvoie signe.
router.post('/defi', exigerAuthentification, exigerRole('etudiant'), emettreDefi);
router.post('/', exigerAuthentification, exigerRole('etudiant'), enrolerAppareil);

module.exports = router;
