// src/services/geofencingService.js
// Distance geographique et coherence de position (RF-13, Etape 7e).
//
// CE QUE CE MODULE EST, ET CE QU'IL N'EST PAS.
//
// Les coordonnees traitees ici sont rapportees PAR LE CLIENT. Ce sont deux
// nombres dans un corps JSON, et navigator.geolocation se falsifie depuis les
// outils de developpement de n'importe quel navigateur en une dizaine de
// secondes, sans competence particuliere. Ce module n'est donc PAS un
// controle de securite : c'est un dispositif de DISSUASION et de
// TRACABILITE.
//
// Sa valeur reelle : il eleve la barre pour la fraude opportuniste, et il
// transforme une fraude passive en acte delibere et documente -- l'etudiant
// doit falsifier activement un capteur, ce qui deplace le probleme du terrain
// technique vers le terrain disciplinaire, ou il est bien mieux traite.
// Presente comme une preuve de presence physique, il serait attaquable en
// trois secondes. Cf. ANALYSE_CODE.md, section Etape 7e.

/** Rayon retenu par defaut, en metres. */
const RAYON_TOLERANCE_DEFAUT_M = 100;

/**
 * Au-dela de cette incertitude, aucune conclusion n'est tiree.
 *
 * En interieur, le GPS ne fixe souvent pas du tout et le telephone bascule
 * sur le positionnement Wi-Fi (10 a 40 m en zone urbaine cartographiee) ou,
 * bien pire, sur la triangulation cellulaire (plusieurs centaines de metres
 * a plusieurs kilometres). Juger une position annoncee a 500 m pres
 * reviendrait a tirer a pile ou face.
 */
const PRECISION_MAX_EXPLOITABLE_M = 250;

const RAYON_TERRE_M = 6371008.8; // rayon moyen (IUGG)

const enRadians = (degres) => (degres * Math.PI) / 180;

/**
 * Distance orthodromique entre deux points, en metres (formule de Haversine).
 *
 * Haversine assimile la Terre a une sphere : l'erreur atteint environ 0,5 %
 * sur de longues distances, soit quelques metres sur 1 km. Sans consequence
 * ici, puisque la tolerance se compte en dizaines de metres et que
 * l'incertitude du GPS lui-meme est d'un ordre de grandeur superieur.
 * Vincenty (ellipsoide) serait plus exact et nettement plus lourd, pour un
 * gain totalement noye dans le bruit de mesure.
 */
function distanceHaversineM(lat1, lon1, lat2, lon2) {
  const dLat = enRadians(lat2 - lat1);
  const dLon = enRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(enRadians(lat1)) * Math.cos(enRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Une coordonnee est-elle exploitable ? */
function coordonneeValide(lat, lon) {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
    // (0, 0) est au large du golfe de Guinee : c'est en pratique toujours une
    // valeur par defaut mal initialisee, jamais une position reelle
    // d'etudiant. La rejeter evite de consigner une distance absurde.
    !(lat === 0 && lon === 0)
  );
}

/**
 * Evalue la coherence de la position d'un scan.
 *
 * DECISION A TROIS ETATS, et non deux. `coherente` peut valoir null, ce qui
 * signifie "indeterminable" et non "hors zone". Trois situations y menent :
 * la seance n'a pas de position de reference, l'etudiant n'a pas partage la
 * sienne, ou la precision annoncee est trop mauvaise pour conclure.
 *
 * La regle de decision utilise `distance - precision` et non `distance`
 * seule : on ne declare une position incoherente que si elle l'est meme en
 * accordant a l'appareil le benefice de toute son incertitude. Comparer la
 * distance brute au rayon signalerait a tort des etudiants reellement
 * presents dont le telephone capte mal -- exactement la population que ce
 * dispositif ne doit pas penaliser.
 *
 * @returns {{ coherente: boolean|null, distanceM: number|null, motif: string }}
 */
function evaluerPosition({ reference, scan, rayonToleranceM }) {
  const rayon = rayonToleranceM ?? RAYON_TOLERANCE_DEFAUT_M;

  if (!reference || !coordonneeValide(reference.latitude, reference.longitude)) {
    return { coherente: null, distanceM: null, motif: 'AUCUNE_REFERENCE' };
  }
  if (!scan || !coordonneeValide(scan.latitude, scan.longitude)) {
    return { coherente: null, distanceM: null, motif: 'POSITION_ABSENTE' };
  }

  const distanceM = Math.round(
    distanceHaversineM(reference.latitude, reference.longitude, scan.latitude, scan.longitude)
  );

  const precision = Number.isFinite(scan.precisionM) ? scan.precisionM : null;

  if (precision !== null && precision > PRECISION_MAX_EXPLOITABLE_M) {
    // La distance est tout de meme retournee : elle sera consignee et pourra
    // etre relue, meme si elle ne permet pas de conclure aujourd'hui.
    return { coherente: null, distanceM, motif: 'PRECISION_INSUFFISANTE' };
  }

  const marge = precision ?? 0;
  if (distanceM - marge > rayon) {
    return { coherente: false, distanceM, motif: 'HORS_ZONE' };
  }
  return { coherente: true, distanceM, motif: 'DANS_ZONE' };
}

module.exports = {
  distanceHaversineM,
  evaluerPosition,
  coordonneeValide,
  RAYON_TOLERANCE_DEFAUT_M,
  PRECISION_MAX_EXPLOITABLE_M,
};
