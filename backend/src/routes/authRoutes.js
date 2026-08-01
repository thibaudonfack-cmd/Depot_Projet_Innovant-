// src/routes/authRoutes.js
const express = require('express');
const { connexion, deconnexion, moi } = require('../controllers/authController');
const { exigerAuthentification } = require('../middlewares/authentification');

const router = express.Router();

router.post('/login', connexion);
router.post('/logout', deconnexion);
router.get('/moi', exigerAuthentification, moi);

module.exports = router;
