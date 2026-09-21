// src/routes/ufRoutes.js
// Bilan global et cloture RGPD d'une unite de formation (Etape 9).

const express = require('express');
const { rapportGlobal } = require('../controllers/ufController');
const { cloturerUf } = require('../controllers/rgpdController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

// Formateur uniquement : le bilan agrege les donnees de TOUS les etudiants
// inscrits. Un etudiant y verrait les heures de ses camarades.
router.get('/:id/rapport-global', exigerAuthentification, exigerRole('formateur'), rapportGlobal);

// Operation IRREVERSIBLE. Meme protection de role, plus une confirmation
// explicite verifiee dans le controleur : le middleware dit qui a le droit,
// le controleur verifie que l'intention est deliberee.
router.post('/:id/cloture-rgpd', exigerAuthentification, exigerRole('formateur'), cloturerUf);

module.exports = router;
