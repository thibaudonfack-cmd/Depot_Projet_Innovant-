// src/routes/enrolementRoutes.js
const express = require('express');
const { enrolerAppareil } = require('../controllers/enrolementController');

const router = express.Router();

router.post('/', enrolerAppareil);

module.exports = router;
