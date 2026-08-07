// src/services/perimetreFormateur.js
// Cloisonnement multi-tenants : un formateur ne voit que SES unites de
// formation (Etape 10).
//
// Le defaut corrige : tout formateur authentifie voyait les seances, les
// rapports et les bilans de l'etablissement entier. Ce n'est pas seulement
// une gene d'affichage -- c'est un acces non fonde aux donnees de presence
// d'etudiants qu'il n'encadre pas, donc a des donnees personnelles pour
// lesquelles il n'a aucune finalite (RGPD art. 5.1.b).
//
// DEUX PRINCIPES GOUVERNENT CE MODULE
//
// 1. LE FILTRE EST DANS LA REQUETE, PAS DANS LA REPONSE.
//    Charger toutes les seances puis retirer celles des collegues en
//    JavaScript "fonctionnerait" a l'ecran, mais les donnees auraient
//    quand meme quitte la base et transite par le processus. Une erreur de
//    filtrage ulterieure, un log qui serialise l'objet complet, un champ
//    oublie dans une reponse -- et la fuite est la. Ce qui n'est jamais lu
//    ne peut pas fuir.
//
// 2. LE CLOISONNEMENT S'APPLIQUE AUSSI EN ECRITURE.
//    Masquer une UF dans une liste deroulante n'empeche personne d'envoyer
//    son identifiant a l'API. Chaque route qui AGIT sur une UF ou une seance
//    verifie donc le mandat, meme si l'interface ne propose pas le choix.

/**
 * Fragment SQL a inserer dans un WHERE pour restreindre a une UF confiee au
 * formateur. Attend l'identifiant du formateur en parametre.
 *
 * Ecrit en EXISTS et non en JOIN : une UF co-encadree par deux formateurs
 * produirait deux lignes avec une jointure, et donc des doublons dans les
 * listes ou des totaux doubles dans les agregats. EXISTS repond a une
 * question booleenne ("ce formateur a-t-il un mandat ?") sans multiplier les
 * lignes -- exactement ce qu'on veut ici, puisque le co-encadrement est un
 * cas d'usage reel et non une exception.
 *
 * @param {string} aliasUf - alias de la colonne portant l'identifiant d'UF
 */
function clauseUfDuFormateur(aliasUf) {
  return `EXISTS (
    SELECT 1 FROM formateur_uf fu
     WHERE fu.uf_id = ${aliasUf} AND fu.formateur_id = ?
  )`;
}

/**
 * Verifie qu'un formateur a bien mandat sur une UF.
 *
 * @returns {Promise<boolean>}
 */
async function formateurGereUf(executeur, formateurId, ufId) {
  const [lignes] = await executeur.query(
    'SELECT 1 FROM formateur_uf WHERE formateur_id = ? AND uf_id = ? LIMIT 1',
    [formateurId, ufId]
  );
  return lignes.length > 0;
}

/**
 * Verifie qu'un formateur a mandat sur l'UF d'une SEANCE.
 *
 * @returns {Promise<{existe: boolean, autorise: boolean}>}
 */
async function formateurGereSeance(executeur, formateurId, seanceId) {
  const [lignes] = await executeur.query(
    `SELECT EXISTS (
       SELECT 1 FROM formateur_uf fu
        WHERE fu.uf_id = s.uf_id AND fu.formateur_id = ?
     ) AS autorise
     FROM seances s WHERE s.id = ?`,
    [formateurId, seanceId]
  );
  if (lignes.length === 0) return { existe: false, autorise: false };
  return { existe: true, autorise: lignes[0].autorise === 1 };
}

/**
 * Reponse standard en cas d'acces hors perimetre.
 *
 * 404 ET NON 403, deliberement. Repondre "interdit" confirmerait l'existence
 * de la ressource : en enumerant des identifiants, un formateur curieux
 * apprendrait quelles UF existent dans l'etablissement et combien de seances
 * chacune compte. "Introuvable" ne distingue pas l'absence de l'interdiction,
 * et ne divulgue donc rien.
 *
 * Le 403 reste utilise ailleurs pour les erreurs de ROLE (un etudiant sur une
 * route formateur), ou la ressource n'est pas en cause et ou dire la verite
 * n'apprend rien a personne.
 */
function refuserHorsPerimetre(res, quoi = 'Ressource') {
  return res.status(404).json({
    status: 'error',
    code: 'HORS_PERIMETRE',
    message: `${quoi} introuvable ou hors de votre perimetre.`,
  });
}

module.exports = {
  clauseUfDuFormateur,
  formateurGereUf,
  formateurGereSeance,
  refuserHorsPerimetre,
};
