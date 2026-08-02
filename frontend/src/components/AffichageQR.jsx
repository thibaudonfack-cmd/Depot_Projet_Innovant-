// src/components/AffichageQR.jsx
// Affichage du QR code de seance, avec projection en plein ecran.
//
// Destine au formateur : le QR est projete au tableau, les etudiants le
// scannent depuis leur place. Le plein ecran n'est donc pas un confort mais
// une necessite fonctionnelle -- un QR affiche dans une carte de 200 px est
// illisible depuis le fond d'une salle.
//
// Rendu en SVG plutot qu'en canvas : net a toute taille, y compris
// videoprojete sur plusieurs metres, la ou un canvas pixelliserait.

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Etat plein ecran courant, tous prefixes confondus.
 *
 * Safari n'implemente toujours pas l'API sans prefixe : sans webkit*, le
 * bouton paraitrait sans effet sur iPad et sur Safari macOS, machines
 * frequentes en salle de cours.
 */
function elementPleinEcran() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function AffichageQR({ valeur, libelle, aide }) {
  const conteneurRef = useRef(null);
  const [enPleinEcran, setEnPleinEcran] = useState(false);
  const [pleinEcranIndisponible, setPleinEcranIndisponible] = useState(false);

  // L'etat est lu depuis le document, jamais deduit de nos propres clics :
  // l'utilisateur peut sortir du plein ecran par la touche Echap ou par un
  // geste du systeme, sans passer par notre bouton. Un booleen maintenu a la
  // main se desynchroniserait a la premiere sortie par Echap, et le bouton
  // proposerait alors d'entrer en plein ecran alors qu'on y est deja.
  useEffect(() => {
    const synchroniser = () => setEnPleinEcran(Boolean(elementPleinEcran()));
    document.addEventListener('fullscreenchange', synchroniser);
    document.addEventListener('webkitfullscreenchange', synchroniser);
    synchroniser();
    return () => {
      document.removeEventListener('fullscreenchange', synchroniser);
      document.removeEventListener('webkitfullscreenchange', synchroniser);
    };
  }, []);

  const basculerPleinEcran = useCallback(async () => {
    const conteneur = conteneurRef.current;
    if (!conteneur) return;

    try {
      if (elementPleinEcran()) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
        return;
      }
      const demander = conteneur.requestFullscreen ?? conteneur.webkitRequestFullscreen;
      if (!demander) {
        setPleinEcranIndisponible(true);
        return;
      }
      await demander.call(conteneur);
    } catch {
      // requestFullscreen rejette si l'appel ne decoule pas d'un geste
      // utilisateur, ou si la politique du navigateur l'interdit. On le
      // signale plutot que de laisser un bouton qui ne repond pas.
      setPleinEcranIndisponible(true);
    }
  }, []);

  return (
    <div
      ref={conteneurRef}
      className={
        enPleinEcran
          ? 'flex h-svh w-svw flex-col items-center justify-center gap-8 bg-white p-8'
          : 'flex flex-col items-center gap-4 rounded-2xl border border-sable-300 bg-white p-6'
      }
    >
      {enPleinEcran && libelle && (
        <p className="text-center text-2xl font-semibold tracking-tight text-sable-900">
          {libelle}
        </p>
      )}

      {/* Fond blanc et zone de silence (marginSize) imposes par la norme QR :
          sans marge suffisante ni contraste franc, un lecteur peine a
          localiser les motifs de reperage. Niveau M : compromis usuel entre
          densite et tolerance aux reflets ou aux angles de vue. */}
      <QRCodeSVG
        value={valeur}
        level="M"
        marginSize={2}
        className={enPleinEcran ? 'h-auto w-full max-w-[min(80vh,80vw)]' : 'h-auto w-full max-w-60'}
      />

      {aide && !enPleinEcran && (
        <p className="text-center text-xs text-sable-500">{aide}</p>
      )}

      <button
        type="button"
        onClick={basculerPleinEcran}
        className="inline-flex items-center gap-2 rounded-xl border border-sable-400 bg-white px-4 py-2.5
                   text-sm font-medium text-sable-700 shadow-[var(--shadow-douce)]
                   transition-all duration-200 hover:border-sable-500 hover:bg-sable-100
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600
                   focus-visible:ring-offset-2"
      >
        <svg
          viewBox="0 0 24 24" aria-hidden="true" className="size-4"
          fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        >
          {enPleinEcran ? (
            <path d="M9 3v3a3 3 0 0 1-3 3H3M15 3v3a3 3 0 0 0 3 3h3M9 21v-3a3 3 0 0 0-3-3H3M15 21v-3a3 3 0 0 1 3-3h3" />
          ) : (
            <path d="M3 9V6a3 3 0 0 1 3-3h3M21 9V6a3 3 0 0 0-3-3h-3M3 15v3a3 3 0 0 0 3 3h3M21 15v3a3 3 0 0 1-3 3h-3" />
          )}
        </svg>
        {enPleinEcran ? 'Quitter le plein écran' : 'Projeter en plein écran'}
      </button>

      {enPleinEcran && (
        <p className="text-sm text-sable-500">Appuyez sur Échap pour revenir</p>
      )}

      <div aria-live="polite">
        {pleinEcranIndisponible && (
          <p className="text-center text-xs text-sable-600">
            Le plein écran n&apos;est pas disponible dans ce navigateur. Utilisez
            le mode plein écran de votre navigateur, généralement la touche F11.
          </p>
        )}
      </div>
    </div>
  );
}

export default AffichageQR;
