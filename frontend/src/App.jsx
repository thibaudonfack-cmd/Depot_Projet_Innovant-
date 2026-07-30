// src/App.jsx
//
// OUTIL DE TEST DE DEVELOPPEMENT (test harness) -- PAS un ecran du produit
// final. Cette page existe pour une seule raison : declencher et observer
// manuellement les chaines cryptographiques des Etapes 4 et 5 sans passer
// par la console du navigateur :
//   - Enrolement  : generation ECDSA P-256 -> IndexedDB -> POST /api/enrolements
//   - Scan signe  : reception du jeton (WebSocket) -> signature ECDSA de
//                   l'appareil -> POST /api/scans
//
// Le menu deroulant "Etudiant" en est le marqueur le plus evident : dans le
// produit final, l'identite de l'etudiant ne sera JAMAIS choisie dans une
// liste -- elle proviendra de la session authentifiee. De meme, un etudiant
// ne collera jamais un JWT a la main : il scannera un QR code avec la camera
// de son telephone. Voir ANALYSE_CODE.md, Etape 4, section "Role de
// l'interface temporaire", pour le detail du parcours reel prevu.

import { useEffect, useRef, useState } from 'react';
import {
  generateAndStoreKeyPair,
  exportPublicKey,
  signData,
} from './services/CryptoService';

// UUID fixes du jeu de donnees de demonstration (database/02-seed.sql) --
// deja utilises partout ailleurs dans ce projet (TESTING.md, scan.test.js)
// pour rester reproductibles d'un environnement a l'autre.
const ETUDIANTS_DEMO = [
  { id: '33333333-3333-3333-3333-333333333331', nom: 'Amara Diallo' },
  { id: '33333333-3333-3333-3333-333333333332', nom: 'Bilal Ozturk' },
  { id: '33333333-3333-3333-3333-333333333333', nom: 'Chiara Rossi' },
  { id: '33333333-3333-3333-3333-333333333334', nom: 'Driss El Amrani' },
];

const UF_DEMO = '11111111-1111-1111-1111-111111111111';
const SALLE_DEMO = '22222222-2222-2222-2222-222222222222';

function deviceInfoParDefaut() {
  const ua = navigator.userAgent || '';
  const navigateur = ['Firefox', 'Edg', 'Chrome', 'Safari'].find((n) => ua.includes(n)) || 'Navigateur inconnu';
  return `${navigator.platform || 'Appareil'} - ${navigateur}`;
}

const CLASSES_CHAMP =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'shadow-sm transition-colors placeholder:text-slate-400 ' +
  'focus-visible:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10';

const CLASSES_BOUTON_PRIMAIRE =
  'w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors ' +
  'hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ' +
  'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400';

const CLASSES_BOUTON_SECONDAIRE =
  'w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 ' +
  'transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-400';

/** Bloc de resultat reutilise par les deux sections (succes ou erreur). */
function BlocResultat({ statut, resultat, titreSucces }) {
  if (statut !== 'succes' && statut !== 'erreur') return null;

  const succes = statut === 'succes';
  return (
    <div
      className={`mt-4 rounded-lg border p-4 ${
        succes ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
      }`}
    >
      <h3 className={`text-sm font-semibold ${succes ? 'text-emerald-900' : 'text-red-900'}`}>
        {succes ? titreSucces : 'Échec'}
      </h3>
      <pre
        className={`mt-2 overflow-x-auto font-mono text-xs leading-relaxed break-words whitespace-pre-wrap ${
          succes ? 'text-emerald-950' : 'text-red-950'
        }`}
      >
        {succes ? JSON.stringify(resultat, null, 2) : resultat.message}
      </pre>
    </div>
  );
}

function App() {
  const [etudiantId, setEtudiantId] = useState(ETUDIANTS_DEMO[0].id);

  // --- Section 1 : enrolement ---
  const [deviceInfo, setDeviceInfo] = useState(deviceInfoParDefaut);
  const [statutEnrolement, setStatutEnrolement] = useState('repos');
  const [resultatEnrolement, setResultatEnrolement] = useState(null);

  // --- Section 2 : simulation de scan ---
  const [seanceId, setSeanceId] = useState('');
  const [jeton, setJeton] = useState('');
  const [statutSeance, setStatutSeance] = useState('repos');
  const [statutScan, setStatutScan] = useState('repos');
  const [resultatScan, setResultatScan] = useState(null);
  const [wsConnecte, setWsConnecte] = useState(false);
  const wsRef = useRef(null);

  // Fermeture de la connexion WebSocket au demontage du composant : sans ce
  // nettoyage, la socket resterait ouverte et le backend continuerait a
  // pousser un jeton toutes les 20s dans le vide (cf. qrBroadcaster.js, meme
  // preoccupation de fuite cote serveur).
  useEffect(() => () => wsRef.current?.close(), []);

  async function handleEnrolement() {
    setStatutEnrolement('en-cours');
    setResultatEnrolement(null);
    try {
      await generateAndStoreKeyPair();
      const clePublique = await exportPublicKey();

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
      if (!reponse.ok) throw new Error(corps.message || `Erreur HTTP ${reponse.status}`);

      setStatutEnrolement('succes');
      setResultatEnrolement(corps);
    } catch (erreur) {
      setStatutEnrolement('erreur');
      setResultatEnrolement({ message: erreur.message });
    }
  }

  /** Cree une seance de test puis s'y abonne en WebSocket pour recevoir les jetons. */
  async function handleOuvrirSeance() {
    setStatutSeance('en-cours');
    setJeton('');
    wsRef.current?.close();

    try {
      const reponse = await fetch('/api/seances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uf_id: UF_DEMO, salle_id: SALLE_DEMO }),
      });
      const corps = await reponse.json();
      if (!reponse.ok) throw new Error(corps.message || `Erreur HTTP ${reponse.status}`);

      setSeanceId(corps.seance_id);

      // wss:// (et non ws://) : la page est servie en HTTPS par Caddy, un
      // WebSocket non chiffre depuis une origine securisee serait bloque par
      // le navigateur (mixed content). location.host conserve le port courant.
      const ws = new WebSocket(`wss://${window.location.host}/api/ws/seances/${corps.seance_id}`);
      wsRef.current = ws;

      ws.onopen = () => { setWsConnecte(true); setStatutSeance('succes'); };
      ws.onmessage = (evenement) => {
        const message = JSON.parse(evenement.data);
        // Chaque message remplace le jeton affiche : c'est exactement ce que
        // voit un etudiant devant l'ecran du formateur, ou le QR code est
        // regenere toutes les 20 secondes (RF-05).
        if (message.type === 'token') setJeton(message.token);
      };
      ws.onerror = () => {
        setWsConnecte(false);
        setStatutSeance('erreur');
      };
      ws.onclose = () => setWsConnecte(false);
    } catch (erreur) {
      setStatutSeance('erreur');
      setSeanceId('');
      setResultatScan({ message: erreur.message });
    }
  }

  async function handleSignerEtEnvoyer() {
    setStatutScan('en-cours');
    setResultatScan(null);
    try {
      // La signature porte sur le JETON COMPLET, exactement tel qu'il sera
      // transmis -- le backend re-verifie sur cette meme chaine (cf.
      // deviceSignatureService.js). Toute divergence (espace en trop, jeton
      // tronque) invaliderait la signature.
      const signature = await signData(jeton.trim());

      const reponse = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          etudiant_id: etudiantId,
          jeton: jeton.trim(),
          signature_appareil: signature,
        }),
      });
      const corps = await reponse.json();
      if (!reponse.ok) {
        throw new Error(`[${corps.code || reponse.status}] ${corps.message || 'Erreur inconnue'}`);
      }

      setStatutScan('succes');
      setResultatScan(corps);
    } catch (erreur) {
      setStatutScan('erreur');
      setResultatScan({ message: erreur.message });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <main className="mx-auto w-full max-w-xl">
        <div
          role="note"
          className="mb-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="font-semibold">Outil de test — développement.</span>{' '}
          Cette page sert à valider manuellement les chaînes cryptographiques
          d'enrôlement et de scan. Elle ne fait pas partie du produit final :
          l'identité de l'étudiant y proviendra de la session authentifiée, et
          le jeton d'un QR code scanné par la caméra — jamais d'une liste
          déroulante ni d'un copier-coller.
        </div>

        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Présence numérique — banc de test
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Enrôlement de l'appareil (clé ECDSA P-256 non-extractable), puis
            simulation d'un scan signé par cette clé.
          </p>
        </header>

        {/* Selection d'etudiant : partagee par les deux sections, donc
            remontee au-dessus d'elles plutot que dupliquee. */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <label htmlFor="etudiant" className="block text-sm font-medium text-slate-900">
            Étudiant
          </label>
          <p id="etudiant-aide" className="mt-1 text-xs text-slate-500">
            Jeu de données de démonstration (<code className="font-mono">02-seed.sql</code>).
            S'applique à l'enrôlement comme au scan.
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

        {/* ---------- Section 1 : enrolement ---------- */}
        <section
          aria-labelledby="titre-enrolement"
          className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 id="titre-enrolement" className="text-base font-semibold text-slate-900">
            1 · Enrôlement de l'appareil
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Génère une paire ECDSA P-256 dans ce navigateur. La clé privée est
            non-extractable et reste dans IndexedDB ; seule la clé publique est
            transmise au serveur.
          </p>

          <div className="mt-5 space-y-5">
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
              disabled={statutEnrolement === 'en-cours'}
              className={CLASSES_BOUTON_PRIMAIRE}
            >
              {statutEnrolement === 'en-cours' ? 'Enrôlement en cours…' : "Générer une clé et s'enrôler"}
            </button>
          </div>

          <div aria-live="polite">
            <BlocResultat
              statut={statutEnrolement}
              resultat={resultatEnrolement}
              titreSucces="Enrôlement réussi"
            />
          </div>
        </section>

        {/* ---------- Section 2 : simulation de scan ---------- */}
        <section
          aria-labelledby="titre-scan"
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 id="titre-scan" className="text-base font-semibold text-slate-900">
            2 · Simulation de scan
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Ouvre une séance de test, reçoit ses jetons en temps réel
            (WebSocket, rotation toutes les 20 s), puis signe le jeton courant
            avec la clé privée de cet appareil avant de l'envoyer.
          </p>

          <div className="mt-5 space-y-5">
            <div>
              <button
                type="button"
                onClick={handleOuvrirSeance}
                disabled={statutSeance === 'en-cours'}
                className={CLASSES_BOUTON_SECONDAIRE}
              >
                {statutSeance === 'en-cours'
                  ? 'Ouverture…'
                  : seanceId
                    ? 'Ouvrir une nouvelle séance de test'
                    : 'Ouvrir une séance de test'}
              </button>

              {seanceId && (
                <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  {/* Pastille d'etat : doublee d'un texte explicite, jamais
                      la couleur seule -- une information transmise uniquement
                      par la couleur serait inaccessible (WCAG 1.4.1). */}
                  <span
                    aria-hidden="true"
                    className={`inline-block size-2 rounded-full ${wsConnecte ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  />
                  {wsConnecte ? 'WebSocket connecté' : 'WebSocket déconnecté'} — séance{' '}
                  <code className="font-mono">{seanceId}</code>
                </p>
              )}
            </div>

            <div>
              <label htmlFor="jeton" className="block text-sm font-medium text-slate-900">
                Jeton de séance (JWT)
              </label>
              <p id="jeton-aide" className="mt-1 text-xs text-slate-500">
                Rempli automatiquement par le WebSocket, ou collé manuellement.
              </p>
              <textarea
                id="jeton"
                rows={4}
                aria-describedby="jeton-aide"
                value={jeton}
                onChange={(e) => setJeton(e.target.value)}
                placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…"
                className={`mt-2 resize-y font-mono text-xs break-all ${CLASSES_CHAMP}`}
              />
            </div>

            <button
              type="button"
              onClick={handleSignerEtEnvoyer}
              disabled={statutScan === 'en-cours' || jeton.trim().length === 0}
              className={CLASSES_BOUTON_PRIMAIRE}
            >
              {statutScan === 'en-cours' ? 'Signature et envoi…' : 'Signer et envoyer'}
            </button>
          </div>

          <div aria-live="polite">
            <BlocResultat
              statut={statutScan}
              resultat={resultatScan}
              titreSucces="Présence validée"
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
