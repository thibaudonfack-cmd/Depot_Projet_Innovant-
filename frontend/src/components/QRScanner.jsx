// src/components/QRScanner.jsx
// Lecteur de QR code natif web (Etape 6) : flux camera via getUserMedia,
// decodage via jsQR, sans aucun plugin ni application tierce.
//
// Le composant est volontairement "muet" sur le metier : il ne connait ni
// les jetons, ni les scans, ni l'API. Il lit un QR code et remonte son
// contenu textuel via onDetection(). Toute la logique de signature et
// d'envoi reste dans App.jsx (Etape 5, inchangee). Cette separation permet
// de reutiliser ce scanner pour un autre usage, et surtout de raisonner sur
// le cycle de vie de la camera sans le melanger a celui d'une requete reseau.
//
// CYCLE DE VIE DE LA CAMERA -- le point le plus delicat de ce fichier.
// Trois ressources doivent etre liberees, et chacune fuit differemment :
//   1. Les MediaStreamTrack : tant qu'un track n'est pas .stop(), la camera
//      reste ACTIVE (voyant allume sur le telephone, batterie consommee en
//      continu). C'est la fuite la plus visible pour l'utilisateur.
//   2. La boucle requestAnimationFrame : sans annulation, elle continue de
//      s'executer apres le demontage et tente de lire une video detachee --
//      erreurs en console et calcul inutile a chaque frame.
//   3. Le cas de course du demontage precoce (voir plus bas) : le piege le
//      moins evident, et celui qui laisse la camera allumee de facon
//      totalement silencieuse.

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// Resolution de travail du decodage. La video peut etre en 1080p ; analyser
// chaque frame a cette taille couterait cher en CPU (donc en batterie) pour
// un gain nul : jsQR n'a pas besoin de plus de finesse pour localiser un QR
// code qui occupe une bonne partie du cadre. On redimensionne donc vers ce
// cote maximal avant analyse.
const COTE_ANALYSE_MAX = 480;

// Etats possibles, exposes tels quels dans le rendu.
const ETAT = {
  DEMARRAGE: 'demarrage',
  ACTIF: 'actif',
  SUCCES: 'succes',
  ERREUR: 'erreur',
};

/**
 * @param {(texte: string) => void} onDetection - appele UNE SEULE FOIS avec
 *   le contenu du QR code des qu'il est decode. Le scanner s'arrete alors
 *   de lui-meme (camera coupee) : c'est au parent de le demonter ou de le
 *   remonter pour relancer un scan.
 * @param {() => void} [onAnnuler] - si fourni, affiche un bouton d'annulation.
 */
function QRScanner({ onDetection, onAnnuler }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Refs (et non state) pour tout ce qui doit etre lu/ecrit par la fonction
  // de nettoyage : un state serait fige a la valeur qu'il avait au moment ou
  // l'effet a ete cree, alors qu'une ref donne toujours la valeur courante.
  const fluxRef = useRef(null);
  const animationRef = useRef(null);
  const dejaDetecteRef = useRef(false);

  const [etat, setEtat] = useState(ETAT.DEMARRAGE);
  const [messageErreur, setMessageErreur] = useState('');

  /** Libere TOUTES les ressources camera. Idempotent : peut etre appele plusieurs fois. */
  const arreterCamera = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (fluxRef.current) {
      // getTracks() et non getVideoTracks() : si un jour une piste audio
      // etait demandee, elle serait coupee elle aussi. Ne rien supposer sur
      // le contenu du flux.
      fluxRef.current.getTracks().forEach((track) => track.stop());
      fluxRef.current = null;
    }
    if (videoRef.current) {
      // Detacher explicitement : sans cela, l'element video conserve une
      // reference au MediaStream (deja arrete, mais retenu en memoire tant
      // que l'element existe).
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    // Drapeau local a CETTE execution de l'effet. Indispensable a cause du
    // cas de course suivant : getUserMedia() est asynchrone et peut mettre
    // plusieurs secondes a se resoudre (le navigateur attend la reponse de
    // l'utilisateur a la demande de permission). Si le composant est demonte
    // pendant cette attente -- l'utilisateur ferme le scanner, ou React
    // remonte le composant, ce que StrictMode fait systematiquement en
    // developpement -- la fonction de nettoyage s'execute AVANT que le flux
    // n'existe : elle n'a alors rien a arreter. Le flux arrive ensuite, est
    // affecte a un composant qui n'est plus monte, et n'est JAMAIS coupe :
    // la camera reste allumee indefiniment, sans aucune trace a l'ecran.
    // Ce drapeau permet de detecter ce cas et de couper immediatement le
    // flux qui vient d'arriver.
    let annule = false;

    async function demarrer() {
      try {
        // facingMode 'environment' : camera arriere sur mobile (celle qu'on
        // pointe vers le QR affiche). Exprime en CONTRAINTE SOUPLE (et non
        // via exact: 'environment') : sur un ordinateur portable, il n'existe
        // qu'une webcam frontale, et une contrainte stricte ferait echouer
        // getUserMedia avec OverconstrainedError. Ici, le navigateur choisit
        // la camera arriere si elle existe, la seule disponible sinon --
        // le scanner reste donc testable sur un poste de developpement.
        const flux = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });

        if (annule) {
          // Demontage pendant l'attente : couper tout de suite, ne rien afficher.
          flux.getTracks().forEach((track) => track.stop());
          return;
        }

        fluxRef.current = flux;
        const video = videoRef.current;
        if (!video) {
          flux.getTracks().forEach((track) => track.stop());
          return;
        }

        video.srcObject = flux;

        // play() renvoie une promesse qui REJETTE (AbortError) si l'element
        // est detache avant le demarrage effectif -- cas courant lors d'un
        // demontage rapide. Sans ce catch, l'erreur remonterait en promesse
        // non geree dans la console, alors qu'elle est parfaitement benigne.
        await video.play().catch(() => {});
        if (annule) return;

        setEtat(ETAT.ACTIF);
        animationRef.current = requestAnimationFrame(analyserFrame);
      } catch (erreur) {
        if (annule) return;
        setEtat(ETAT.ERREUR);
        setMessageErreur(traduireErreurCamera(erreur));
      }
    }

    function analyserFrame() {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      // readyState < HAVE_ENOUGH_DATA : la video n'a pas encore de frame
      // exploitable (juste apres le demarrage). Lire le canvas maintenant
      // produirait une image vide -- on repasse simplement au tour suivant.
      if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
        animationRef.current = requestAnimationFrame(analyserFrame);
        return;
      }

      const ratio = Math.min(
        1,
        COTE_ANALYSE_MAX / Math.max(video.videoWidth, video.videoHeight)
      );
      const largeur = Math.round(video.videoWidth * ratio);
      const hauteur = Math.round(video.videoHeight * ratio);
      canvas.width = largeur;
      canvas.height = hauteur;

      // willReadFrequently: true -- indique au navigateur que ce canvas sera
      // lu (getImageData) a chaque frame. Sans cette option, certains
      // moteurs conservent le canvas en memoire GPU et chaque lecture
      // declenche un transfert GPU->CPU couteux ; avec elle, le canvas est
      // maintenu cote CPU. Gain de performance direct sur mobile, donc
      // d'autonomie.
      const contexte = canvas.getContext('2d', { willReadFrequently: true });
      contexte.drawImage(video, 0, 0, largeur, hauteur);
      const image = contexte.getImageData(0, 0, largeur, hauteur);

      // inversionAttempts: 'dontInvert' : ne cherche pas les QR codes en
      // video inverse (clair sur fond sombre). Le QR affiche par ce projet
      // est toujours sombre sur clair -- economiser cette seconde passe
      // divise par deux le travail de jsQR a chaque frame.
      const resultat = jsQR(image.data, largeur, hauteur, {
        inversionAttempts: 'dontInvert',
      });

      if (resultat && resultat.data && !dejaDetecteRef.current) {
        // Verrou : sans lui, les frames deja en vol pourraient declencher
        // plusieurs onDetection() pour un meme QR code -- donc plusieurs
        // requetes de scan, dont la seconde serait rejetee en REJEU_DETECTE
        // (Etape 3) alors que l'utilisateur n'a scanne qu'une fois.
        dejaDetecteRef.current = true;
        setEtat(ETAT.SUCCES);
        arreterCamera();
        onDetection(resultat.data);
        return;
      }

      animationRef.current = requestAnimationFrame(analyserFrame);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setEtat(ETAT.ERREUR);
      setMessageErreur(
        "Ce navigateur ne donne pas acces a la camera. Verifiez que la page est bien servie en HTTPS "
        + '(l\'API camera est refusee hors contexte securise) et utilisez un navigateur recent.'
      );
      return undefined;
    }

    demarrer();

    return () => {
      annule = true;
      arreterCamera();
    };
    // onDetection et arreterCamera sont stables (useCallback cote parent et
    // ici) : l'effet ne doit surtout pas se relancer a chaque rendu, sinon
    // la camera serait coupee et redemandee en boucle.
  }, [onDetection, arreterCamera]);

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-sable-900">
        {/* La video reste montee en permanence : la referencer via ref exige
            qu'elle existe dans le DOM avant meme que le flux n'arrive.
            playsInline : sans cet attribut, Safari iOS ouvre la video en
            plein ecran natif et masque tout l'habillage du scanner.
            muted : requis pour que la lecture automatique soit autorisee. */}
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Flux de la caméra"
          className={`size-full object-cover transition-opacity duration-300 ${
            etat === ETAT.ACTIF || etat === ETAT.SUCCES ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <canvas ref={canvasRef} className="hidden" />

        {etat === ETAT.DEMARRAGE && <VueDemarrage />}
        {etat === ETAT.ACTIF && <VueVisee />}
        {etat === ETAT.SUCCES && <VueSucces />}
        {etat === ETAT.ERREUR && <VueErreur message={messageErreur} />}
      </div>

      {onAnnuler && etat !== ETAT.SUCCES && (
        <button
          type="button"
          onClick={onAnnuler}
          className="w-full rounded-md border border-sable-400 bg-white px-4 py-2.5 text-sm font-medium
                     text-sable-900 transition-colors hover:bg-sable-100 focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-sable-900 focus-visible:ring-offset-2"
        >
          Fermer le scanner
        </button>
      )}
    </div>
  );
}

/** Etat de chargement : la demande de permission peut prendre plusieurs secondes. */
function VueDemarrage() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sable-900">
      {/* motion-safe: l'animation ne joue pas si l'utilisateur a demande la
          reduction des animations dans son systeme (accessibilite : les
          mouvements repetitifs peuvent declencher des troubles vestibulaires). */}
      <span
        aria-hidden="true"
        className="size-8 rounded-full border-2 border-sable-600 border-t-white motion-safe:animate-spin"
      />
      <p className="px-6 text-center text-sm text-sable-400">
        Accès à la caméra…
        <span className="mt-1 block text-xs text-sable-500">
          Autorisez l'accès dans la fenêtre affichée par votre navigateur.
        </span>
      </p>
    </div>
  );
}

/** Etat actif : habillage de visee par-dessus le flux video. */
function VueVisee() {
  return (
    <>
      {/* Assombrissement peripherique obtenu par une ombre portee INTERIEURE
          demesuree sur la fenetre de visee, plutot que par quatre panneaux
          positionnes autour : une seule regle, aucun calcul de dimensions,
          et le rendu reste exact quelle que soit la taille du conteneur. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="relative size-3/5 rounded-lg shadow-[0_0_0_9999px_rgba(15,23,42,0.6)]">
          {/* Coins de visee : quatre bordures partielles, sans image. */}
          <span className="absolute -top-px -left-px size-7 rounded-tl-lg border-t-2 border-l-2 border-white/90" />
          <span className="absolute -top-px -right-px size-7 rounded-tr-lg border-t-2 border-r-2 border-white/90" />
          <span className="absolute -bottom-px -left-px size-7 rounded-bl-lg border-b-2 border-l-2 border-white/90" />
          <span className="absolute -right-px -bottom-px size-7 rounded-br-lg border-r-2 border-b-2 border-white/90" />

          {/* Ligne de balayage : purement decorative, elle ne reflete pas la
              progression reelle du decodage (jsQR analyse l'image entiere a
              chaque frame). Elle sert uniquement a signaler que le scanner
              est actif -- masquee si l'utilisateur reduit les animations. */}
          <span className="absolute inset-x-2 top-0 hidden h-0.5 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.9)] motion-safe:block motion-safe:animate-[balayage_2.4s_ease-in-out_infinite]" />
        </div>
      </div>

      <p className="absolute inset-x-0 bottom-4 text-center text-sm font-medium text-white drop-shadow">
        Placez le QR code au centre
      </p>
    </>
  );
}

/** Etat succes : confirmation immediate, avant meme l'aller-retour reseau. */
function VueSucces() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-emerald-600/95">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-12 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <p className="text-sm font-medium text-white">QR code détecté</p>
    </div>
  );
}

/** Etat erreur : message actionnable, jamais un code technique brut. */
function VueErreur({ message }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sable-900 px-6">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-10 text-red-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" />
      </svg>
      <p className="text-center text-sm leading-relaxed text-sable-300">{message}</p>
    </div>
  );
}

/**
 * Traduit une erreur getUserMedia en message actionnable. Les noms d'erreur
 * sont normalises par la specification Media Capture -- on s'appuie sur
 * err.name (contractuel) et jamais sur err.message (texte libre, variable
 * selon le navigateur et la langue du systeme).
 */
function traduireErreurCamera(erreur) {
  switch (erreur.name) {
    case 'NotAllowedError':
      return "Accès à la caméra refusé. Autorisez-le dans les paramètres du site (icône à gauche de la barre d'adresse), puis rouvrez le scanner.";
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Aucune caméra détectée sur cet appareil. Utilisez la saisie manuelle du jeton.';
    case 'NotReadableError':
      return 'La caméra est déjà utilisée par une autre application. Fermez-la puis réessayez.';
    case 'OverconstrainedError':
      return "Aucune caméra ne correspond aux contraintes demandées sur cet appareil.";
    case 'SecurityError':
      return "Accès refusé pour raison de sécurité : la page doit être servie en HTTPS.";
    default:
      return `Impossible d'accéder à la caméra (${erreur.name || 'erreur inconnue'}).`;
  }
}

export default QRScanner;
