// src/services/api.js
// Point de passage unique vers l'API. Toutes les requetes du frontend
// transitent par ici, pour trois raisons.
//
// 1. credentials: 'same-origin' partout, sans exception possible.
//    Le cookie de session est httpOnly : JavaScript ne peut ni le lire ni le
//    poser manuellement. Le navigateur ne l'attache a une requete fetch que
//    si cette option est presente. L'oublier sur un seul appel produit un 401
//    isole, tres deroutant a diagnostiquer puisque tous les autres appels
//    fonctionnent. Centraliser supprime cette classe d'erreur.
//    'same-origin' plutot que 'include' : frontend et API partagent la meme
//    origine (Caddy route / vers le frontend et /api/* vers le backend), donc
//    'include' n'apporterait rien et autoriserait l'envoi du cookie vers une
//    origine tierce si une URL absolue se glissait un jour dans le code.
//
// 2. Interception centralisee des 401.
//    Une session peut expirer (12 h) ou etre revoquee pendant que l'onglet
//    reste ouvert. Sans traitement, chaque ecran afficherait sa propre erreur
//    incomprehensible. Ici, un 401 declenche le gestionnaire enregistre par
//    AuthContext, qui remet l'utilisateur a l'etat deconnecte ; les routes
//    protegees redirigent alors d'elles-memes vers /login.
//
// 3. Erreurs typees.
//    Le backend repond toujours { status, code?, message } ; ErreurApi porte
//    ces champs pour que les ecrans affichent un message utile plutot qu'un
//    "Failed to fetch" generique.

/** Erreur portant le statut HTTP et le code metier renvoyes par l'API. */
export class ErreurApi extends Error {
  constructor(statut, code, message) {
    super(message);
    this.name = 'ErreurApi';
    this.statut = statut;
    this.code = code;
  }
}

// Gestionnaire appele sur tout 401. Enregistre par AuthContext au montage.
// Ce detour evite d'appeler navigate() depuis ce module : la navigation
// imperative hors de React ferait sortir le routeur de son cycle normal et
// rendrait le comportement difficile a suivre. Ici, api.js signale, et c'est
// React qui decide quoi faire du changement d'etat.
let surSessionPerdue = null;

export function enregistrerGestionnaireSessionPerdue(gestionnaire) {
  surSessionPerdue = gestionnaire;
}

/**
 * Appelle l'API et renvoie le corps JSON.
 * @param {string} chemin - chemin relatif, ex. '/api/auth/moi'
 * @param {{ methode?: string, corps?: unknown, silencieuxSi401?: boolean }} [options]
 */
export async function appelerApi(chemin, options = {}) {
  const { methode = 'GET', corps, silencieuxSi401 = false } = options;

  const reponse = await fetch(chemin, {
    method: methode,
    credentials: 'same-origin',
    headers: corps ? { 'Content-Type': 'application/json' } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
  });

  // Une reponse sans corps JSON (204, erreur de passerelle) ne doit pas faire
  // planter l'appelant avec une erreur d'analyse peu parlante.
  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch {
    donnees = null;
  }

  if (reponse.status === 401) {
    // silencieuxSi401 sert au controle de session au chargement : a ce
    // moment, un 401 signifie simplement "personne n'est connecte", ce qui
    // est un etat normal et non la perte d'une session en cours. Declencher
    // le gestionnaire ici provoquerait une redirection vers /login... alors
    // que l'utilisateur y est deja.
    if (!silencieuxSi401 && surSessionPerdue) surSessionPerdue();
    throw new ErreurApi(401, donnees?.code ?? 'NON_AUTHENTIFIE', donnees?.message ?? 'Session expirée.');
  }

  if (!reponse.ok) {
    throw new ErreurApi(
      reponse.status,
      donnees?.code ?? null,
      donnees?.message ?? `La requête a échoué (${reponse.status}).`
    );
  }

  return donnees;
}
