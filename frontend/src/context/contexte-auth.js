// src/context/contexte-auth.js
// Contexte, hook d'acces et utilitaires lies a l'authentification.
//
// Separe de AuthContext.jsx, qui n'exporte plus qu'un composant. Raison :
// le rafraichissement a chaud de React (Fast Refresh) ne fonctionne sur un
// fichier que si celui-ci exporte exclusivement des composants. Melanger un
// composant et des fonctions dans le meme fichier fait perdre le
// rechargement a chaud pour tout ce qui en depend, ce qui degrade
// serieusement le confort de developpement sans erreur visible.

import { createContext, useContext } from 'react';

export const ContexteAuth = createContext(null);

export function useAuth() {
  const contexte = useContext(ContexteAuth);
  if (!contexte) {
    throw new Error("useAuth doit être utilisé à l'intérieur de FournisseurAuth.");
  }
  return contexte;
}

/** Chemin du tableau de bord correspondant à un rôle. */
export function accueilDuRole(role) {
  return role === 'formateur' ? '/formateur' : '/etudiant';
}
