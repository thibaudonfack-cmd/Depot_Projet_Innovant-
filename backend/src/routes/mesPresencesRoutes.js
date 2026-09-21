// src/routes/mesPresencesRoutes.js
const express = require('express');
const { listerMesPresences } = require('../controllers/presenceController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

router.get('/', exigerAuthentification, exigerRole('etudiant'), listerMesPresences);

module.exports = router;
