// src/pages/TableauBordFormateur.jsx
// Espace formateur (/formateur).
//
// Perimetre volontairement limite a l'Etape 7b : structure, identite,
// deconnexion, et l'emplacement reserve a la creation de seance. La logique
// correspondante arrive a l'Etape 7d, le geofencing a la 7e.

import EnTeteApplication from '../components/EnTeteApplication';
import { Carte } from '../components/ui';
import { useAuth } from '../context/contexte-auth';

/**
 * Etat d'attente pour une fonctionnalite a venir.
 *
 * Traite comme un ecran a part entiere plutot qu'expedie en une ligne de
 * texte gris : un emplacement vide mais dessine montre ce que la zone
 * contiendra, ce qui rend la maquette lisible en demonstration. Les champs
 * sont volontairement inertes et signales comme tels, pour qu'on ne les
 * confonde pas avec une interface defaillante.
 */
function ZoneAVenir() {
  return (
    <Carte>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Ouvrir une séance</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Vous choisirez l&apos;unité de formation et la salle, puis le QR code
            s&apos;affichera ici pour vos étudiants.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700">
          Étape 7d
        </span>
      </div>

      {/* Apercu inerte. aria-hidden : ces elements factices n'ont aucun sens
          pour un lecteur d'ecran, le texte explicatif au-dessus suffit. */}
      <div aria-hidden="true" className="mt-6 space-y-4 select-none">
        <div className="grid gap-4 sm:grid-cols-2">
          {['Unité de formation', 'Salle'].map((libelle) => (
            <div key={libelle} className="space-y-1.5">
              <span className="block text-sm font-medium text-slate-300">{libelle}</span>
              <div className="h-11 rounded-xl border border-dashed border-slate-200 bg-slate-50/60" />
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 py-10">
          <svg
            viewBox="0 0 24 24" className="size-8 text-slate-300"
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3h-3zM19 14h2M14 19h3M19 19h2" />
          </svg>
          <span className="text-xs text-slate-400">Le QR code apparaîtra ici</span>
        </div>
      </div>
    </Carte>
  );
}

function TableauBordFormateur() {
  const { utilisateur } = useAuth();

  return (
    <div className="min-h-svh">
      <EnTeteApplication sousTitre="Espace formateur" />

      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <Carte>
          <h2 className="text-sm font-semibold text-slate-900">Votre compte</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Nom</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{utilisateur?.nom}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-slate-500">Adresse e-mail</dt>
              <dd className="mt-0.5 truncate text-sm text-slate-900">{utilisateur?.email}</dd>
            </div>
          </dl>
        </Carte>

        <ZoneAVenir />
      </main>
    </div>
  );
}

export default TableauBordFormateur;
