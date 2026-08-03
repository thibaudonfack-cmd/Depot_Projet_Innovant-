// src/components/Modale.jsx
// Boite de dialogue modale.
//
// Construite sur l'element <dialog> natif plutot que sur un div positionne :
// le navigateur fournit alors gratuitement le piegeage du focus, la fermeture
// par Echap, le fond inerte et la couche superieure. Reimplementer tout cela
// a la main est la source la plus frequente de modales inaccessibles au
// clavier.

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
    <dialog
      ref={dialogueRef}
      aria-labelledby="titre-modale"
      className="w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-sable-300 bg-white p-0
                 shadow-[var(--shadow-elevee)] backdrop:bg-sable-900/40 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 id="titre-modale" className="text-base font-semibold text-sable-900">{titre}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-sable-600">{description}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  );
}

export default Modale;
