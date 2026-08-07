// src/components/Jauge.jsx
// Jauge de progression des rapports d'assiduite (Etape 10).
//
// Partagee entre le rapport de seance et le bilan d'UF : les deux montrent la
// meme grandeur, et deux implementations divergeraient a la premiere
// retouche -- un seuil ajuste d'un cote seulement suffirait a rendre les deux
// documents contradictoires.
//
// TROIS REGLES DE CONCEPTION
//
// 1. LE CHIFFRE ACCOMPAGNE TOUJOURS LA BARRE. Une barre seule est invisible
//    pour une personne daltonienne (WCAG 1.4.1) et disparait a l'impression
//    noir et blanc -- soit precisement le support de ces documents.
// 2. LES SEUILS SONT ADMINISTRATIFS, PAS ESTHETIQUES. 80 % est le seuil usuel
//    de validation en promotion sociale, 50 % marque le decrochage. Les
//    couleurs traduisent une regle metier existante, elles n'en inventent pas.
// 3. LA BARRE EST BORDEE A 100 %. Un depassement deborderait de son conteneur
//    et casserait l'alignement de toute la colonne.
//
// Les seuils et le formatage vivent dans components/taux.js : ce sont des
// regles de domaine, testables sans monter le moindre composant.

import { palier, formaterTaux } from './taux';

const APPARENCE = {
  // Verts/ambres/rouges 600-700 : contraste verifie a 3:1 minimum sur le
  // fond de piste, seuil WCAG 1.4.11 pour un objet graphique porteur de sens.
  atteint: { barre: 'bg-emerald-600', texte: 'text-emerald-900', libelle: 'Quota atteint' },
  partiel: { barre: 'bg-amber-500', texte: 'text-amber-900', libelle: 'Partiel' },
  insuffisant: { barre: 'bg-red-600', texte: 'text-red-900', libelle: 'Insuffisant' },
  inconnu: { barre: 'bg-sable-400', texte: 'text-sable-600', libelle: 'Non calculable' },
};

/**
 * @param {number|null} pourcentage
 * @param {'normale'|'compacte'} taille
 */
function Jauge({ pourcentage, taille = 'normale', children }) {
  const etat = palier(pourcentage);
  const { barre, texte, libelle } = APPARENCE[etat];
  const largeur = pourcentage === null || pourcentage === undefined
    ? 0
    : Math.min(100, Math.max(0, pourcentage));

  const piste = taille === 'compacte' ? 'h-1.5 w-20' : 'h-2 w-full min-w-24';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm font-semibold tabular-nums ${texte}`}>
          {formaterTaux(pourcentage)}
        </span>
        {children && <span className="text-xs text-sable-600 tabular-nums">{children}</span>}
      </div>
      {/* role="img" avec un libelle complet : un lecteur d'ecran annonce le
          sens administratif ("Quota atteint"), pas une suite de div vides. */}
      <div
        role="img"
        aria-label={`${formaterTaux(pourcentage)} : ${libelle}`}
        className={`${piste} overflow-hidden rounded-full bg-sable-200 print:border print:border-sable-400`}
      >
        <div
          className={`h-full rounded-full ${barre} transition-[width] duration-500 ease-out motion-reduce:transition-none`}
          style={{ width: `${largeur}%` }}
        />
      </div>
    </div>
  );
}

export default Jauge;
