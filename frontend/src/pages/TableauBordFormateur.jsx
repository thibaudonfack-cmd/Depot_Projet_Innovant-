// src/pages/TableauBordFormateur.jsx
// Espace formateur (/formateur) : ouverture d'une seance puis projection du
// QR code (Etape 7d).
//
// Le suivi du temps et le geofencing ne sont pas traites ici : les heures
// saisies sont les heures PREVUES du cours, elles ne mesurent encore la
// presence de personne.

import { useMemo, useState } from 'react';
import EnTeteApplication from '../components/EnTeteApplication';
import AffichageQR from '../components/AffichageQR';
import { Bouton, Carte, Champ, Message, Selection } from '../components/ui';
import { useAuth } from '../context/contexte-auth';
import { appelerApi } from '../services/api';

// Jeu de donnees de demonstration (database/02-seed.sql). Une seule UF et une
// seule salle y figurent reellement ; les autres entrees sont proposees pour
// eprouver l'interface, et le serveur les refusera par violation de cle
// etrangere. C'est volontaire : cela permet de verifier que l'erreur remonte
// proprement jusqu'a l'utilisateur.
const UNITES_FORMATION = [
  { id: '11111111-1111-1111-1111-111111111111', nom: 'Anglais - Niveau 2' },
  { id: '11111111-1111-1111-1111-111111111112', nom: 'Bureautique - Initiation' },
  { id: '11111111-1111-1111-1111-111111111113', nom: 'Comptabilité générale' },
];

const SALLES = [
  { id: '22222222-2222-2222-2222-222222222222', nom: 'Local 12 - ESA Namur' },
  { id: '22222222-2222-2222-2222-222222222223', nom: 'Local 4 - Aile Sud' },
  { id: '22222222-2222-2222-2222-222222222224', nom: 'Atelier informatique' },
];

/**
 * Valeur du jour au format attendu par <input type="date"> (AAAA-MM-JJ).
 * On passe par les composantes locales plutot que par toISOString(), qui
 * convertit en UTC et renverrait la veille en soiree pour un fuseau en
 * avance sur Greenwich.
 */
function dateDuJour() {
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}

/**
 * Combine une date et une heure saisies localement en instant ISO.
 * new Date('2026-09-01T09:00') est interprete dans le fuseau du navigateur,
 * puis toISOString() le convertit en UTC. Le formateur saisit donc son heure
 * locale, et le serveur recoit un instant sans ambiguite.
 */
function versInstantIso(date, heure) {
  return new Date(`${date}T${heure}`).toISOString();
}

function FormulaireSeance({ onCreee }) {
  const [ufId, setUfId] = useState(UNITES_FORMATION[0].id);
  const [salleId, setSalleId] = useState(SALLES[0].id);
  const [date, setDate] = useState(dateDuJour);
  const [heureDebut, setHeureDebut] = useState('09:00');
  const [heureFin, setHeureFin] = useState('12:00');
  const [erreur, setErreur] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  // Controle immediat, avant meme l'envoi : signaler l'incoherence pendant la
  // saisie evite un aller-retour reseau pour une erreur evitable. Le serveur
  // refait la verification de son cote, ce controle-ci n'est qu'un confort.
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
        <Selection
          id="uf" libelle="Unité de formation"
          value={ufId} onChange={(e) => setUfId(e.target.value)}
        >
          {UNITES_FORMATION.map((uf) => <option key={uf.id} value={uf.id}>{uf.nom}</option>)}
        </Selection>

        <Selection
          id="salle" libelle="Salle"
          value={salleId} onChange={(e) => setSalleId(e.target.value)}
        >
          {SALLES.map((salle) => <option key={salle.id} value={salle.id}>{salle.nom}</option>)}
        </Selection>
      </div>

      <Champ
        id="date" libelle="Date" type="date"
        value={date} onChange={(e) => setDate(e.target.value)} required
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Champ
          id="heure-debut" libelle="Début prévu" type="time"
          value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} required
        />
        <Champ
          id="heure-fin" libelle="Fin prévue" type="time"
          value={heureFin} onChange={(e) => setHeureFin(e.target.value)}
          erreur={bornesIncoherentes} required
        />
      </div>

      <div aria-live="polite" className="space-y-3">
        {bornesIncoherentes && (
          <Message ton="erreur">
            La fin doit être postérieure au début.
          </Message>
        )}
        {erreur && <Message ton="erreur">{erreur}</Message>}
      </div>

      <Bouton
        type="submit"
        chargement={envoiEnCours}
        enfantsChargement="Ouverture en cours"
        disabled={bornesIncoherentes}
      >
        Créer la séance
      </Bouton>
    </form>
  );
}

/** Recapitulatif lisible de la seance ouverte. */
function ResumeSeance({ seance }) {
  const uf = UNITES_FORMATION.find((u) => u.id === seance.uf_id);
  const salle = SALLES.find((s) => s.id === seance.salle_id);

  const creneau = seance.heure_debut_prevue && seance.heure_fin_prevue
    ? `${new Date(seance.heure_debut_prevue).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} - ${new Date(seance.heure_fin_prevue).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`
    : 'Horaire non précisé';

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {[
        ['Unité de formation', uf?.nom ?? seance.uf_id],
        ['Salle', salle?.nom ?? seance.salle_id],
        ['Créneau prévu', creneau],
      ].map(([intitule, valeur]) => (
        <div key={intitule} className="min-w-0">
          <dt className="text-xs text-sable-500">{intitule}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium text-sable-900">{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

function TableauBordFormateur() {
  const { utilisateur } = useAuth();
  const [seance, setSeance] = useState(null);

  return (
    <div className="min-h-svh">
      <EnTeteApplication sousTitre="Espace formateur" />

      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        {!seance && (
          <Carte>
            <h2 className="text-sm font-semibold text-sable-900">Votre compte</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-sable-500">Nom</dt>
                <dd className="mt-0.5 text-sm text-sable-900">{utilisateur?.nom}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-sable-500">Adresse e-mail</dt>
                <dd className="mt-0.5 truncate text-sm text-sable-900">{utilisateur?.email}</dd>
              </div>
            </dl>
          </Carte>
        )}

        <Carte>
          {seance ? (
            <div className="motion-safe:animate-[apparition_250ms_ease-out]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-sable-900">Séance ouverte</h2>
                  <p className="mt-1 text-sm text-sable-600">
                    Projetez ce QR code pour que vos étudiants valident leur présence.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-600" />
                  En cours
                </span>
              </div>

              <div className="mt-5">
                <ResumeSeance seance={seance} />
              </div>

              <div className="mt-6">
                {/* Le QR encode l'identifiant de seance. Les jetons signes a
                    rotation (Etape 2) seront branches ici lorsque le flux
                    temps reel sera relie a cet ecran. */}
                <AffichageQR
                  valeur={seance.id}
                  libelle="Scannez pour valider votre présence"
                  aide="Séance en cours. Le QR reste affiché tant que la séance est ouverte."
                />
              </div>

              <div className="mt-5">
                <Bouton variante="secondaire" onClick={() => setSeance(null)}>
                  Ouvrir une autre séance
                </Bouton>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-sable-900">Ouvrir une séance</h2>
              <p className="mt-1 text-sm leading-relaxed text-sable-600">
                Choisissez l&apos;unité de formation, la salle et le créneau prévu.
                Le QR code s&apos;affichera ensuite, prêt à être projeté.
              </p>
              <FormulaireSeance onCreee={setSeance} />
            </>
          )}
        </Carte>
      </main>
    </div>
  );
}

export default TableauBordFormateur;
