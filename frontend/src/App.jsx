// src/App.jsx
//
// OUTIL DE TEST DE DEVELOPPEMENT (test harness) -- PAS le produit final.
// Il reunit sur un seul ecran les DEUX cotes du systeme, qui seront dans le
// produit fini deux applications distinctes utilisees par deux personnes
// differentes :
//   - cote FORMATEUR  : ouverture de seance, affichage du QR code qui tourne
//                       toutes les 20 s (RF-05) sur le videoprojecteur ;
//   - cote ETUDIANT   : enrolement de l'appareil, puis scan du QR avec la
//                       camera du telephone (RF-07, RF-12).
// Les rassembler ici est deliberé : cela permet de derouler la chaine
// complete sur un seul poste (scanner l'ecran avec la webcam), sans second
// appareil ni configuration reseau -- voir TESTING.md, Etape 6, pour les
// contraintes reelles d'un test sur telephone.
//
// Le selecteur d'etudiant reste le marqueur le plus visible du statut
// "outil de test" : dans le produit final, l'identite viendra de la session
// authentifiee. Cf. ANALYSE_CODE.md, Etape 4, "Role de l'interface temporaire".

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import QRScanner from './components/QRScanner';
import {
  generateAndStoreKeyPair,
  exportPublicKey,
  signData,
} from './services/CryptoService';

// UUID fixes du jeu de donnees de demonstration (database/02-seed.sql).
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

/** Bloc de resultat partage (succes ou erreur). */
function BlocResultat({ statut, resultat, titreSucces }) {
  if (statut !== 'succes' && statut !== 'erreur') return null;
  const succes = statut === 'succes';
  return (
    <div className={`mt-4 rounded-lg border p-4 ${succes ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
      <h3 className={`text-sm font-semibold ${succes ? 'text-emerald-900' : 'text-red-900'}`}>
        {succes ? titreSucces : 'Échec'}
      </h3>
      <pre className={`mt-2 overflow-x-auto font-mono text-xs leading-relaxed break-words whitespace-pre-wrap ${succes ? 'text-emerald-950' : 'text-red-950'}`}>
        {succes ? JSON.stringify(resultat, null, 2) : resultat.message}
      </pre>
    </div>
  );
}

/** Titre de section homogene. */
function EnteteSection({ numero, titre, description }) {
  return (
    <>
      <h2 className="text-base font-semibold text-slate-900">
        <span className="text-slate-400">{numero} ·</span> {titre}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
    </>
  );
}

function App() {
  const [etudiantId, setEtudiantId] = useState(ETUDIANTS_DEMO[0].id);

  // --- Section 1 : enrolement ---
  const [deviceInfo, setDeviceInfo] = useState(deviceInfoParDefaut);
  const [statutEnrolement, setStatutEnrolement] = useState('repos');
  const [resultatEnrolement, setResultatEnrolement] = useState(null);

  // --- Section 2 : seance (cote formateur) ---
  const [seanceId, setSeanceId] = useState('');
  const [jeton, setJeton] = useState('');
  const [statutSeance, setStatutSeance] = useState('repos');
  const [wsConnecte, setWsConnecte] = useState(false);
  const wsRef = useRef(null);

  // --- Section 3 : scan (cote etudiant) ---
  const [scannerOuvert, setScannerOuvert] = useState(false);
  const [jetonSaisi, setJetonSaisi] = useState('');
  const [saisieManuelle, setSaisieManuelle] = useState(false);
  const [statutScan, setStatutScan] = useState('repos');
  const [resultatScan, setResultatScan] = useState(null);

  // Fermeture de la connexion WebSocket au demontage : sans ce nettoyage, le
  // backend continuerait a pousser un jeton toutes les 20 s dans le vide
  // (meme preoccupation de fuite que cote serveur, cf. qrBroadcaster.js).
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
        // ETAPE 7c : etudiant_id n'est plus transmis -- le backend le lit
        // dans la session. credentials 'same-origin' pour que le cookie de
        // session accompagne la requete.
        credentials: 'same-origin',
        body: JSON.stringify({ public_key: clePublique, device_info: deviceInfo }),
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

      // wss:// et non ws:// : la page est servie en HTTPS par Caddy ; un
      // WebSocket non chiffre depuis une origine securisee serait bloque par
      // le navigateur (contenu mixte).
      const ws = new WebSocket(`wss://${window.location.host}/api/ws/seances/${corps.seance_id}`);
      wsRef.current = ws;
      ws.onopen = () => { setWsConnecte(true); setStatutSeance('succes'); };
      ws.onmessage = (evenement) => {
        const message = JSON.parse(evenement.data);
        if (message.type === 'token') setJeton(message.token);
      };
      ws.onerror = () => { setWsConnecte(false); setStatutSeance('erreur'); };
      ws.onclose = () => setWsConnecte(false);
    } catch (erreur) {
      setStatutSeance('erreur');
      setSeanceId('');
      setResultatScan({ message: erreur.message });
    }
  }

  /**
   * Signe un jeton avec la cle privee de cet appareil, puis l'envoie.
   * Logique de l'Etape 5, strictement inchangee : le scanner ne fait que
   * remplacer la SOURCE du jeton (camera au lieu du presse-papier).
   */
  const envoyerScan = useCallback(async (jetonBrut) => {
    const jetonPropre = (jetonBrut || '').trim();
    if (!jetonPropre) return;

    setStatutScan('en-cours');
    setResultatScan(null);
    try {
      // La signature porte sur le jeton COMPLET, exactement tel qu'il sera
      // transmis -- le backend re-verifie sur cette meme chaine. Toute
      // divergence (espace en trop, jeton tronque) invaliderait la signature.
      const signature = await signData(jetonPropre);
      const reponse = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ jeton: jetonPropre, signature_appareil: signature }),
      });
      const corps = await reponse.json();
      if (!reponse.ok) throw new Error(`[${corps.code || reponse.status}] ${corps.message || 'Erreur inconnue'}`);
      setStatutScan('succes');
      setResultatScan(corps);
    } catch (erreur) {
      setStatutScan('erreur');
      setResultatScan({ message: erreur.message });
    }
  }, []);

  /**
   * Appelee par QRScanner des qu'un QR est decode. useCallback OBLIGATOIRE :
   * QRScanner l'a en dependance de son useEffect ; une fonction recreee a
   * chaque rendu relancerait l'effet, donc couperait et redemanderait la
   * camera en boucle.
   */
  const handleQRDetecte = useCallback((contenu) => {
    setScannerOuvert(false);
    setJetonSaisi(contenu);
    envoyerScan(contenu);
  }, [envoyerScan]);

  const fermerScanner = useCallback(() => setScannerOuvert(false), []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <main className="mx-auto w-full max-w-xl">
        <div role="note" className="mb-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Outil de test — développement.</span>{' '}
          Cette page réunit les deux côtés du système (affichage formateur et
          scan étudiant) pour permettre de dérouler la chaîne complète sur un
          seul poste. Dans le produit final, ce seront deux applications
          distinctes, et l'identité de l'étudiant proviendra de la session
          authentifiée — jamais d'une liste déroulante.
        </div>

        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Présence numérique — banc de test
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Enrôlement de l'appareil, affichage du QR code de séance, puis scan
            par la caméra et validation cryptographique de la présence.
          </p>
        </header>

        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <label htmlFor="etudiant" className="block text-sm font-medium text-slate-900">Étudiant</label>
          <p id="etudiant-aide" className="mt-1 text-xs text-slate-500">
            Jeu de données de démonstration (<code className="font-mono">02-seed.sql</code>). S'applique à l'enrôlement comme au scan.
          </p>
          <select
            id="etudiant"
            aria-describedby="etudiant-aide"
            value={etudiantId}
            onChange={(e) => setEtudiantId(e.target.value)}
            className={`mt-2 ${CLASSES_CHAMP}`}
          >
            {ETUDIANTS_DEMO.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
          </select>
        </div>

        {/* ---------- 1 · Enrolement ---------- */}
        <section aria-labelledby="t-enrolement" className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div id="t-enrolement">
            <EnteteSection
              numero="1"
              titre="Enrôlement de l'appareil"
              description="Génère une paire ECDSA P-256 dans ce navigateur. La clé privée est non-extractable et reste dans IndexedDB ; seule la clé publique est transmise au serveur."
            />
          </div>
          <div className="mt-5 space-y-5">
            <div>
              <label htmlFor="device" className="block text-sm font-medium text-slate-900">Description de l'appareil</label>
              <p id="device-aide" className="mt-1 text-xs text-slate-500">Informatif uniquement — ne joue aucun rôle de sécurité.</p>
              <input
                id="device" type="text" aria-describedby="device-aide"
                value={deviceInfo} onChange={(e) => setDeviceInfo(e.target.value)}
                className={`mt-2 ${CLASSES_CHAMP}`}
              />
            </div>
            <button type="button" onClick={handleEnrolement} disabled={statutEnrolement === 'en-cours'} className={CLASSES_BOUTON_PRIMAIRE}>
              {statutEnrolement === 'en-cours' ? 'Enrôlement en cours…' : "Générer une clé et s'enrôler"}
            </button>
          </div>
          <div aria-live="polite">
            <BlocResultat statut={statutEnrolement} resultat={resultatEnrolement} titreSucces="Enrôlement réussi" />
          </div>
        </section>

        {/* ---------- 2 · Seance, cote formateur ---------- */}
        <section aria-labelledby="t-seance" className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div id="t-seance">
            <EnteteSection
              numero="2"
              titre="Séance — affichage formateur"
              description="Ouvre une séance et affiche son QR code. Le jeton est renouvelé toutes les 20 secondes par le serveur ; le QR se met à jour automatiquement."
            />
          </div>

          <div className="mt-5 space-y-4">
            <button type="button" onClick={handleOuvrirSeance} disabled={statutSeance === 'en-cours'} className={CLASSES_BOUTON_SECONDAIRE}>
              {statutSeance === 'en-cours' ? 'Ouverture…' : seanceId ? 'Ouvrir une nouvelle séance' : 'Ouvrir une séance de test'}
            </button>

            {seanceId && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                {/* Pastille doublee d'un texte : une information transmise par
                    la seule couleur serait inaccessible (WCAG 1.4.1). */}
                <span aria-hidden="true" className={`inline-block size-2 rounded-full ${wsConnecte ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                {wsConnecte ? 'WebSocket connecté' : 'WebSocket déconnecté'} — séance{' '}
                <code className="font-mono">{seanceId}</code>
              </p>
            )}

            {jeton && (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white p-6">
                {/* Fond blanc et marge (level M, includeMargin) imposes par la
                    norme QR : sans zone de silence suffisante ni contraste
                    franc, un lecteur peine a localiser les motifs de
                    reperage. Rendu en SVG plutot qu'en canvas : net a toute
                    taille, y compris videoprojete. */}
                <QRCodeSVG value={jeton} size={224} level="M" marginSize={2} className="h-auto w-full max-w-56" />
                <p className="text-center text-xs text-slate-500">
                  Renouvelé toutes les 20 s · TTL 25 s
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ---------- 3 · Scan, cote etudiant ---------- */}
        <section aria-labelledby="t-scan" className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div id="t-scan">
            <EnteteSection
              numero="3"
              titre="Scan — côté étudiant"
              description="Scanne le QR code avec la caméra, signe le jeton obtenu avec la clé privée de cet appareil, puis l'envoie au serveur."
            />
          </div>

          <div className="mt-5 space-y-4">
            {scannerOuvert ? (
              <QRScanner onDetection={handleQRDetecte} onAnnuler={fermerScanner} />
            ) : (
              <button
                type="button"
                onClick={() => { setScannerOuvert(true); setStatutScan('repos'); setResultatScan(null); }}
                disabled={statutScan === 'en-cours'}
                className={CLASSES_BOUTON_PRIMAIRE}
              >
                {statutScan === 'en-cours' ? 'Validation en cours…' : 'Scanner le QR code'}
              </button>
            )}

            {/* Repli manuel : conserve volontairement. Un poste sans camera,
                une permission refusee au niveau du systeme, ou une
                demonstration a distance rendraient sinon le scan impossible
                a tester -- et la saisie manuelle reste le seul moyen de
                reproduire un cas d'erreur precis (jeton expire, altere). */}
            {!scannerOuvert && (
              <div>
                <button
                  type="button"
                  onClick={() => setSaisieManuelle((v) => !v)}
                  aria-expanded={saisieManuelle}
                  className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                >
                  {saisieManuelle ? 'Masquer la saisie manuelle' : 'Saisir le jeton manuellement (sans caméra)'}
                </button>

                {saisieManuelle && (
                  <div className="mt-3 space-y-3">
                    <label htmlFor="jeton-manuel" className="block text-sm font-medium text-slate-900">
                      Jeton de séance (JWT)
                    </label>
                    <textarea
                      id="jeton-manuel" rows={4}
                      value={jetonSaisi} onChange={(e) => setJetonSaisi(e.target.value)}
                      placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…"
                      className={`resize-y font-mono text-xs break-all ${CLASSES_CHAMP}`}
                    />
                    <button
                      type="button"
                      onClick={() => envoyerScan(jetonSaisi)}
                      disabled={statutScan === 'en-cours' || jetonSaisi.trim().length === 0}
                      className={CLASSES_BOUTON_SECONDAIRE}
                    >
                      Signer et envoyer
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div aria-live="polite">
            <BlocResultat statut={statutScan} resultat={resultatScan} titreSucces="Présence validée" />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
