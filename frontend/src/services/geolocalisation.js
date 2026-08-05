// src/services/geolocalisation.js
// Acces a la position de l'appareil (HTML5 Geolocation).
//
// Enveloppe deliberement PERMISSIVE : cette fonction ne rejette jamais. Le
// geofencing est un indicateur secondaire, et un refus de permission, une
// absence de capteur ou un delai depasse ne doivent en aucun cas empecher un
// formateur d'ouvrir sa seance ou un etudiant de valider sa presence. Elle
// retourne donc toujours un objet, avec `position` a null en cas d'echec et
// un motif exploitable pour l'affichage.
//
// Comme WebCrypto (Etape 4) et getUserMedia (Etape 6), l'API exige un
// contexte securise : elle est refusee hors HTTPS. C'est la troisieme
// fonctionnalite du projet a en dependre, ce qui confirme la decision prise
// des l'Etape 0.2 de tout servir derriere Caddy.

/** Delai au-dela duquel on renonce, plutot que de faire attendre l'utilisateur. */
const DELAI_MAX_MS = 8000;

/**
 * @returns {Promise<{position: {latitude, longitude, precisionM}|null, motif: string}>}
 */
export function obtenirPosition() {
  return new Promise((resoudre) => {
    // Diagnostic explicite du contexte securise. window.isSecureContext est
    // le seul moyen fiable de distinguer "le navigateur refuse l'API" de
    // "le capteur n'a rien trouve" : sans ce controle, les deux se
    // presentent de la meme facon et le diagnostic est impossible.
    if (!window.isSecureContext) {
      resoudre({ position: null, motif: 'CONTEXTE_NON_SECURISE' });
      return;
    }
    if (!navigator.geolocation) {
      resoudre({ position: null, motif: 'INDISPONIBLE' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resoudre({
        position: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          // accuracy : rayon d'incertitude en metres, a 95 % de confiance.
          // Transmis au serveur car il conditionne la lecture de la distance.
          precisionM: Math.round(coords.accuracy),
        },
        motif: 'OK',
      }),
      (erreur) => {
        const motifs = {
          1: 'REFUSEE',      // PERMISSION_DENIED
          2: 'INDISPONIBLE', // POSITION_UNAVAILABLE
          3: 'DELAI_DEPASSE',
        };
        resoudre({ position: null, motif: motifs[erreur.code] ?? 'ERREUR' });
      },
      {
        // enableHighAccuracy sollicite le GPS plutot que la seule
        // triangulation reseau. Plus lent et plus consommateur, mais c'est
        // precisement la precision qui fait la valeur de la mesure ici.
        enableHighAccuracy: true,
        timeout: DELAI_MAX_MS,
        // maximumAge: 0 -- aucune position mise en cache. Une position
        // vieille de plusieurs minutes pourrait dater du trajet vers l'ecole
        // et invaliderait completement le controle.
        maximumAge: 0,
      }
    );
  });
}

/** Message court destine a l'utilisateur, selon le motif d'echec. */
export function messagePosition(motif) {
  return {
    REFUSEE: "Position non partagée. L'action reste valable, mais ne pourra pas être confirmée géographiquement.",
    // Cas le plus frequent sur un ordinateur fixe : sans puce GPS ni carte
    // Wi-Fi, le navigateur n'a aucune source pour se localiser. Le dire
    // explicitement evite de chercher un defaut dans l'application.
    INDISPONIBLE: "Aucune source de position sur cet appareil. C'est courant sur un ordinateur fixe sans Wi-Fi. L'action reste valable.",
    DELAI_DEPASSE: "La position n'a pas pu être obtenue à temps. L'action reste valable.",
    CONTEXTE_NON_SECURISE: "La géolocalisation est bloquée car la page n'est pas dans un contexte sécurisé. Acceptez le certificat, ou consultez TESTING.md. L'action reste valable.",
    ERREUR: "La position n'a pas pu être obtenue. L'action reste valable.",
  }[motif] ?? '';
}
