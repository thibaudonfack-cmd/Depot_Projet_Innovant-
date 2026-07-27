# frontend/

Interface d'enrôlement d'appareil du prototype de présence numérique
(React + Vite, Étape 4). Voir `ANALYSE_CODE.md` et `TESTING.md` à la racine
du dépôt pour la documentation architecturale et le protocole de test —
ce sous-dossier ne duplique pas cette documentation.

Ne se lance jamais directement (`npm run dev` en local hors Docker) pour
tester l'enrôlement réel : `window.crypto.subtle` (WebCrypto) exige un
contexte sécurisé, garanti ici uniquement via le reverse proxy HTTPS Caddy
(`docker compose up -d`, cf. README racine).
