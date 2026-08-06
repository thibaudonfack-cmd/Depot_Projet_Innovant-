// src/pages/RapportSeance.jsx
// Rapport d'assiduite d'une seance (Etape 8, volet interface).
//
// Ce n'est pas un tableau de plus : c'est le document sur lequel le
// secretariat validera des credits de formation. Trois consequences guident
// la conception.
//
//  1. TOUS LES INSCRITS figurent, pas seulement les presents. L'API part des
//     inscriptions ; l'interface se garde de refiltrer, sans quoi le travail
//     du backend serait annule a l'affichage.
//  2. AUCUNE VALEUR DEDUITE N'EST PRESENTEE COMME CONSTATEE. Un depart non
//     pointe, remplace par l'heure de fin prevue, porte une marque visible.
//  3. LE CARACTERE PROVISOIRE EST AFFICHE AVANT LE TABLEAU, pas apres. Une
//     mention placee en pied serait lue apres la decision qu'elle devait
//     empecher.
//
// VUE DEDIEE plutot que modale : une modale <dialog> s'imprime mal (le
// navigateur imprime la page sous-jacente, ou seule la boite selon le moteur),
// et un rapport destine a etre imprime ne peut pas dependre de ce
// comportement. Voir la feuille @media print dans index.css.

import { useMemo } from 'react';
import { Badge, Bouton, Carte, ChargementEnLigne, Message } from '../components/ui';
import { dateCourte, duree, heure } from '../components/format';
import { useRessource } from '../services/useRessource';
import { telechargerCsv, nommerFichier } from '../services/exportCsv';

/**
 * Cellule "Depart" d'une ligne.
 *
 * Une heure deduite reste une heure AFFICHEE -- la masquer priverait le
 * formateur de l'information dont il a besoin -- mais elle est visuellement
 * distincte : mention "déduit" et infobulle explicative. La distinction ne
 * repose pas sur la seule couleur (WCAG 1.4.1) : le mot est ecrit.
 */
function CelluleDepart({ etudiant }) {
  if (!etudiant.present) return <span className="text-sable-500">—</span>;

  if (!etudiant.depart_deduit) {
    return <span className="text-sable-900">{heure(etudiant.heure_depart_saisie)}</span>;
  }

  return (
    <span
      className="inline-flex flex-wrap items-baseline gap-x-1.5"
      title="Départ automatique : l'heure de fin prévue a été appliquée par défaut, faute d'un second scan à la sortie."
    >
      <span className="text-sable-900">{heure(etudiant.heure_fin_retenue)}</span>
      <span className="text-xs font-medium text-sable-600">déduit</span>
    </span>
  );
}

/** Statut administratif. Trois etats mutuellement exclusifs, dans cet ordre. */
function StatutEtudiant({ etudiant }) {
  // La contestation PRIME sur le reste : c'est le seul etat qui doit
  // interrompre une validation, et le montrer en second le rendrait
  // secondaire.
  if (etudiant.demande_en_attente) return <Badge ton="attention">Contestation en cours</Badge>;
  if (!etudiant.present) return <Badge ton="neutre">Absent</Badge>;
  // Present ET non inscrit : le fait est reel, le cadre administratif ne
  // l'est pas. Le dire plutot que de le ranger parmi les presences validees.
  if (!etudiant.inscrit) return <Badge ton="attention">Présent (non inscrit)</Badge>;
  return <Badge ton="actif">Présent (validé)</Badge>;
}

/** Un chiffre de synthese, dans l'en-tete officiel. */
function Compteur({ libelle, valeur, accent = false }) {
  return (
    <div className="rounded-xl border border-sable-300 bg-sable-50 px-4 py-3">
      <p className="text-xs font-medium text-sable-600">{libelle}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${accent ? 'text-accent-900' : 'text-sable-900'}`}>
        {valeur}
      </p>
    </div>
  );
}

function RapportSeance({ seanceId, onRetour }) {
  // Pas d'intervalle : un rapport se lit a un instant donne. Un tableau qui se
  // reordonne pendant qu'on le releve, ou pendant une impression, serait une
  // nuisance -- et le bouton de rechargement reste disponible.
  const { donnees, chargement, erreur, recharger } = useRessource(
    `/api/seances/${seanceId}/rapport`
  );

  const provisoire = donnees
    ? donnees.synthese.provisoire || donnees.synthese.demandes_en_attente > 0
    : false;

  const nomFichier = useMemo(() => (donnees ? nommerFichier(donnees) : ''), [donnees]);

  return (
    <div className="space-y-4">
      {/* zone-actions : masquee a l'impression (cf. index.css). */}
      <div className="zone-actions flex flex-wrap items-center justify-between gap-3">
        <Bouton variante="secondaire" onClick={onRetour} className="w-auto px-3 py-2 text-xs">
          Retour à la séance
        </Bouton>

        {donnees && (
          <div className="flex flex-wrap gap-2">
            <Bouton
              variante="secondaire"
              onClick={() => window.print()}
              className="w-auto px-3 py-2 text-xs"
            >
              Imprimer
            </Bouton>
            <Bouton
              onClick={() => telechargerCsv(donnees)}
              className="w-auto px-3 py-2 text-xs"
              title={`Fichier : ${nomFichier}`}
            >
              Exporter en CSV
            </Bouton>
          </div>
        )}
      </div>

      {erreur && <Message ton="erreur">{erreur}</Message>}
      {chargement && <Carte><ChargementEnLigne libelle="Préparation du rapport" /></Carte>}

      {donnees && (
        <Carte className="zone-rapport">
          {/* ---------------------------------------------------------------
              En-tete officiel. Sur un document imprime detache de l'ecran,
              ces informations sont les seules permettant de savoir de quelle
              seance il s'agit.
              --------------------------------------------------------------- */}
          <header className="border-b border-sable-300 pb-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium tracking-wide text-sable-600 uppercase">
                  Rapport d&apos;assiduité
                </p>
                <h2 className="mt-1 text-lg font-semibold text-sable-900">
                  {donnees.seance.uf_intitule}
                </h2>
                <p className="mt-1 text-sm text-sable-700">
                  {donnees.seance.salle_nom} · {dateCourte(donnees.seance.heure_debut_prevue ?? donnees.seance.date_ouverture)}
                  {donnees.seance.heure_debut_prevue && (
                    <> · {heure(donnees.seance.heure_debut_prevue)} – {heure(donnees.seance.heure_fin_prevue)}</>
                  )}
                </p>
              </div>
              <Badge ton={provisoire ? 'attention' : 'info'}>
                {provisoire ? 'Provisoire' : 'Officiel'}
              </Badge>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Compteur libelle="Attendus" valeur={donnees.synthese.attendus} />
              <Compteur libelle="Présents" valeur={donnees.synthese.presents} accent />
              <Compteur libelle="Absents" valeur={donnees.synthese.absents} />
              <Compteur libelle="Temps validé" valeur={duree(donnees.synthese.minutes_validees_total)} />
            </div>
          </header>

          {/* ---------------------------------------------------------------
              Banniere de conformite. Placee AVANT le tableau : elle doit etre
              lue avant les chiffres qu'elle relativise.
              --------------------------------------------------------------- */}
          {donnees.synthese.demandes_en_attente > 0 && (
            <div className="mt-5">
              <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 size-4 shrink-0"
                     fill="none" stroke="currentColor" strokeWidth="2.2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
                <div>
                  <p className="font-semibold">Ce rapport est provisoire.</p>
                  <p className="mt-0.5 leading-relaxed">
                    {donnees.synthese.demandes_en_attente === 1
                      ? 'Une demande de rectification est en attente'
                      : `${donnees.synthese.demandes_en_attente} demandes de rectification sont en attente`}
                    . Les temps concernés peuvent encore être modifiés : ne validez
                    pas de crédits sur cette base.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Seance non terminee : provisoire pour une autre raison, moins
              grave, donc signalee plus discretement. Confondre les deux
              banaliserait l'avertissement precedent. */}
          {donnees.synthese.provisoire && donnees.synthese.demandes_en_attente === 0 && (
            <div className="mt-5">
              <Message ton="info">
                La séance n&apos;est pas terminée. Les temps affichés continueront
                d&apos;évoluer jusqu&apos;à son terme.
              </Message>
            </div>
          )}

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Assiduité de tous les étudiants inscrits à cette unité de formation
              </caption>
              <thead>
                <tr className="border-b border-sable-300 text-left text-xs text-sable-600">
                  <th scope="col" className="pb-2 font-medium">Étudiant</th>
                  <th scope="col" className="pb-2 font-medium">Statut</th>
                  <th scope="col" className="pb-2 font-medium">Arrivée</th>
                  <th scope="col" className="pb-2 font-medium">Départ</th>
                  <th scope="col" className="pb-2 font-medium">Temps validé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sable-200">
                {donnees.etudiants.map((etudiant) => (
                  <tr key={etudiant.etudiant_id} className={etudiant.present ? '' : 'bg-sable-50'}>
                    <td className="py-3 pr-3">
                      <span className="font-medium text-sable-900">{etudiant.nom}</span>
                      <span className="block text-xs text-sable-600">{etudiant.email}</span>
                    </td>
                    <td className="py-3 pr-3"><StatutEtudiant etudiant={etudiant} /></td>
                    <td className="py-3 pr-3 text-sable-700">
                      {etudiant.present ? heure(etudiant.heure_arrivee) : <span className="text-sable-500">—</span>}
                    </td>
                    <td className="py-3 pr-3"><CelluleDepart etudiant={etudiant} /></td>
                    <td className="py-3 tabular-nums">
                      {etudiant.minutes_validees === null || etudiant.minutes_validees === undefined
                        ? <span className="text-sable-500">—</span>
                        : <span className="font-medium text-sable-900">{duree(etudiant.minutes_validees)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {donnees.etudiants.some((e) => e.depart_deduit) && (
            <p className="mt-4 text-xs leading-relaxed text-sable-600">
              <span className="font-medium">Départ automatique</span> :
              l&apos;heure de fin prévue a été appliquée par défaut, ce qui
              correspond à une présence jusqu&apos;au terme de la séance. Pour un
              suivi du temps exact, les étudiants scannent le QR code une
              seconde fois en quittant la salle. Corrigez la présence si la
              valeur retenue ne correspond pas.
            </p>
          )}

          {/* Un présent non inscrit sort du cadre administratif prévu : il ne
              doit ni être masqué, ni être compté parmi les attendus. */}
          {donnees.synthese.presents_non_inscrits > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-sable-600">
              <span className="font-medium">Non inscrit</span> :{' '}
              {donnees.synthese.presents_non_inscrits === 1
                ? 'un étudiant a scanné sans être inscrit'
                : `${donnees.synthese.presents_non_inscrits} étudiants ont scanné sans être inscrits`}
              {' '}à cette unité de formation. Leur présence est réelle et
              conservée, mais elle ne compte pas dans l&apos;effectif attendu.
              Vérifiez l&apos;inscription auprès du secrétariat.
            </p>
          )}

          {/* Pied de document, visible uniquement a l'impression : sur papier,
              rien n'indiquerait autrement d'ou vient la feuille ni quand elle
              a ete etablie. */}
          <p className="mention-impression mt-6 hidden border-t border-sable-300 pt-4 text-xs text-sable-600">
            Document établi le {new Date().toLocaleString('fr-BE')} · Prise de présence numérique ·{' '}
            {provisoire ? 'PROVISOIRE — ne peut servir de base à une validation de crédits.' : 'Rapport officiel.'}
          </p>
        </Carte>
      )}

      {!chargement && !donnees && erreur && (
        <Bouton variante="secondaire" onClick={recharger} className="w-auto px-3 py-2 text-xs">
          Réessayer
        </Bouton>
      )}
    </div>
  );
}

export default RapportSeance;
