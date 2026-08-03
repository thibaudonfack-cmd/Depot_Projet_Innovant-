// src/pages/TableauBordFormateur.jsx
// Espace formateur : liste des seances, ouverture d'une seance, projection du
// QR dynamique et consultation des presences.
//
// La modification des heures et le traitement des demandes de rectification
// ne sont pas implementes : l'ecran de detail prepare leur emplacement, la
// logique d'ecriture viendra avec le suivi du temps.

import { useCallback, useEffect, useMemo, useState } from 'react';
import EnTeteApplication from '../components/EnTeteApplication';
import AffichageQR from '../components/AffichageQR';
import {
  Badge, Bouton, Carte, ChargementEnLigne, Champ, EtatVide, Message, Selection,
} from '../components/ui';
import { dateCourte, duree, heure } from '../components/format';
import { appelerApi } from '../services/api';

/** Date du jour au format AAAA-MM-JJ, en composantes LOCALES.
 *  toISOString() convertirait en UTC et renverrait la veille en soiree pour
 *  un fuseau en avance sur Greenwich. */
function dateDuJour() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** Combine date et heure locales en instant ISO (donc en UTC cote serveur). */
function versInstantIso(date, h) {
  return new Date(`${date}T${h}`).toISOString();
}

// ---------------------------------------------------------------------------
// Formulaire d'ouverture
// ---------------------------------------------------------------------------

function FormulaireSeance({ unitesFormation, salles, onCreee }) {
  const [ufId, setUfId] = useState('');
  const [salleId, setSalleId] = useState('');
  const [date, setDate] = useState(dateDuJour);
  const [heureDebut, setHeureDebut] = useState('09:00');
  const [heureFin, setHeureFin] = useState('12:00');
  const [erreur, setErreur] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  // Les valeurs par defaut sont posees APRES chargement des listes : les
  // figer a l'initialisation donnerait une chaine vide, et le formulaire
  // partirait avec un identifiant inexistant.
  useEffect(() => {
    if (unitesFormation.length && !ufId) setUfId(unitesFormation[0].id);
    if (salles.length && !salleId) setSalleId(salles[0].id);
  }, [unitesFormation, salles, ufId, salleId]);

  const bornesIncoherentes = useMemo(
    () => Boolean(heureDebut && heureFin && heureFin <= heureDebut),
    [heureDebut, heureFin]
  );

  async function handleSoumission(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnvoiEnCours(true);
    try {
      const reponse = await appelerApi('/api/seances', {
        methode: 'POST',
        corps: {
          uf_id: ufId,
          salle_id: salleId,
          heure_debut_prevue: versInstantIso(date, heureDebut),
          heure_fin_prevue: versInstantIso(date, heureFin),
        },
      });
      onCreee(reponse.seance);
    } catch (echec) {
      setErreur(echec.message || "La séance n'a pas pu être ouverte.");
    } finally {
      setEnvoiEnCours(false);
    }
  }

  return (
    <form onSubmit={handleSoumission} className="mt-6 space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Selection id="uf" libelle="Unité de formation" value={ufId} onChange={(e) => setUfId(e.target.value)}>
          {unitesFormation.map((uf) => <option key={uf.id} value={uf.id}>{uf.intitule}</option>)}
        </Selection>
        <Selection id="salle" libelle="Salle" value={salleId} onChange={(e) => setSalleId(e.target.value)}>
          {salles.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
        </Selection>
      </div>

      <Champ id="date" libelle="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

      <div className="grid gap-5 sm:grid-cols-2">
        <Champ id="heure-debut" libelle="Début prévu" type="time" value={heureDebut}
               onChange={(e) => setHeureDebut(e.target.value)} required />
        <Champ id="heure-fin" libelle="Fin prévue" type="time" value={heureFin}
               onChange={(e) => setHeureFin(e.target.value)} erreur={bornesIncoherentes} required />
      </div>

      <div aria-live="polite" className="space-y-3">
        {bornesIncoherentes && <Message ton="erreur">La fin doit être postérieure au début.</Message>}
        {erreur && <Message ton="erreur">{erreur}</Message>}
      </div>

      <Bouton type="submit" chargement={envoiEnCours} enfantsChargement="Ouverture en cours"
              disabled={bornesIncoherentes || !ufId || !salleId}>
        Créer la séance
      </Bouton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Detail des presences
// ---------------------------------------------------------------------------

function DetailPresences({ seanceId, onRetour }) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let annule = false;
    appelerApi(`/api/seances/${seanceId}/presences`)
      .then((r) => { if (!annule) setDonnees(r); })
      .catch((e) => { if (!annule) setErreur(e.message); });
    return () => { annule = true; };
  }, [seanceId]);

  return (
    <Carte>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-sable-900">Présences</h2>
          {donnees && (
            <p className="mt-1 text-sm text-sable-600">
              {donnees.seance.uf_intitule} · {donnees.seance.salle_nom}
            </p>
          )}
        </div>
        <Bouton variante="secondaire" onClick={onRetour} className="w-auto px-3 py-2 text-xs">
          Retour
        </Bouton>
      </div>

      {erreur && <div className="mt-4"><Message ton="erreur">{erreur}</Message></div>}
      {!donnees && !erreur && <ChargementEnLigne libelle="Chargement des présences" />}

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
              </tr>
            </thead>
            <tbody className="divide-y divide-sable-200">
              {donnees.presences.map((p) => (
                <tr key={p.id}>
                  <td className="py-3 pr-3 font-medium text-sable-900">{p.etudiant_nom}</td>
                  <td className="py-3 pr-3 text-sable-700">{heure(p.heure_arrivee)}</td>
                  <td className="py-3 pr-3 text-sable-700">{heure(p.heure_depart)}</td>
                  <td className="py-3">
                    {p.heure_depart
                      ? <span className="text-sable-900">{duree(p.duree_minutes)}</span>
                      : <Badge ton="actif">En cours</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {donnees && (
        <p className="mt-5 text-xs text-sable-600">
          La modification manuelle des heures arrivera avec le suivi du temps.
          Chaque changement laissera une trace horodatée et motivée dans le
          journal d&apos;audit, conservé cinq ans.
        </p>
      )}
    </Carte>
  );
}

// ---------------------------------------------------------------------------
// Ecran principal
// ---------------------------------------------------------------------------

function TableauBordFormateur() {
  const [seances, setSeances] = useState(null);
  const [erreur, setErreur] = useState('');
  const [seanceProjetee, setSeanceProjetee] = useState(null);
  const [seanceDetaillee, setSeanceDetaillee] = useState(null);
  const [unitesFormation, setUnitesFormation] = useState([]);
  const [salles, setSalles] = useState([]);

  const chargerSeances = useCallback(async () => {
    try {
      const reponse = await appelerApi('/api/seances');
      setSeances(reponse.seances);
    } catch (echec) {
      setErreur(echec.message);
    }
  }, []);

  useEffect(() => {
    // Referentiels charges depuis la base, jamais ecrits en dur : c'est ce
    // qui garantit que tout identifiant propose existe reellement.
    Promise.all([appelerApi('/api/uf'), appelerApi('/api/salles')])
      .then(([r1, r2]) => { setUnitesFormation(r1.uf); setSalles(r2.salles); })
      .catch((e) => setErreur(e.message));
    chargerSeances();
  }, [chargerSeances]);

  function handleCreee(seance) {
    setSeanceProjetee(seance);
    chargerSeances();
  }

  // Confirmation exigee tant qu'un QR est projete : un clic accidentel sur la
  // marque ferait disparaitre l'affichage devant la classe.
  const confirmation = seanceProjetee
    ? 'Le QR code cessera d\'être affiché. Voulez-vous vraiment quitter cet écran ?'
    : undefined;

  return (
    <div className="min-h-svh">
      <EnTeteApplication sousTitre="Espace formateur" confirmationRetour={confirmation} />

      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        {seanceProjetee ? (
          <Carte>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-sable-900">Séance en cours</h2>
                <p className="mt-1 text-sm text-sable-600">
                  Projetez ce QR code pour que vos étudiants valident leur présence.
                </p>
              </div>
              <Badge ton="actif">Ouverte</Badge>
            </div>

            <div className="mt-6">
              {/* seanceId et non valeur : le composant s'abonne au flux de
                  jetons signes a rotation. Le QR change tout seul, et une
                  photo de l'ecran devient inutilisable passe la fenetre. */}
              <AffichageQR
                seanceId={seanceProjetee.id}
                libelle="Scannez pour valider votre présence"
                aide="Ce code change automatiquement. Scannez celui qui est affiché."
              />
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Bouton variante="secondaire" onClick={() => setSeanceProjetee(null)}>
                Masquer le QR code
              </Bouton>
              <Bouton variante="secondaire" onClick={() => { setSeanceDetaillee(seanceProjetee.id); setSeanceProjetee(null); }}>
                Voir les présences
              </Bouton>
            </div>
          </Carte>
        ) : seanceDetaillee ? (
          <DetailPresences seanceId={seanceDetaillee} onRetour={() => setSeanceDetaillee(null)} />
        ) : (
          <>
            <Carte>
              <h2 className="text-sm font-semibold text-sable-900">Ouvrir une séance</h2>
              <p className="mt-1 text-sm leading-relaxed text-sable-600">
                Choisissez l&apos;unité de formation, la salle et le créneau prévu.
              </p>
              <FormulaireSeance unitesFormation={unitesFormation} salles={salles} onCreee={handleCreee} />
            </Carte>

            <Carte>
              <h2 className="text-sm font-semibold text-sable-900">Séances récentes</h2>
              {erreur && <div className="mt-4"><Message ton="erreur">{erreur}</Message></div>}
              {!seances && !erreur && <ChargementEnLigne libelle="Chargement des séances" />}

              {seances && seances.length === 0 && (
                <div className="mt-5">
                  <EtatVide titre="Aucune séance pour le moment">
                    Ouvrez votre première séance avec le formulaire ci-dessus.
                  </EtatVide>
                </div>
              )}

              {seances && seances.length > 0 && (
                <ul className="mt-5 divide-y divide-sable-200">
                  {seances.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-sable-900">{s.uf_intitule}</p>
                        <p className="mt-0.5 truncate text-xs text-sable-600">
                          {dateCourte(s.date_ouverture)} · {s.salle_nom} ·{' '}
                          {s.nb_presences} présence{s.nb_presences > 1 ? 's' : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Badge ton={s.statut === 'ouverte' ? 'actif' : 'neutre'}>
                          {s.statut === 'ouverte' ? 'Ouverte' : 'Clôturée'}
                        </Badge>
                        {s.statut === 'ouverte' && (
                          <Bouton variante="secondaire" onClick={() => setSeanceProjetee(s)}
                                  className="w-auto px-3 py-2 text-xs">
                            Réafficher le QR
                          </Bouton>
                        )}
                        <Bouton variante="secondaire" onClick={() => setSeanceDetaillee(s.id)}
                                className="w-auto px-3 py-2 text-xs">
                          Présences
                        </Bouton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Carte>
          </>
        )}
      </main>
    </div>
  );
}

export default TableauBordFormateur;
