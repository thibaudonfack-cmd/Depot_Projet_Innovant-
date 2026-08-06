// src/pages/DetailSeance.jsx
// Vue formateur d'une seance : presences, modification manuelle des heures,
// et traitement des demandes de rectification.
//
// REGLE TRANSVERSALE : toute action modifiant une presence exige un MOTIF,
// verrouille cote interface comme cote serveur. Ce motif est consigne dans le
// journal d'audit, conserve cinq ans. Une modification sans justification
// n'est pas defendable devant une inspection : l'interface ne doit donc meme
// pas permettre de la tenter.

import { useCallback, useState } from 'react';
import Modale, { PiedModale, ZoneTexte } from '../components/Modale';
import {
  Badge, Bouton, Carte, Champ, ChargementEnLigne, EtatVide, Message,
} from '../components/ui';
import { duree, heure } from '../components/format';
import { appelerApi } from '../services/api';
import { useRessource } from '../services/useRessource';
import { useSeanceTerminee } from '../services/useSeanceTerminee';
import RapportSeance from './RapportSeance';

function versChampLocal(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Indicateur de coherence geographique.
 *
 * TROIS etats, comme en base. `null` (indeterminable) n'affiche RIEN plutot
 * qu'un signe neutre : marquer chaque etudiant sans position mesurable
 * saturerait le tableau de symboles sans information, et diluerait le seul
 * cas qui merite l'attention du formateur.
 */
function IndicateurPosition({ presence }) {
  if (presence.position_coherente === null || presence.position_coherente === undefined) {
    return null;
  }
  if (presence.position_coherente) {
    return (
      <span title={`Position confirmée à ${presence.distance_m} m du point de référence`}
            className="inline-flex items-center gap-1 text-xs text-emerald-800">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5"
             fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span className="sr-only">Position confirmée</span>
      </span>
    );
  }
  return (
    <span
      title={`Scan effectué à environ ${presence.distance_m} m du point de référence`
             + (presence.precision_m ? ` (précision annoncée : ${presence.precision_m} m)` : '')}
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5"
           fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      Position incertaine
    </span>
  );
}

/**
 * Cellule "Depart" du tableau des presences.
 *
 * Le defaut corrige ici : tant que la seance etait en cours, afficher un tiret
 * pour un depart non pointe etait juste. Une fois la seance terminee, ce meme
 * tiret devenait faux -- le serveur retient alors l'heure de fin prevue pour
 * calculer le temps, et l'interface montrait donc autre chose que ce qui etait
 * compte. Un formateur pouvait en conclure que l'etudiant n'avait pas de temps
 * valide, alors qu'il en avait un.
 *
 * L'heure deduite est donc affichee, mais JAMAIS confondue avec une heure
 * relevee : la mention "déduit" l'accompagne, doublee d'une infobulle. La
 * distinction ne repose pas sur la couleur seule (WCAG 1.4.1).
 */
function CelluleDepart({ presence, seanceTerminee, heureFinPrevue }) {
  if (presence.heure_depart) {
    return <span className="text-sable-700">{heure(presence.heure_depart)}</span>;
  }

  // Sans heure de fin prevue, le serveur ne deduit rien non plus : le tiret
  // reste alors la representation honnete.
  if (!seanceTerminee || !heureFinPrevue) return <span className="text-sable-500">—</span>;

  return (
    <span
      className="inline-flex flex-wrap items-baseline gap-x-1.5"
      title="Départ automatique : l'heure de fin prévue a été appliquée par défaut. Pour un temps exact, l'étudiant scanne le QR code une seconde fois en quittant la salle."
    >
      <span className="text-sable-700">{heure(heureFinPrevue)}</span>
      <span className="text-xs font-medium text-sable-600">déduit</span>
    </span>
  );
}

/**
 * Cellule "Duree".
 *
 * `duree_minutes` ne vaut que pour un depart reellement pointe ;
 * `duree_validee_minutes` est celle que retient l'administration. Les deux
 * coincident des qu'un depart existe, et seule la seconde a un sens une fois
 * la seance terminee sans pointage de sortie.
 */
function CelluleDuree({ presence, seanceTerminee }) {
  if (presence.heure_depart) {
    return <span className="text-sable-900">{duree(presence.duree_minutes)}</span>;
  }

  if (seanceTerminee) {
    // Badge NEUTRE et non vert : la seance appartient au passe, un indicateur
    // d'activite y serait trompeur. C'est le "En cours" eternel signale.
    return presence.duree_validee_minutes === null || presence.duree_validee_minutes === undefined
      ? <Badge ton="neutre">Terminé</Badge>
      : (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="text-sable-900">{duree(presence.duree_validee_minutes)}</span>
          <Badge ton="neutre">Terminé</Badge>
        </span>
      );
  }

  return <Badge ton="actif">En cours</Badge>;
}

/** Champ de motif, partage par les deux actions tracees. */
function ChampMotif({ valeur, onChange, id = 'motif-action' }) {
  return (
    <ZoneTexte
      id={id} libelle="Motif" obligatoire required
      aide="Consigné dans le journal d'audit et conservé cinq ans. Il justifiera la modification en cas d'inspection."
      value={valeur} onChange={(e) => onChange(e.target.value)}
      placeholder="Exemple : départ anticipé signalé oralement, rendez-vous médical."
    />
  );
}

function ModaleModificationHoraire({ presence, onFermer, onEnregistre }) {
  const [depart, setDepart] = useState(versChampLocal(presence?.heure_depart));
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const incoherent = Boolean(depart && presence && depart <= versChampLocal(presence.heure_arrivee));

  async function enregistrer(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await appelerApi(`/api/presences/${presence.id}`, {
        methode: 'PUT',
        corps: {
          heure_depart: depart ? new Date(depart).toISOString() : null,
          motif: motif.trim(),
        },
      });
      onEnregistre();
    } catch (echec) {
      setErreur(echec.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={enregistrer} className="space-y-6" noValidate>
      <Champ id="nouveau-depart" libelle="Heure de départ" type="datetime-local"
             value={depart} onChange={(e) => setDepart(e.target.value)} erreur={incoherent} />

      <ChampMotif valeur={motif} onChange={setMotif} />

      <div aria-live="polite" className="space-y-3">
        {incoherent && <Message ton="erreur">Le départ doit être postérieur à l&apos;arrivée.</Message>}
        {erreur && <Message ton="erreur">{erreur}</Message>}
      </div>

      <PiedModale>
        <Bouton type="button" variante="secondaire" onClick={onFermer} className="sm:w-auto sm:px-5">
          Annuler
        </Bouton>
        <Bouton type="submit" chargement={envoi} enfantsChargement="Enregistrement"
                disabled={!motif.trim() || incoherent} className="sm:w-auto sm:px-5">
          Enregistrer
        </Bouton>
      </PiedModale>
    </form>
  );
}

function ModaleDecision({ demande, decision, onFermer, onTraite }) {
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const accepte = decision === 'acceptee';

  async function trancher(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await appelerApi(`/api/rectifications/${demande.id}`, {
        methode: 'PATCH',
        corps: { decision, motif_decision: motif.trim() },
      });
      onTraite();
    } catch (echec) {
      setErreur(echec.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={trancher} className="space-y-6" noValidate>
      <div className="rounded-xl border border-sable-300 bg-sable-100 p-4">
        <p className="text-xs font-medium text-sable-600">Demande de {demande?.etudiant_nom}</p>
        <p className="mt-1 text-sm leading-relaxed text-sable-900">{demande?.motif}</p>
        {(demande?.heure_arrivee_demandee || demande?.heure_depart_demandee) && (
          <p className="mt-2 text-xs text-sable-600">
            Heures demandées : {heure(demande.heure_arrivee_demandee ?? demande.heure_arrivee)} à{' '}
            {heure(demande.heure_depart_demandee ?? demande.heure_depart)}
          </p>
        )}
      </div>

      {/* Motif exige AUSSI pour un refus : c'est ce que l'etudiant pourra
          contester, et ce qu'une inspection lira. */}
      <ChampMotif valeur={motif} onChange={setMotif} id="motif-decision" />

      <div aria-live="polite">{erreur && <Message ton="erreur">{erreur}</Message>}</div>

      <PiedModale>
        <Bouton type="button" variante="secondaire" onClick={onFermer} className="sm:w-auto sm:px-5">
          Annuler
        </Bouton>
        <Bouton type="submit" chargement={envoi} enfantsChargement="Enregistrement"
                disabled={!motif.trim()} className="sm:w-auto sm:px-5">
          {accepte ? 'Accepter la demande' : 'Refuser la demande'}
        </Bouton>
      </PiedModale>
    </form>
  );
}

/** Cadence d'actualisation de la vue seance, en millisecondes. */
const INTERVALLE_ACTUALISATION_MS = 5000;

function DetailSeance({ seanceId, onRetour }) {
  const [rapportOuvert, setRapportOuvert] = useState(false);
  const [presenceModifiee, setPresenceModifiee] = useState(null);
  const [demandeTraitee, setDemandeTraitee] = useState(null);
  const [decision, setDecision] = useState(null);
  const [confirmation, setConfirmation] = useState('');

  // Une modale ouverte suspend l'actualisation : voir la liste se reordonner
  // sous une boite de dialogue en cours de saisie est desagreable, et le
  // formulaire pourrait porter sur une ligne qui vient de changer.
  const modaleOuverte = Boolean(presenceModifiee || demandeTraitee);

  // L'actualisation est aussi suspendue pendant la lecture du rapport : la vue
  // n'est plus a l'ecran, la solliciter ne servirait qu'a consommer du reseau.
  const presencesRes = useRessource(`/api/seances/${seanceId}/presences`, {
    intervalleMs: INTERVALLE_ACTUALISATION_MS, suspendu: modaleOuverte || rapportOuvert,
  });
  const rectificationsRes = useRessource(`/api/seances/${seanceId}/rectifications`, {
    intervalleMs: INTERVALLE_ACTUALISATION_MS, suspendu: modaleOuverte || rapportOuvert,
  });

  const donnees = presencesRes.donnees;
  const rectifications = rectificationsRes.donnees?.rectifications ?? null;
  const erreur = presencesRes.erreur || rectificationsRes.erreur;

  const rafraichir = useCallback((texte) => {
    setPresenceModifiee(null);
    setDemandeTraitee(null);
    setConfirmation(texte);
    // Rechargement immediat plutot qu'attendre le prochain tour : apres une
    // action explicite, l'utilisateur doit voir le resultat sans delai.
    presencesRes.recharger();
    rectificationsRes.recharger();
  }, [presencesRes, rectificationsRes]);

  // Meme regle asymetrique qu'ailleurs : le serveur d'abord, l'horloge locale
  // seulement s'il n'a pas encore bascule.
  const seanceTerminee = useSeanceTerminee(
    donnees?.seance?.terminee ?? false,
    donnees?.seance?.heure_fin_prevue ?? null
  );

  const enAttente = rectifications?.filter((r) => r.statut === 'en_attente') ?? [];
  const traitees = rectifications?.filter((r) => r.statut !== 'en_attente') ?? [];

  if (rapportOuvert) {
    return <RapportSeance seanceId={seanceId} onRetour={() => setRapportOuvert(false)} />;
  }

  return (
    <div className="space-y-4">
      <Carte>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-sable-900">Présences</h2>
              {donnees && (
                <Badge ton={seanceTerminee ? 'neutre' : 'actif'}>
                  {seanceTerminee ? 'Séance terminée' : 'Séance en cours'}
                </Badge>
              )}
            </div>
            {donnees && (
              <p className="mt-1 text-sm text-sable-600">
                {donnees.seance.uf_intitule} · {donnees.seance.salle_nom}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* Mention retiree une fois la seance terminee : plus rien ne
                bouge, l'annoncer serait faux. */}
            {!seanceTerminee && (
              <span className="hidden items-center gap-1.5 text-xs text-sable-600 sm:flex">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-600" />
                Actualisation automatique
              </span>
            )}
            <Bouton variante="secondaire" onClick={onRetour} className="w-auto px-3 py-2 text-xs">
              Retour
            </Bouton>
          </div>
        </div>

        {/* Action principale du rapport : proposee UNIQUEMENT sur une seance
            terminee. Sur une seance en cours, le document serait par
            construction incomplet, et l'offrir inviterait a valider des
            credits sur des chiffres encore mouvants. */}
        {donnees && seanceTerminee && (
          <div className="mt-4">
            <Bouton onClick={() => setRapportOuvert(true)} className="sm:w-auto sm:px-5">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0"
                   fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M8 13h8M8 17h5" />
              </svg>
              Voir le rapport d&apos;assiduité
            </Bouton>
          </div>
        )}

        <div aria-live="polite">
          {confirmation && <div className="mt-4"><Message ton="succes">{confirmation}</Message></div>}
        </div>

        {erreur && <div className="mt-4"><Message ton="erreur">{erreur}</Message></div>}
        {presencesRes.chargement && <ChargementEnLigne libelle="Chargement des présences" />}

        {donnees && donnees.presences.length === 0 && (
          <div className="mt-5">
            <EtatVide titre="Aucune présence enregistrée">
              Les étudiants apparaîtront ici dès qu&apos;ils auront scanné le QR code.
            </EtatVide>
          </div>
        )}

        {donnees && donnees.presences.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Présences enregistrées pour cette séance</caption>
              <thead>
                <tr className="border-b border-sable-300 text-left text-xs text-sable-600">
                  <th scope="col" className="pb-2 font-medium">Étudiant</th>
                  <th scope="col" className="pb-2 font-medium">Arrivée</th>
                  <th scope="col" className="pb-2 font-medium">Départ</th>
                  <th scope="col" className="pb-2 font-medium">Durée</th>
                  <th scope="col" className="pb-2 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sable-200">
                {donnees.presences.map((p) => (
                  <tr key={p.id}>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sable-900">{p.etudiant_nom}</span>
                        <IndicateurPosition presence={p} />
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-sable-700">{heure(p.heure_arrivee)}</td>
                    <td className="py-3 pr-3">
                      <CelluleDepart presence={p} seanceTerminee={seanceTerminee}
                                     heureFinPrevue={donnees.seance.heure_fin_prevue} />
                    </td>
                    <td className="py-3 pr-3">
                      <CelluleDuree presence={p} seanceTerminee={seanceTerminee} />
                    </td>
                    <td className="py-3 text-right">
                      <Bouton variante="secondaire" onClick={() => setPresenceModifiee(p)}
                              className="w-auto px-3 py-1.5 text-xs">
                        Modifier
                      </Bouton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Formulation PROCEDURALE et non accusatrice : un départ déduit est
            le fonctionnement normal, pas une faute. Le texte décrit ce qu'il
            faut faire pour obtenir mieux, plutôt que de constater ce qui n'a
            pas été fait. */}
        {donnees && seanceTerminee
          && donnees.presences.some((p) => !p.heure_depart) && donnees.seance.heure_fin_prevue && (
          <p className="mt-4 text-xs leading-relaxed text-sable-600">
            <span className="font-medium">Départ automatique</span> :
            l&apos;heure de fin prévue a été appliquée par défaut. Pour un suivi
            du temps exact — départ anticipé, par exemple — les étudiants
            scannent le QR code une seconde fois en quittant la salle. Vous
            pouvez aussi corriger une présence manuellement.
          </p>
        )}
        {donnees && donnees.presences.some((p) => p.position_coherente === 0) && (
          <p className="mt-4 text-xs leading-relaxed text-sable-600">
            <span className="font-medium">Position incertaine</span> signale un
            scan effectué loin du point de référence de la séance. Ce n&apos;est
            pas une preuve d&apos;absence : le GPS est imprécis en intérieur, et
            la position est déclarée par l&apos;appareil. Survolez le badge pour
            connaître la distance mesurée.
          </p>
        )}
      </Carte>

      <Carte>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-sable-900">Demandes de rectification</h2>
          {enAttente.length > 0 && <Badge ton="attention">{enAttente.length} en attente</Badge>}
        </div>

        {rectificationsRes.chargement && <ChargementEnLigne libelle="Chargement des demandes" />}

        {rectifications && rectifications.length === 0 && (
          <div className="mt-5">
            <EtatVide titre="Aucune demande">
              Les signalements de vos étudiants apparaîtront ici.
            </EtatVide>
          </div>
        )}

        {enAttente.length > 0 && (
          <ul className="mt-5 space-y-4">
            {enAttente.map((r) => (
              <li key={r.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-sable-900">{r.etudiant_nom}</p>
                    <p className="mt-1 text-sm text-sable-700">{r.motif}</p>
                    {(r.heure_arrivee_demandee || r.heure_depart_demandee) && (
                      <p className="mt-1 text-xs text-sable-600">
                        Demande : {heure(r.heure_arrivee_demandee ?? r.heure_arrivee)} à{' '}
                        {heure(r.heure_depart_demandee ?? r.heure_depart)}
                        {' · '}actuellement {heure(r.heure_arrivee)} à {heure(r.heure_depart)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Bouton variante="secondaire"
                            onClick={() => { setDemandeTraitee(r); setDecision('refusee'); }}
                            className="w-auto px-3 py-2 text-xs">
                      Refuser
                    </Bouton>
                    <Bouton onClick={() => { setDemandeTraitee(r); setDecision('acceptee'); }}
                            className="w-auto px-3 py-2 text-xs">
                      Accepter
                    </Bouton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {traitees.length > 0 && (
          <ul className="mt-5 divide-y divide-sable-200">
            {traitees.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm text-sable-900">{r.etudiant_nom}</p>
                  <p className="mt-0.5 text-xs text-sable-600">{r.motif_decision}</p>
                </div>
                <Badge ton={r.statut === 'acceptee' ? 'info' : 'neutre'}>
                  {r.statut === 'acceptee' ? 'Acceptée' : 'Refusée'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      {/* Les modales restent MONTEES pour que leur animation de sortie joue ;
          seul leur contenu est conditionnel. */}
      <Modale
        ouverte={Boolean(presenceModifiee)}
        titre="Modifier l'horaire"
        description={presenceModifiee
          ? `${presenceModifiee.etudiant_nom} · arrivée à ${heure(presenceModifiee.heure_arrivee)}`
          : ''}
        onFermer={() => setPresenceModifiee(null)}
      >
        {presenceModifiee && (
          <ModaleModificationHoraire
            presence={presenceModifiee}
            onFermer={() => setPresenceModifiee(null)}
            onEnregistre={() => rafraichir("Horaire modifié. La modification est consignée dans le journal d'audit.")}
          />
        )}
      </Modale>

      <Modale
        ouverte={Boolean(demandeTraitee)}
        titre={decision === 'acceptee' ? 'Accepter la demande' : 'Refuser la demande'}
        description={decision === 'acceptee'
          ? 'Les heures demandées seront appliquées à la présence de cet étudiant.'
          : "La présence restera inchangée. L'étudiant verra votre motif."}
        onFermer={() => setDemandeTraitee(null)}
      >
        {demandeTraitee && (
          <ModaleDecision
            demande={demandeTraitee}
            decision={decision}
            onFermer={() => setDemandeTraitee(null)}
            onTraite={() => rafraichir(
              decision === 'acceptee'
                ? 'Demande acceptée. Les heures ont été mises à jour et la modification consignée.'
                : "Demande refusée. Votre motif sera visible par l'étudiant."
            )}
          />
        )}
      </Modale>
    </div>
  );
}

export default DetailSeance;
