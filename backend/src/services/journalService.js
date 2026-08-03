// src/services/journalService.js
// Ecriture du journal d'audit (db_attestations.journal_modifications).
//
// Toute modification manuelle d'une presence doit laisser une trace
// horodatee et motivee, conservee cinq ans pour justifier les quotas
// d'heures en cas d'inspection (conformite legale belge).
//
// REGLE ABSOLUE : l'ecriture du journal et la modification qu'il decrit
// doivent se faire DANS LA MEME TRANSACTION. Sinon une panne entre les deux
// produit soit une modification sans trace -- le pire des deux mondes, car
// la donnee a change sans qu'on puisse dire qui ni pourquoi -- soit une
// trace sans modification. Toutes les fonctions de ce module prennent donc
// une connexion en parametre, jamais le pool : c'est ce qui rend
// l'appartenance a la transaction appelante obligatoire et visible.
//
// L'application ne dispose que d'INSERT et SELECT sur cette table
// (03-privileges.sh). Ni UPDATE ni DELETE, jamais : c'est le moteur qui
// garantit l'inalterabilite, pas la discipline du code.

const crypto = require('crypto');

/**
 * Consigne une modification.
 *
 * @param {import('mysql2/promise').PoolConnection} connexion - connexion de
 *   la transaction en cours. Passer le pool a la place fonctionnerait, mais
 *   sortirait l'ecriture de la transaction et ruinerait la garantie.
 * @param {object} entree
 */
async function consigner(connexion, entree) {
  const {
    tableCible, ligneId, champ, valeurAvant, valeurApres,
    auteur, motif, origine,
  } = entree;

  if (!motif || !motif.trim()) {
    // Verrou applicatif en plus de la contrainte NOT NULL : un motif vide
    // mais present satisferait la base tout en rendant la trace inutile.
    // Une modification sans justification n'est pas defendable devant une
    // inspection.
    throw new Error('Un motif est obligatoire pour toute modification tracee.');
  }

  await connexion.query(
    `INSERT INTO db_attestations.journal_modifications
       (id, table_cible, ligne_id, champ, valeur_avant, valeur_apres,
        auteur_id, auteur_email, role_auteur, motif, origine)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(), tableCible, ligneId, champ,
      // Valeurs converties en texte : la trace doit rester lisible meme si
      // la ligne d'origine a disparu apres la purge de db_logs (RF-20).
      valeurAvant === null || valeurAvant === undefined ? null : String(valeurAvant),
      valeurApres === null || valeurApres === undefined ? null : String(valeurApres),
      // auteur_email est copie PAR VALEUR a cote de auteur_id : si le compte
      // est supprime plus tard, la trace doit toujours dire qui a agi.
      auteur.id, auteur.email, auteur.role,
      motif.trim(), origine,
    ]
  );
}

module.exports = { consigner };
