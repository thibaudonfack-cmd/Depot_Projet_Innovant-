// src/routes/presenceRoutes.js
const express = require('express');
const { modifierPresence } = require('../controllers/rectificationController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

router.put('/:id', exigerAuthentification, exigerRole('formateur'), modifierPresence);

module.exports = router;
