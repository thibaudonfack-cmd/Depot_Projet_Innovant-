// src/components/Modale.jsx
// Boite de dialogue modale.
//
// Construite sur l'element <dialog> natif plutot que sur un div positionne :
// le navigateur fournit alors le piegeage du focus, la fermeture par Echap,
// le fond inerte et la couche superieure. Reimplementer tout cela a la main
// est la source la plus frequente de modales inaccessibles au clavier.
//
// Le dialogue reste MONTE en permanence, meme ferme. C'est la condition pour
// que l'animation de sortie joue : un composant demonte par une condition
// React disparait au premier frame, et seule l'ouverture serait animee. Le
// contenu, lui, peut rester conditionnel a l'interieur.

import { useEffect, useRef } from 'react';

function Modale({ ouverte, titre, description, onFermer, children }) {
  const dialogueRef = useRef(null);

  useEffect(() => {
    const dialogue = dialogueRef.current;
    if (!dialogue) return;
    // showModal() et non show() : seul le premier rend le reste de la page
    // inerte et active le piegeage du focus.
    if (ouverte && !dialogue.open) dialogue.showModal();
    if (!ouverte && dialogue.open) dialogue.close();
  }, [ouverte]);

  useEffect(() => {
    const dialogue = dialogueRef.current;
    if (!dialogue) return undefined;
    // L'evenement 'close' couvre AUSSI la fermeture par Echap, que nous ne
    // declenchons pas nous-memes : sans cet ecouteur, l'etat React resterait
    // a "ouverte" apres un Echap et la modale ne pourrait plus etre rouverte.
    const surFermeture = () => onFermer();
    dialogue.addEventListener('close', surFermeture);
    return () => dialogue.removeEventListener('close', surFermeture);
  }, [onFermer]);

  return (
    <dialog ref={dialogueRef} aria-labelledby="titre-modale" className="modale">
      {/* Le fond blanc est porte par cette enveloppe et non par <dialog>
          lui-meme : cela permet d'animer le dialogue (transform) sans
          deformer le rendu du fond, et laisse le coin arrondi net. */}
      <div className="relative rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-sable-300 sm:p-8">
        <header>
          <h2 id="titre-modale" className="text-lg font-semibold tracking-tight text-sable-900">
            {titre}
          </h2>
          {description && (
            <p className="mt-1.5 text-sm leading-relaxed text-sable-600">{description}</p>
          )}
        </header>

        {/* Bouton de fermeture explicite en plus d'Echap : sur mobile, la
            touche n'existe pas, et cliquer en dehors ne ferme pas un
            <dialog> nativement. */}
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer"
          className="absolute top-4 right-4 rounded-lg p-2 text-sable-500 transition-colors
                     hover:bg-sable-100 hover:text-sable-900 focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-accent-600"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4"
               fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="mt-6">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * Zone de texte generique des modales. Genereuse par defaut : un champ
 * etroit decourage la saisie, alors que ces motifs seront relus des annees
 * plus tard par une personne qui n'etait pas la.
 */
export function ZoneTexte({ id, libelle, aide, obligatoire = false, ...props }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-sable-900">
        {libelle}
        {obligatoire && <span className="ml-1 font-normal text-sable-600">(obligatoire)</span>}
      </label>
      {aide && <p id={`${id}-aide`} className="text-xs leading-relaxed text-sable-500">{aide}</p>}
      <textarea
        id={id}
        rows={4}
        aria-describedby={aide ? `${id}-aide` : undefined}
        className="w-full resize-y rounded-xl border border-sable-400 bg-white px-4 py-3 text-sm
                   leading-relaxed text-sable-900 shadow-sm transition-colors
                   placeholder:text-sable-500 focus-visible:border-accent-600
                   focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-500/15"
        {...props}
      />
    </div>
  );
}

/** Pied de modale : action principale a droite, annulation a gauche. */
export function PiedModale({ children }) {
  return (
    <div className="mt-7 flex flex-col-reverse gap-3 border-t border-sable-200 pt-5 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}

export default Modale;
