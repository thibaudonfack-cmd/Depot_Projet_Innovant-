// src/routes/scanRoutes.js
const express = require('express');
const { scannerJeton } = require('../controllers/scanController');

const router = express.Router();

router.post('/', scannerJeton);

module.exports = router;
