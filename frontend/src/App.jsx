// src/App.jsx
//
// OUTIL DE TEST DE DEVELOPPEMENT (test harness) -- PAS un ecran du produit
// final. Cette page existe pour une seule raison : permettre de declencher
// et d'observer manuellement la chaine cryptographique de l'Etape 4
// (generation ECDSA P-256 -> IndexedDB -> POST /api/enrolements -> reponse
// backend) sans avoir a passer par la console du navigateur.
//
// Le menu deroulant "Etudiant" en est le marqueur le plus evident : dans le
// produit final, l'identite de l'etudiant ne sera JAMAIS choisie dans une
// liste -- elle proviendra de la session authentifiee. Voir ANALYSE_CODE.md,
// section Etape 4, "Role de l'interface temporaire", pour le detail du
// parcours reel prevu et de ce qui separe cette page d'un ecran de production.

import { useState } from 'react';
import { generateAndStoreKeyPair, exportPublicKey } from './services/CryptoService';

// UUID fixes du jeu de donnees de demonstration (database/02-seed.sql) --
// deja utilises partout ailleurs dans ce projet (TESTING.md, scan.test.js)
// pour rester reproductibles d'un environnement a l'autre.
const ETUDIANTS_DEMO = [
  { id: '33333333-3333-3333-3333-333333333331', nom: 'Amara Diallo' },
  { id: '33333333-3333-3333-3333-333333333332', nom: 'Bilal Ozturk' },
  { id: '33333333-3333-3333-3333-333333333333', nom: 'Chiara Rossi' },
  { id: '33333333-3333-3333-3333-333333333334', nom: 'Driss El Amrani' },
];

function deviceInfoParDefaut() {
  // Description sommaire de l'appareil/navigateur courant, uniquement a
  // titre indicatif pour le formateur (jamais utilisee comme identifiant de
  // securite -- seule la cle publique ECDSA joue ce role).
  const ua = navigator.userAgent || '';
  const navigateur = ['Firefox', 'Edg', 'Chrome', 'Safari'].find((n) => ua.includes(n)) || 'Navigateur inconnu';
  return `${navigator.platform || 'Appareil'} - ${navigateur}`;
}

// Classes partagees par les deux champs de saisie -- extraites dans une
// constante plutot que dupliquees : un seul endroit a modifier pour garder
// les champs visuellement coherents. focus-visible (et non focus) : l'anneau
// de focus n'apparait qu'au clavier, pas au clic souris -- accessibilite
// sans bruit visuel.
const CLASSES_CHAMP =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'shadow-sm transition-colors placeholder:text-slate-400 ' +
  'focus-visible:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10';

function App() {
  const [etudiantId, setEtudiantId] = useState(ETUDIANTS_DEMO[0].id);
  const [deviceInfo, setDeviceInfo] = useState(deviceInfoParDefaut);
  const [statut, setStatut] = useState('repos'); // repos | en-cours | succes | erreur
  const [resultat, setResultat] = useState(null);

  async function handleEnrolement() {
    setStatut('en-cours');
    setResultat(null);

    try {
      // 1. Generation locale (cle privee non-extractable, jamais transmise)
      await generateAndStoreKeyPair();
      // 2. Export de la SEULE cle publique, au format PEM
      const clePublique = await exportPublicKey();

      // 3. Envoi au backend -- chemin relatif : passe par Caddy (meme
      // origine que le frontend), qui route /api/* vers le service backend.
      // Aucune configuration CORS necessaire : meme origine de bout en bout.
      const reponse = await fetch('/api/enrolements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          etudiant_id: etudiantId,
          public_key: clePublique,
          device_info: deviceInfo,
        }),
      });

      const corps = await reponse.json();

      if (!reponse.ok) {
        throw new Error(corps.message || `Erreur HTTP ${reponse.status}`);
      }

      setStatut('succes');
      setResultat(corps);
    } catch (erreur) {
      setStatut('erreur');
      setResultat({ message: erreur.message });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <main className="mx-auto w-full max-w-xl">
        {/* Bandeau d'avertissement : rend visible A L'ECRAN, et pas seulement
            dans les commentaires du code, le fait que cette page est un outil
            de test. role="note" plutot que role="alert" : l'information est
            contextuelle et permanente, elle ne doit pas interrompre le
            lecteur d'ecran a chaque rendu. */}
        <div
          role="note"
          className="mb-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="font-semibold">Outil de test — développement.</span>{' '}
          Cette page sert à valider manuellement la chaîne cryptographique
          d'enrôlement. Elle ne fait pas partie du produit final : l'identité
          de l'étudiant y proviendra de la session authentifiée, jamais d'une
          liste déroulante.
        </div>

        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Enrôlement d'appareil
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Génère une paire de clés ECDSA P-256 dans ce navigateur. La clé
            privée est non-extractable et reste dans IndexedDB ; seule la clé
            publique est transmise au serveur.
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-5">
            <div>
              <label htmlFor="etudiant" className="block text-sm font-medium text-slate-900">
                Étudiant
              </label>
              <p id="etudiant-aide" className="mt-1 text-xs text-slate-500">
                Jeu de données de démonstration (<code className="font-mono">02-seed.sql</code>).
              </p>
              <select
                id="etudiant"
                aria-describedby="etudiant-aide"
                value={etudiantId}
                onChange={(e) => setEtudiantId(e.target.value)}
                className={`mt-2 ${CLASSES_CHAMP}`}
              >
                {ETUDIANTS_DEMO.map((etudiant) => (
                  <option key={etudiant.id} value={etudiant.id}>{etudiant.nom}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="device" className="block text-sm font-medium text-slate-900">
                Description de l'appareil
              </label>
              <p id="device-aide" className="mt-1 text-xs text-slate-500">
                Informatif uniquement — ne joue aucun rôle de sécurité.
              </p>
              <input
                id="device"
                type="text"
                aria-describedby="device-aide"
                value={deviceInfo}
                onChange={(e) => setDeviceInfo(e.target.value)}
                className={`mt-2 ${CLASSES_CHAMP}`}
              />
            </div>

            <button
              type="button"
              onClick={handleEnrolement}
              disabled={statut === 'en-cours'}
              className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white
                         transition-colors hover:bg-slate-800
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2
                         disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {statut === 'en-cours' ? 'Enrôlement en cours…' : "Générer une clé et s'enrôler"}
            </button>
          </div>
        </section>

        {/* aria-live="polite" : le resultat apparait apres une action
            asynchrone -- sans cette annonce, un utilisateur de lecteur
            d'ecran n'aurait aucun moyen de savoir que la reponse est
            arrivee. "polite" et non "assertive" : l'annonce attend une
            pause naturelle plutot que de couper la lecture en cours. */}
        <div aria-live="polite" className="mt-6">
          {statut === 'succes' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <h2 className="text-sm font-semibold text-emerald-900">Enrôlement réussi</h2>
              <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed text-emerald-950">
                {JSON.stringify(resultat, null, 2)}
              </pre>
            </div>
          )}

          {statut === 'erreur' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h2 className="text-sm font-semibold text-red-900">Échec de l'enrôlement</h2>
              <p className="mt-2 font-mono text-xs leading-relaxed break-words text-red-950">
                {resultat.message}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
