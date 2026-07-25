// src/routes/seanceRoutes.js
const express = require('express');
const { creerSeance } = require('../controllers/seanceController');

const router = express.Router();

router.post('/', creerSeance);

module.exports = router;
