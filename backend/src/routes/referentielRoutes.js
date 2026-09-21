// src/routes/referentielRoutes.js
const express = require('express');
const { listerUf, listerSalles } = require('../controllers/referentielController');
const { exigerAuthentification } = require('../middlewares/authentification');

const router = express.Router();

// Authentification exigee, sans restriction de role : un etudiant peut
// legitimement avoir besoin du nom d'une salle ou d'une UF pour lire son
// historique. En revanche, jamais en acces anonyme.
router.get('/uf', exigerAuthentification, listerUf);
router.get('/salles', exigerAuthentification, listerSalles);

module.exports = router;
