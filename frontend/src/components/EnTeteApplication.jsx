// src/components/EnTeteApplication.jsx
// En-tete commun aux deux tableaux de bord : marque, identite de la personne
// connectee, deconnexion.
//
// Colle en haut (sticky) avec un fond translucide et un flou : sur mobile,
// le bouton de deconnexion reste accessible sans remonter toute la page, et
// le contenu qui defile dessous reste lisible.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/contexte-auth';
import { Bouton, Marque } from './ui';

/** Initiales, pour l'avatar. Deux lettres au maximum. */
function initiales(nom) {
  return (nom || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((mot) => mot[0].toUpperCase())
    .join('');
}

function EnTeteApplication({ sousTitre }) {
  const { utilisateur, deconnecter } = useAuth();
  const navigate = useNavigate();
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);

  async function handleDeconnexion() {
    setDeconnexionEnCours(true);
    await deconnecter();
    navigate('/login', { replace: true });
  }

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
        <Marque compacte />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {utilisateur?.nom}
          </p>
          <p className="truncate text-xs text-slate-500">{sousTitre}</p>
        </div>

        <span
          aria-hidden="true"
          className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-accent-50
                     text-xs font-semibold text-accent-700 sm:flex"
        >
          {initiales(utilisateur?.nom)}
        </span>

        <Bouton
          variante="discret"
          onClick={handleDeconnexion}
          chargement={deconnexionEnCours}
          className="w-auto shrink-0 px-3 py-2"
        >
          <span className="hidden sm:inline">Se déconnecter</span>
          {/* Sur mobile, seule l'icone est affichee pour ne pas ecraser le
              nom de la personne. aria-label porte alors le sens. */}
          <svg
            viewBox="0 0 24 24" aria-hidden="true" className="size-4 sm:hidden"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          <span className="sr-only sm:hidden">Se déconnecter</span>
        </Bouton>
      </div>
    </header>
  );
}

export default EnTeteApplication;
