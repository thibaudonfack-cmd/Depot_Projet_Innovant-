// src/routes/rectificationRoutes.js
const express = require('express');
const {
  soumettreRectification, traiterRectification,
} = require('../controllers/rectificationController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

router.post('/', exigerAuthentification, exigerRole('etudiant'), soumettreRectification);
router.patch('/:id', exigerAuthentification, exigerRole('formateur'), traiterRectification);

module.exports = router;
