// src/routes/appareilRoutes.js
const express = require('express');
const { consulterMonAppareil } = require('../controllers/appareilController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

router.get('/', exigerAuthentification, exigerRole('etudiant'), consulterMonAppareil);

module.exports = router;
