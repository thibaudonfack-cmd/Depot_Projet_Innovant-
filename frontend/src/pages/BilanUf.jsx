// src/pages/BilanUf.jsx
// Bilan global d'assiduite par unite de formation (Etape 9).
//
// Le rapport de seance repond a "qui etait la ce jour-la ?". Ce bilan repond
// a la question sur laquelle une certification se joue : "cet etudiant
// a-t-il suivi assez d'heures pour valider son UF ?".
//
// La page porte aussi la CLOTURE RGPD, et ce voisinage est voulu : on ne
// detruit des donnees qu'apres avoir consulte ce qu'elles ont produit. Placer
// la purge sur un ecran d'administration separe la ferait declencher sans
// avoir lu le bilan qu'elle rend definitif.

import { useCallback, useEffect, useState } from 'react';
import EnTeteApplication from '../components/EnTeteApplication';
import Modale, { PiedModale } from '../components/Modale';
import {
  Badge, Bouton, Carte, Champ, ChargementEnLigne, EtatVide, Message, Selection,
} from '../components/ui';
import { dateCourte, duree } from '../components/format';
import Jauge from '../components/Jauge';
import { formaterRatio } from '../components/taux';
import { appelerApi } from '../services/api';
import { useRessource } from '../services/useRessource';

/** Chiffre de synthese de l'en-tete. */
function Compteur({ libelle, valeur }) {
  return (
    <div className="rounded-xl border border-sable-300 bg-sable-50 px-4 py-3">
      <p className="text-xs font-medium text-sable-600">{libelle}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-sable-900">{valeur}</p>
    </div>
  );
}

/**
 * Confirmation de cloture.
 *
 * La saisie du mot CLOTURER n'est pas une formalite decorative : elle
 * transforme un clic reflexe en acte delibere. C'est la seule protection
 * possible contre une destruction irreversible declenchee par habitude, sur
 * un bouton place au meme endroit que tous les autres.
 */
function ModaleCloture({ uf, onFermer, onCloture }) {
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const confirme = saisie.trim().toUpperCase() === 'CLOTURER';

  async function cloturer(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      const reponse = await appelerApi(`/api/uf/${uf.id}/cloture-rgpd`, {
        methode: 'POST',
        corps: { confirmation: 'CLOTURER' },
      });
      onCloture(reponse);
    } catch (echec) {
      setErreur(echec.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={cloturer} className="space-y-5" noValidate>
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-900">
          Cette opération est irréversible.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-red-900">
          Les données ci-dessous seront détruites définitivement. Aucune sauvegarde
          applicative ne permet de les restaurer.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-sable-300 p-4">
          <p className="text-xs font-semibold tracking-wide text-red-900 uppercase">
            Détruit
          </p>
          <ul className="mt-2 space-y-1 text-sm text-sable-700">
            <li>Coordonnées GPS des scans</li>
            <li>Distance et précision mesurées</li>
            <li>Verdict de cohérence géographique</li>
            <li>Lien vers les jetons cryptographiques</li>
          </ul>
        </div>
        <div className="rounded-xl border border-sable-300 p-4">
          <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">
            Conservé 5 ans
          </p>
          <ul className="mt-2 space-y-1 text-sm text-sable-700">
            <li>Identité des étudiants</li>
            <li>Heures d&apos;arrivée et de départ</li>
            <li>Nombre de scans par présence</li>
            <li>Journal des modifications</li>
          </ul>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-sable-700">
        Après clôture, plus aucune heure de cette unité de formation ne pourra
        être modifiée, ni par un étudiant, ni par vous.
      </p>

      <Champ
        id="confirmation-cloture"
        libelle="Saisissez CLOTURER pour confirmer"
        aide="La saisie est demandée parce que l'action ne peut pas être annulée."
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        autoComplete="off"
        placeholder="CLOTURER"
      />

      <div aria-live="polite">{erreur && <Message ton="erreur">{erreur}</Message>}</div>

      <PiedModale>
        <Bouton type="button" variante="secondaire" onClick={onFermer} className="sm:w-auto sm:px-5">
          Annuler
        </Bouton>
        <Bouton
          type="submit" chargement={envoi} enfantsChargement="Clôture en cours"
          disabled={!confirme}
          className="bg-red-700 hover:bg-red-800 focus-visible:ring-red-600 disabled:bg-sable-400 sm:w-auto sm:px-5"
        >
          Clôturer et purger
        </Bouton>
      </PiedModale>
    </form>
  );
}

function BilanUf() {
  const [ufId, setUfId] = useState('');
  const [clotureOuverte, setClotureOuverte] = useState(false);
  const [confirmation, setConfirmation] = useState('');

  // `toutes=1` : le bilan doit atteindre une UF déjà clôturée, ce qui est même
  // le cas d'usage principal en fin de semestre.
  const listeRes = useRessource('/api/uf?toutes=1');
  const listeUf = listeRes.donnees?.uf ?? null;

  // Pas d'intervalle : un bilan se lit à un instant donné, et se destine à
  // l'impression. Une ligne qui se réordonne pendant un relevé est une
  // nuisance.
  const bilanRes = useRessource(ufId ? `/api/uf/${ufId}/rapport-global` : null);
  const bilan = bilanRes.donnees;

  // Sélection automatique de la première UF : sans elle, la page s'ouvre sur
  // un écran vide alors qu'un seul choix est possible dans la majorité des cas.
  useEffect(() => {
    if (!ufId && listeUf && listeUf.length > 0) setUfId(listeUf[0].id);
  }, [listeUf, ufId]);

  const surCloture = useCallback((reponse) => {
    setClotureOuverte(false);
    setConfirmation(
      `Unité de formation clôturée. ${reponse.detruit.positions} position(s) `
      + `détruite(s) et ${reponse.detruit.scans_anonymises} scan(s) anonymisé(s). `
      + "L'archive administrative est conservée cinq ans."
    );
    bilanRes.recharger();
    listeRes.recharger();
  }, [bilanRes, listeRes]);

  const cloturee = bilan?.uf?.cloturee_rgpd ?? false;

  return (
    <div className="min-h-dvh bg-sable-100">
      <EnTeteApplication sousTitre="Espace formateur" />

      <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        {/* zone-actions : masquée à l'impression (cf. index.css). */}
        <Carte className="zone-actions">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-64 flex-1">
              <Selection
                id="choix-uf" libelle="Unité de formation"
                value={ufId} onChange={(e) => setUfId(e.target.value)}
              >
                {!listeUf && <option value="">Chargement…</option>}
                {listeUf?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.intitule}{u.cloturee_rgpd ? ' (clôturée)' : ''}
                  </option>
                ))}
              </Selection>
            </div>
            {bilan && (
              <div className="flex flex-wrap gap-2">
                <Bouton variante="secondaire" onClick={() => window.print()}
                        className="w-auto px-3 py-2 text-xs">
                  Imprimer
                </Bouton>
              </div>
            )}
          </div>

          <div aria-live="polite">
            {confirmation && <div className="mt-4"><Message ton="succes">{confirmation}</Message></div>}
          </div>
        </Carte>

        {(listeRes.erreur || bilanRes.erreur) && (
          <Message ton="erreur">{listeRes.erreur || bilanRes.erreur}</Message>
        )}
        {bilanRes.chargement && <Carte><ChargementEnLigne libelle="Calcul du bilan" /></Carte>}

        {bilan && (
          <Carte className="zone-rapport">
            <header className="border-t-4 border-accent-600 pt-5 pb-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[0.12em] text-accent-900 uppercase">
                    Bilan d&apos;assiduité
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-sable-900">
                    {bilan.uf.intitule}
                  </h2>
                  <p className="mt-1 text-sm text-sable-700">
                    {bilan.synthese.seances_terminees} séance(s) terminée(s)
                    {bilan.synthese.premiere_seance && (
                      <> · du {dateCourte(bilan.synthese.premiere_seance)} au{' '}
                        {dateCourte(bilan.synthese.derniere_seance)}</>
                    )}
                  </p>
                </div>
                <Badge ton={cloturee ? 'neutre' : bilan.synthese.provisoire ? 'attention' : 'info'}>
                  {cloturee ? 'Clôturée' : bilan.synthese.provisoire ? 'Provisoire' : 'Complet'}
                </Badge>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Compteur libelle="Inscrits" valeur={bilan.synthese.inscrits} />
                <Compteur libelle="Séances terminées" valeur={bilan.synthese.seances_terminees} />
                <Compteur libelle="Séances totales" valeur={bilan.synthese.seances_total} />
                <Compteur libelle="Heures cumulées"
                          valeur={duree(bilan.synthese.minutes_validees_total)} />
              </div>

              {/* KPI central du bilan : la part du volume horaire suivie.
                  C'est la grandeur sur laquelle une validation d'UF se
                  decide, et elle ne se deduit PAS du nombre de seances. */}
              {bilan.synthese.taux_temps_moyen !== null
                && bilan.synthese.taux_temps_moyen !== undefined && (
                <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-sable-300 bg-white px-4 py-3">
                  <div className="min-w-48 flex-1">
                    <p className="text-xs font-medium text-sable-600">
                      Assiduité moyenne du groupe
                    </p>
                    <div className="mt-1.5">
                      <Jauge pourcentage={bilan.synthese.taux_temps_moyen} />
                    </div>
                  </div>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-sable-600">
                    <div>
                      <dt className="inline">Volume programmé écoulé : </dt>
                      <dd className="inline font-medium text-sable-900">
                        {duree(bilan.synthese.minutes_prevues)}
                      </dd>
                    </div>
                    {bilan.synthese.volume_horaire_minutes && (
                      <div>
                        <dt className="inline">Volume officiel de l&apos;UF : </dt>
                        <dd className="inline font-medium text-sable-900">
                          {duree(bilan.synthese.volume_horaire_minutes)}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </header>

            {cloturee && (
              <div className="mt-5">
                <Message ton="info" titre="Unité de formation clôturée">
                  Les données de localisation et la trace cryptographique ont été
                  détruites le {dateCourte(bilan.uf.date_cloture_rgpd)}. Les heures
                  ci-dessous constituent l&apos;archive administrative et ne peuvent
                  plus être modifiées.
                </Message>
              </div>
            )}

            {!cloturee && bilan.synthese.provisoire && (
              <div className="mt-5">
                <Message ton="info">
                  {bilan.synthese.seances_total - bilan.synthese.seances_terminees} séance(s)
                  ne sont pas encore terminées. Les totaux ci-dessous continueront
                  d&apos;augmenter.
                </Message>
              </div>
            )}

            {bilan.synthese.demandes_en_attente > 0 && (
              <div className="mt-5">
                <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 size-4 shrink-0"
                       fill="none" stroke="currentColor" strokeWidth="2.2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                    <path d="M12 9v4M12 17h.01" />
                  </svg>
                  <div>
                    <p className="font-semibold">Ce bilan est provisoire.</p>
                    <p className="mt-0.5 leading-relaxed">
                      {bilan.synthese.demandes_en_attente} étudiant(s) ont une demande
                      de rectification en attente. Traitez-les avant de valider des
                      crédits ou de clôturer l&apos;unité de formation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {bilan.etudiants.length === 0 ? (
              <div className="mt-5">
                <EtatVide titre="Aucun étudiant inscrit">
                  Cette unité de formation n&apos;a pas encore d&apos;inscrits.
                </EtatVide>
              </div>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Assiduité cumulée de chaque étudiant inscrit à cette unité de formation
                  </caption>
                  <thead>
                    <tr className="border-y-2 border-sable-400 bg-sable-100 text-left text-xs tracking-wide text-sable-700 uppercase">
                      <th scope="col" className="px-3 py-3 font-semibold">Étudiant</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Présences</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Absences</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Heures suivies</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Taux horaire</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sable-200">
                    {bilan.etudiants.map((e) => (
                      <tr key={e.etudiant_id} className="hover:bg-sable-50">
                        <td className="px-3 py-4">
                          <span className="font-medium text-sable-900">{e.nom}</span>
                          <span className="block text-xs text-sable-600">{e.email}</span>
                          {e.demandes_en_attente > 0 && (
                            <span className="mt-1 inline-block">
                              <Badge ton="attention">Contestation en cours</Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-4 tabular-nums text-sable-900">
                          {e.presences} / {e.seances_prevues}
                        </td>
                        <td className="px-3 py-4 tabular-nums text-sable-700">{e.absences}</td>
                        <td className="px-3 py-4 tabular-nums">
                          <span className="font-medium text-sable-900">
                            {formaterRatio(e.minutes_validees, e.minutes_prevues)}
                          </span>
                          {e.departs_deduits > 0 && (
                            <span className="block text-xs text-sable-600">
                              dont {e.departs_deduits} départ(s) automatique(s)
                            </span>
                          )}
                        </td>
                        {/* Le taux HORAIRE est mis en avant : c'est lui qui
                            conditionne la certification. Le taux de presence
                            reste lisible dans la colonne "Présences". */}
                        <td className="w-44 px-3 py-4"><Jauge pourcentage={e.taux_temps} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mention-impression mt-6 hidden border-t border-sable-300 pt-4 text-xs text-sable-600">
              Document établi le {new Date().toLocaleString('fr-BE')} · Prise de présence numérique ·{' '}
              {cloturee
                ? 'Archive administrative, données de localisation purgées.'
                : bilan.synthese.provisoire
                  ? 'PROVISOIRE : des séances ne sont pas terminées.'
                  : 'Bilan complet.'}
            </p>
          </Carte>
        )}

        {/* --------------------------------------------------------------
            Zone de clôture, deliberement SEPAREE et en bas de page.
            Une action irreversible ne se place pas a cote des actions
            courantes : la distance physique fait partie de la protection.
            -------------------------------------------------------------- */}
        {bilan && !cloturee && (
          <Carte className="zone-actions border-red-200">
            <h2 className="text-sm font-semibold text-sable-900">
              Clôture et minimisation des données
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sable-700">
              En fin de semestre, les données de localisation et la trace
              cryptographique des scans n&apos;ont plus d&apos;utilité : elles ont
              servi à établir les présences, ce qui est fait. Les conserver
              constituerait un historique de déplacements sans finalité. La clôture
              les détruit et fige les heures, qui deviennent l&apos;archive
              administrative conservée cinq ans.
            </p>
            <div className="mt-4">
              <Bouton
                onClick={() => setClotureOuverte(true)}
                className="bg-red-700 hover:bg-red-800 focus-visible:ring-red-600 sm:w-auto sm:px-5"
              >
                Clôturer l&apos;UF et purger les métadonnées (RGPD)
              </Bouton>
            </div>
          </Carte>
        )}
      </main>

      <Modale
        ouverte={clotureOuverte}
        titre="Clôturer l'unité de formation"
        description={bilan ? bilan.uf.intitule : ''}
        onFermer={() => setClotureOuverte(false)}
      >
        {bilan && (
          <ModaleCloture uf={bilan.uf} onFermer={() => setClotureOuverte(false)}
                         onCloture={surCloture} />
        )}
      </Modale>
    </div>
  );
}

export default BilanUf;
