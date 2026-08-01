// src/routes/enrolementRoutes.js
const express = require('express');
const { enrolerAppareil } = require('../controllers/enrolementController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

// Meme raisonnement que scanRoutes.js : seul un etudiant authentifie enrole
// un appareil, et il ne peut l'enroler que pour lui-meme.
router.post('/', exigerAuthentification, exigerRole('etudiant'), enrolerAppareil);

module.exports = router;
