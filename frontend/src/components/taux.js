// src/components/taux.js
// Paliers administratifs et mise en forme des pourcentages d'assiduite.
//
// Sorti de Jauge.jsx pour une raison concrete : Fast Refresh ne fonctionne
// que si un fichier n'exporte QUE des composants. Melanger fonctions et
// composants casse le rechargement a chaud en developpement -- defaut deja
// rencontre sur ce projet.
//
// La separation a aussi un merite propre : ces regles sont du DOMAINE, pas de
// la presentation. Le seuil de 80 % vient du reglement de la promotion
// sociale, pas d'un choix graphique, et il doit pouvoir etre teste sans
// monter le moindre composant.

/** Seuil de validation usuel en promotion sociale. */
export const SEUIL_VALIDATION = 80;
/** En deca, le decrochage est avere. */
export const SEUIL_DECROCHAGE = 50;

/**
 * Palier administratif d'un taux.
 * @returns {'atteint'|'partiel'|'insuffisant'|'inconnu'}
 */
export function palier(pourcentage) {
  if (pourcentage === null || pourcentage === undefined) return 'inconnu';
  if (pourcentage >= SEUIL_VALIDATION) return 'atteint';
  if (pourcentage >= SEUIL_DECROCHAGE) return 'partiel';
  return 'insuffisant';
}

/** 92.5 devient "92,5 %". Virgule decimale, comme l'exige l'usage francophone. */
export function formaterTaux(pourcentage) {
  if (pourcentage === null || pourcentage === undefined) return '—';
  return `${String(pourcentage).replace('.', ',')} %`;
}

/**
 * "18 h 30 / 20 h 00" : le temps effectif rapporte a sa reference.
 *
 * Le denominateur est TOUJOURS affiche, meme quand il vaut zero. Un temps
 * sans reference ne veut rien dire : "2 h 30" ne se compare a rien, alors que
 * "2 h 30 / 3 h 00" se lit d'un coup d'oeil.
 */
export function formaterRatio(minutes, minutesPrevues) {
  const enHeures = (m) => {
    if (m === null || m === undefined) return '—';
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  };
  if (!minutesPrevues) return enHeures(minutes);
  return `${enHeures(minutes ?? 0)} / ${enHeures(minutesPrevues)}`;
}
