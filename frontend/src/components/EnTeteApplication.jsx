// src/components/EnTeteApplication.jsx
// En-tete commun aux tableaux de bord : marque cliquable, identite de la
// personne connectee, deconnexion.
//
// Colle en haut avec un fond translucide et un flou : sur mobile, la
// deconnexion reste accessible sans remonter toute la page, et le contenu
// qui defile dessous reste lisible.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/contexte-auth';
import { Marque } from './ui';

/** Initiales pour l'avatar, deux lettres au maximum. */
function initiales(nom) {
  return (nom || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((mot) => mot[0].toUpperCase())
    .join('');
}

/**
 * @param {string} sousTitre
 * @param {string} [confirmationRetour] si fourni, un clic sur la marque
 *   demande confirmation avant de quitter la page. Utilise lorsqu'un ecran
 *   affiche quelque chose que l'utilisateur perdrait en partant, typiquement
 *   un QR code projete devant une classe.
 */
function EnTeteApplication({ sousTitre, confirmationRetour }) {
  const { utilisateur, deconnecter } = useAuth();
  const navigate = useNavigate();
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);

  async function handleDeconnexion() {
    setDeconnexionEnCours(true);
    await deconnecter();
    navigate('/login', { replace: true });
  }

  /**
   * Retour arriere au clic sur la marque.
   *
   * history.length > 1 distingue deux situations : l'onglet a un historique
   * (on peut revenir en arriere) ou il a ete ouvert directement sur cette
   * page (revenir sortirait du site, ou ne ferait rien). Dans ce second cas,
   * on renvoie vers la racine, qui aiguille ensuite selon la session.
   * Sans ce controle, un clic depuis un onglet neuf donnerait l'impression
   * d'un bouton mort.
   */
  function handleRetour() {
    // Garde-fou : quitter cet ecran ferait disparaitre le QR projete, et le
    // formateur devrait rouvrir une seance devant sa classe. Un clic
    // accidentel sur la marque ne doit pas avoir cette consequence.
    // confirm() plutot qu'une boite maison : l'action est rare, bloquante et
    // sans nuance, et le dialogue natif est deja accessible au clavier et
    // traduit dans la langue du systeme.
    if (confirmationRetour && !window.confirm(confirmationRetour)) return;

    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  }

  return (
    <header className="sticky top-0 z-10 border-b border-sable-300 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-20 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
        {/* Un vrai <button> et non une <div> cliquable : le clavier et les
            technologies d'assistance le reconnaissent comme actionnable, et
            title/aria-label annoncent ce qu'il fait. Le libelle visible
            ("Prise de présence") ne suffirait pas a comprendre l'action. */}
        <button
          type="button"
          onClick={handleRetour}
          title={confirmationRetour ? 'Quitter cet écran' : 'Revenir à la page précédente'}
          aria-label={confirmationRetour ? 'Quitter cet écran' : 'Revenir à la page précédente'}
          className="-m-2 shrink-0 rounded-2xl p-2 transition-colors duration-200
                     hover:bg-sable-100 focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-accent-600 focus-visible:ring-offset-2"
        >
          <Marque taille="compacte" />
        </button>

        {/* flex-1 pour occuper l'espace disponible et repousser les actions a
            droite, mais alignement a GAUCHE a toutes les tailles. La version
            precedente utilisait text-right sur mobile, ce qui collait le nom
            contre le bouton de deconnexion et donnait l'impression d'un bloc
            decale. Le texte doit suivre le bord de la marque, pas flotter. */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-sable-900">{utilisateur?.nom}</p>
          <p className="truncate text-xs text-sable-500">{sousTitre}</p>
        </div>

        <span
          aria-hidden="true"
          className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-accent-50
                     text-xs font-semibold text-accent-900 sm:flex"
        >
          {initiales(utilisateur?.nom)}
        </span>

        {/* Deconnexion volontairement discrete : c'est une action rare, elle
            ne doit pas concurrencer visuellement les actions principales de
            la page. Style fantome, sans bordure ni fond au repos. */}
        <button
          type="button"
          onClick={handleDeconnexion}
          disabled={deconnexionEnCours}
          title="Se déconnecter"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2 text-sm
                     text-sable-500 transition-colors duration-200
                     hover:bg-sable-100 hover:text-sable-900
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600
                     focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {deconnexionEnCours ? (
            <span
              aria-hidden="true"
              className="size-4 rounded-full border-2 border-sable-300 border-t-sable-600 motion-safe:animate-spin"
            />
          ) : (
            <svg
              viewBox="0 0 24 24" aria-hidden="true" className="size-[1.15rem]"
              fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          )}
          {/* Libelle masque sous 640 px pour ne pas ecraser le nom sur
              telephone. sr-only conserve l'information pour les lecteurs
              d'ecran quelle que soit la largeur. */}
          <span className="hidden sm:inline">Se déconnecter</span>
          <span className="sr-only sm:hidden">Se déconnecter</span>
        </button>
      </div>
    </header>
  );
}

export default EnTeteApplication;
