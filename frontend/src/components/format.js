// src/components/format.js
// Mise en forme des dates et durees.
//
// Le serveur renvoie des instants en UTC ; toute conversion vers l'heure
// locale se fait ici, et nulle part ailleurs. Centraliser evite qu'un ecran
// affiche par megarde une heure brute, ce qui donnerait un decalage silencieux
// de plusieurs heures selon la saison.

const LOCALE = 'fr-BE';

/** "14:05", ou un tiret si l'instant est absent. */
export function heure(instant) {
  if (!instant) return '—';
  return new Date(instant).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** "lun. 1 sept." */
export function dateCourte(instant) {
  if (!instant) return '—';
  return new Date(instant).toLocaleDateString(LOCALE, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

/**
 * Duree en minutes vers "3 h 05".
 *
 * null signifie "presence encore ouverte", et non "zero minute" : les deux
 * doivent rester distinguables a l'ecran, faute de quoi un etudiant encore
 * en cours apparaitrait comme n'ayant pas assiste.
 */
export function duree(minutes) {
  if (minutes === null || minutes === undefined) return 'En cours';
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, '0')}`;
}
