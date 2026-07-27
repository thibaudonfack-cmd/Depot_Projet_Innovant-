// src/App.jsx
// Demo minimale d'enrolement d'appareil (Etape 4, RF-07/RF-09). Sert deux
// buts : demontrer visuellement que la chaine complete fonctionne (generation
// de cle -> IndexedDB -> POST /api/enrolements -> reponse backend), et servir
// de point d'entree pour le protocole de test manuel (cf. TESTING.md) --
// meme si CryptoService expose aussi ses fonctions sur `window` en
// developpement pour un appel direct depuis la console.

import { useState } from 'react';
import { generateAndStoreKeyPair, exportPublicKey } from './services/CryptoService';
import './App.css';

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
  // securite -- seule la cle publique ECDSA joue ce role). L'etudiant peut
  // librement modifier ce champ avant l'enrolement.
  const ua = navigator.userAgent || '';
  const navigateur = ['Firefox', 'Edg', 'Chrome', 'Safari'].find((n) => ua.includes(n)) || 'Navigateur inconnu';
  return `${navigator.platform || 'Appareil'} - ${navigateur}`;
}

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
    <main className="enrolement">
      <h1>Enrolement d'appareil</h1>
      <p>
        Prototype de présence numérique — Étape 4. Génère une paire de clés
        ECDSA P-256 localement (clé privée non-extractable, stockée dans
        IndexedDB, jamais transmise), puis envoie uniquement la clé publique
        au backend.
      </p>

      <div className="champ">
        <label htmlFor="etudiant">Étudiant (jeu de données de démonstration)</label>
        <select id="etudiant" value={etudiantId} onChange={(e) => setEtudiantId(e.target.value)}>
          {ETUDIANTS_DEMO.map((etudiant) => (
            <option key={etudiant.id} value={etudiant.id}>{etudiant.nom}</option>
          ))}
        </select>
      </div>

      <div className="champ">
        <label htmlFor="device">Description de l'appareil</label>
        <input
          id="device"
          type="text"
          value={deviceInfo}
          onChange={(e) => setDeviceInfo(e.target.value)}
        />
      </div>

      <button type="button" onClick={handleEnrolement} disabled={statut === 'en-cours'}>
        {statut === 'en-cours' ? 'Enrôlement en cours…' : "Générer une clé et s'enrôler"}
      </button>

      {statut === 'succes' && (
        <pre className="resultat succes">{JSON.stringify(resultat, null, 2)}</pre>
      )}
      {statut === 'erreur' && (
        <pre className="resultat erreur">Erreur : {resultat.message}</pre>
      )}
    </main>
  );
}

export default App;
