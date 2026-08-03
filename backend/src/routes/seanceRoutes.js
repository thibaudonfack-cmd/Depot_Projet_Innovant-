// src/routes/seanceRoutes.js
const express = require('express');
const { creerSeance } = require('../controllers/seanceController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

// Protection posee sur la route et non dans le controleur : elle reste ainsi
// visible d'un coup d'oeil sur le fichier de routage. Reserve au formateur,
// un etudiant n'ayant aucune raison d'ouvrir une seance.
router.post('/', exigerAuthentification, exigerRole('formateur'), creerSeance);

module.exports = router;
