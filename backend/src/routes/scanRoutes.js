// src/routes/scanRoutes.js
const express = require('express');
const { scannerJeton } = require('../controllers/scanController');
const { exigerAuthentification, exigerRole } = require('../middlewares/authentification');

const router = express.Router();

// La protection est posee ICI, sur la route, et non a l'interieur du
// controleur : elle reste ainsi visible d'un coup d'oeil sur le fichier de
// routage, sans avoir a ouvrir le controleur pour savoir si un endpoint est
// protege. exigerRole('etudiant') apres exigerAuthentification : un formateur
// authentifie n'a pas d'etudiant_id (NULL en base, cf. contrainte
// chk_utilisateur_role_lien) et ne peut donc pas scanner -- le refuser
// explicitement par le role donne un 403 clair plutot qu'une erreur obscure
// de cle etrangere au moment de l'INSERT.
router.post('/', exigerAuthentification, exigerRole('etudiant'), scannerJeton);

module.exports = router;
