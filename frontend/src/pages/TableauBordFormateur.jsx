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
import DetailSeance from './DetailSeance';
import {
  Badge, Bouton, Carte, ChargementEnLigne, Champ, EtatVide, Message, Selection,
} from '../components/ui';
import { dateCourte } from '../components/format';
import { appelerApi } from '../services/api';
import { obtenirPosition, messagePosition } from '../services/geolocalisation';

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
  const [avertissementPosition, setAvertissementPosition] = useState('');

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
      // La position sert de reference au geofencing. Demandee ICI et non au
      // chargement de la page : le navigateur n'affiche la demande de
      // permission qu'a la suite d'un geste explicite, et surtout la position
      // doit etre celle de la SALLE, pas celle d'ou le formateur consultait
      // son tableau de bord dix minutes plus tot.
      const { position, motif } = await obtenirPosition();
      if (!position) setAvertissementPosition(motif);

      const reponse = await appelerApi('/api/seances', {
        methode: 'POST',
        corps: {
          uf_id: ufId,
          salle_id: salleId,
          heure_debut_prevue: versInstantIso(date, heureDebut),
          heure_fin_prevue: versInstantIso(date, heureFin),
          latitude: position?.latitude,
          longitude: position?.longitude,
        },
      });
      onCreee(reponse.seance, reponse.geofencing_actif);
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

      {/* La raison de la demande est donnee AVANT que le navigateur ne
          l'affiche. Une demande de permission qui surgit sans contexte est
          massivement refusee, et une fois refusee elle est penible a
          reactiver. Expliquer d'abord coute une phrase et change tout. */}
      <div className="rounded-xl border border-sable-300 bg-sable-100 p-4">
        <div className="flex gap-3">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sable-600"
               fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" />
          </svg>
          <p className="text-xs leading-relaxed text-sable-700">
            À la création, votre navigateur demandera l&apos;accès à votre position.
            Elle sert de point de référence pour situer les scans de vos étudiants.
            Si vous refusez, la séance fonctionnera normalement, simplement sans
            cette vérification.
          </p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Champ id="heure-debut" libelle="Début prévu" type="time" value={heureDebut}
               onChange={(e) => setHeureDebut(e.target.value)} required />
        <Champ id="heure-fin" libelle="Fin prévue" type="time" value={heureFin}
               onChange={(e) => setHeureFin(e.target.value)} erreur={bornesIncoherentes} required />
      </div>

      <div aria-live="polite" className="space-y-3">
        {bornesIncoherentes && <Message ton="erreur">La fin doit être postérieure au début.</Message>}
        {erreur && <Message ton="erreur">{erreur}</Message>}
        {avertissementPosition && (
          <Message ton="info" titre="Séance créée sans référence géographique">
            {messagePosition(avertissementPosition)}
          </Message>
        )}
      </div>

      <Bouton type="submit" chargement={envoiEnCours} enfantsChargement="Ouverture en cours"
              disabled={bornesIncoherentes || !ufId || !salleId}>
        Créer la séance
      </Bouton>
    </form>
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

  function handleCreee(seance, geofencingActif) {
    setSeanceProjetee({ ...seance, geofencing_actif: geofencingActif });
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
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge ton="actif">Ouverte</Badge>
                <Badge ton={seanceProjetee.geofencing_actif ? 'info' : 'neutre'}>
                  {seanceProjetee.geofencing_actif ? 'Position de référence enregistrée' : 'Sans référence de position'}
                </Badge>
              </div>
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
          <DetailSeance seanceId={seanceDetaillee} onRetour={() => { setSeanceDetaillee(null); chargerSeances(); }} />
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
