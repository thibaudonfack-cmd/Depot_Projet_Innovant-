// src/services/exportCsv.js
// Construction et telechargement du rapport d'assiduite au format CSV.
//
// Fonctions PURES separees du composant, pour deux raisons : elles se testent
// unitairement sans monter d'interface, et la logique d'echappement d'un CSV
// est precisement le genre de detail qui casse silencieusement quand il est
// noye dans un composant.

/** Separateur point-virgule : Excel en configuration francophone l'attend. */
const SEPARATEUR = ';';

/**
 * Marque d'ordre des octets UTF-8.
 *
 * Sans elle, Excel sous Windows interprete un CSV comme du Windows-1252 :
 * "Prenom" s'affiche correctement, mais "Amara Diallo" devient "Amara Diallo"
 * des qu'un accent apparait, et un nom comme "Chiara Rossi" passe encore
 * alors que "Frederic Muller" ne passe plus. Le fichier parait alors corrompu
 * alors qu'il est parfaitement valide -- c'est Excel qui devine mal. Ces trois
 * octets lui indiquent explicitement l'encodage.
 *
 * LibreOffice et les tableurs en ligne s'en passent, mais leur presence ne
 * les gene pas : le compromis est donc sans contrepartie.
 */
const BOM_UTF8 = '﻿';

/**
 * Echappe une valeur pour le format CSV (RFC 4180).
 *
 * Une valeur doit etre entouree de guillemets des qu'elle contient le
 * separateur, un guillemet ou un saut de ligne -- sinon elle deborderait sur
 * la colonne suivante. Les guillemets internes se doublent. Un motif de
 * rectification saisi librement par un etudiant peut parfaitement contenir un
 * point-virgule ou un retour a la ligne : sans echappement, une seule
 * apostrophe mal placee decalerait toute la ligne du rapport.
 */
export function echapperCsv(valeur) {
  if (valeur === null || valeur === undefined) return '';
  const texte = String(valeur);
  if (texte.includes(SEPARATEUR) || texte.includes('"') || /[\r\n]/.test(texte)) {
    return `"${texte.replace(/"/g, '""')}"`;
  }
  return texte;
}

/** Formate une durée en minutes vers "2h05", ou une chaîne vide. */
export function formaterDureeCsv(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

/** Formate un instant vers "01/09/2026 09:05", ou une chaîne vide. */
export function formaterInstantCsv(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const COLONNES = [
  'Nom', 'Email', 'Statut', 'Arrivee', 'Depart', 'Depart deduit',
  'Temps valide', 'Minutes validees', 'Position', 'Contestation',
];

/**
 * Construit le contenu CSV complet a partir de la reponse du rapport.
 *
 * Les fins de ligne sont en CRLF, conformement a la RFC 4180 et a ce
 * qu'attendent les outils Windows.
 */
export function construireCsv(rapport) {
  const lignes = [COLONNES.join(SEPARATEUR)];

  for (const etudiant of rapport.etudiants) {
    lignes.push([
      etudiant.nom,
      etudiant.email,
      etudiant.present ? 'Present' : 'Absent',
      formaterInstantCsv(etudiant.heure_arrivee),
      // L'API calcule `heure_fin_retenue` a partir de la seance, elle est donc
      // renseignee MEME pour un absent. L'ecrire telle quelle donnerait a un
      // etudiant jamais venu une heure de depart -- relue en aval comme une
      // presence. La colonne reste donc vide en l'absence de presence.
      etudiant.present ? formaterInstantCsv(etudiant.heure_fin_retenue) : '',
      // Explicite dans l'export, comme a l'ecran : une heure deduite ne doit
      // jamais etre lue comme une heure relevee, surtout dans un document qui
      // servira a valider des credits.
      etudiant.depart_deduit ? 'Oui' : 'Non',
      formaterDureeCsv(etudiant.minutes_validees),
      etudiant.minutes_validees ?? '',
      etudiant.position_coherente === false ? 'Incertaine'
        : etudiant.position_coherente === true ? 'Confirmee' : 'Non mesuree',
      etudiant.demande_en_attente ? 'En attente' : '',
    ].map(echapperCsv).join(SEPARATEUR));
  }

  // Ligne de synthese, separee par une ligne vide : elle facilite la
  // relecture humaine sans gener l'import automatique, la plupart des outils
  // ignorant les lignes vides.
  const s = rapport.synthese;
  lignes.push('');
  lignes.push([`Attendus${SEPARATEUR}${s.attendus}`]);
  lignes.push([`Presents${SEPARATEUR}${s.presents}`]);
  lignes.push([`Absents${SEPARATEUR}${s.absents}`]);
  lignes.push([`Total valide${SEPARATEUR}${echapperCsv(formaterDureeCsv(s.minutes_validees_total))}`]);
  lignes.push([`Statut${SEPARATEUR}${s.provisoire || s.demandes_en_attente > 0 ? 'PROVISOIRE' : 'OFFICIEL'}`]);

  return BOM_UTF8 + lignes.join('\r\n');
}

/**
 * Determine le nom du fichier.
 *
 * Le caractere provisoire figure dans le NOM et pas seulement dans le
 * contenu : un fichier telecharge est renomme, transfere, imprime, et finit
 * souvent detache de son contexte. Un secretariat qui recoit
 * "rapport-PROVISOIRE-....csv" par courriel sait immediatement qu'il ne doit
 * pas valider de credits sur cette base, meme sans l'ouvrir.
 */
export function nommerFichier(rapport) {
  const s = rapport.synthese;
  const provisoire = s.provisoire || s.demandes_en_attente > 0;
  const uf = (rapport.seance.uf_intitule || 'seance')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  const reference = rapport.seance.heure_debut_prevue || rapport.seance.date_ouverture;
  const date = reference ? new Date(reference).toISOString().slice(0, 10) : 'sans-date';

  return `assiduite-${provisoire ? 'PROVISOIRE' : 'OFFICIEL'}-${uf}-${date}.csv`;
}

/** Declenche le telechargement dans le navigateur. */
export function telechargerCsv(rapport) {
  const contenu = construireCsv(rapport);
  // type text/csv;charset=utf-8 en plus du BOM : ceinture et bretelles, les
  // deux mecanismes visant des consommateurs differents.
  const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nommerFichier(rapport);
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);

  // Liberation de l'URL objet : sans elle, le blob reste en memoire jusqu'au
  // rechargement de la page. Un formateur exportant plusieurs rapports d'affilee
  // accumulerait autant de copies.
  URL.revokeObjectURL(url);
}
