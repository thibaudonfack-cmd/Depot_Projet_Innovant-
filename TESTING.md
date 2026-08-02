# TESTING.md — Protocole de validation

Protocole de test manuel, à exécuter sur ta machine (Docker n'est pas
disponible dans l'environnement où le code a été écrit — voir `ANALYSE_CODE.md`
pour les tests déjà effectués sans Docker : intégrité des clés, signature
RS256, logique du serveur Express en dehors du conteneur).

Chaque section indique la commande exacte, le résultat exact attendu, et ce
qu'il faut faire si le résultat diffère.

---

## 0. Prérequis

```bash
docker --version
docker compose version
git --version
```

Attendu : trois versions affichées sans erreur. Docker Desktop doit être
démarré (icône active dans la barre des tâches/menu).

---

## 1. Récupération du code (branche `dev`)

```bash
git clone git@github.com:thibaudonfack-cmd/Depot_Projet_Innovant-.git
cd Depot_Projet_Innovant-
git checkout dev
git log --oneline
```

Attendu : au moins 3 commits sur `dev` (scaffolding Partie 1 + doc + Partie 2),
en plus de l'`Initial commit` hérité de `main`.

---

## 2. Préparation de l'environnement

```bash
cp .env.example .env
./generate_keys.sh
```

Attendu :
```
Génération de la clé privée RSA 2048 bits (RS256)...
Extraction de la clé publique correspondante...

Clés générées avec succès :
  Privée  : .../keys/private.pem (permissions 600, exclue de Git par .gitignore)
  Publique : .../keys/public.pem (permissions 644, diffusable aux vérificateurs tiers)
```

Vérification : `ls keys/` doit lister `private.pem` et `public.pem`.
`git status` doit rester silencieux sur `.env` et `keys/` (ignorés).

---

## 3. Validation de la configuration avant démarrage

```bash
docker compose config
```

Attendu : un YAML complet, résolu, sans `${...}` restant en clair (toutes les
variables du `.env` doivent apparaître substituées par leur valeur). Si une
variable apparaît vide ou non résolue, le fichier `.env` est incomplet.

---

## 4. Démarrage complet

```bash
docker compose up -d --build
```

Attendu (ordre indicatif, peut varier) :
```
[+] Running 4/4
 ✔ Network ...presence_net       Created
 ✔ Container presence_mysql      Started
 ✔ Container presence_backend    Started
 ✔ Container presence_proxy      Started
```

Le `--build` force la (re)construction de l'image backend à partir du
`Dockerfile` — nécessaire au premier lancement ou après toute modification de
`backend/`.

---

## 5. Vérification de l'état des conteneurs

```bash
docker compose ps
```

Attendu : trois lignes, `STATUS` :
- `presence_mysql` → `Up ... (healthy)` (peut afficher `(health: starting)`
  pendant les 20-30 premières secondes — attendre et relancer la commande)
- `presence_backend` → `Up ...`
- `presence_proxy` → `Up ...`

Si `presence_backend` n'est pas `Up` : voir section 9 (dépannage).

---

## 6. Logs du proxy — preuve que le certificat local est émis

```bash
docker compose logs proxy
```

Attendu, entre autres lignes JSON structurées de Caddy : une mention de
l'émission d'un certificat par l'autorité interne, du type :
```
"msg":"certificate obtained successfully","identifier":"localhost"
```
ou, au redémarrage suivant (certificat déjà émis et persisté dans le volume
`caddy_data`) :
```
"msg":"loaded certificate","identifiers":["localhost"]
```
Aucune ligne contenant `"level":"error"` liée à `tls` ne doit apparaître.

---

## 7. Logs du backend

```bash
docker compose logs backend
```

Attendu :
```
Backend demarre sur le port 3000
```
Sans erreur `Error: listen EADDRINUSE` ni trace de crash (`node:internal`).

---

## 8. Test de la route de santé — en ligne de commande

```bash
curl -k https://localhost/api/health
```

Le flag `-k` (`--insecure`) est nécessaire ici : il indique à `curl` de ne pas
vérifier l'autorité du certificat, exactement pour la raison expliquée dans
`ANALYSE_CODE.md` (CA interne de Caddy, non approuvée par défaut par l'hôte).
Ce n'est pas un contournement de bug, c'est le comportement attendu à ce stade.

Attendu, exactement :
```json
{"status":"ok","message":"Backend is running securely"}
```

Variante avec le second nom d'hôte configuré :
```bash
curl -k https://api.localhost/api/health
```
Même résultat attendu.

**Test du routage HTTP → HTTPS** :
```bash
curl -I http://localhost/api/health
```
Attendu : un en-tête `HTTP/1.1 308 Permanent Redirect` (ou `301`) avec un
`Location: https://localhost/api/health` — Caddy force la bascule vers TLS.

**Test de la route par défaut (hors `/api/*`)** :
```bash
curl -k https://localhost/
```
Attendu :
```
Proxy Caddy actif. API disponible sous /api/*
```

---

## 9. Test dans le navigateur — et l'avertissement de certificat attendu

Ouvrir `https://localhost/api/health` dans le navigateur.

**Avertissement attendu au premier accès** (normal, pas un échec) :

| Navigateur | Message affiché |
|---|---|
| Chrome / Edge | « Votre connexion n'est pas privée » — code `NET::ERR_CERT_AUTHORITY_INVALID` |
| Firefox | « Avertissement : risque de sécurité potentiel » — `SEC_ERROR_UNKNOWN_ISSUER` |
| Safari | « Cette connexion n'est pas privée » |

C'est attendu : la CA de Caddy (générée dans le conteneur) n'est pas dans le
magasin de confiance de ton système. Cliquer sur « Paramètres avancés » (Chrome)
ou « Avancé » puis « Accepter le risque et continuer » (Firefox) pour
poursuivre. La page doit ensuite afficher exactement le JSON de la section 8.

**Pour supprimer cet avertissement proprement (facultatif, non requis pour
valider cette étape)** :

```bash
docker compose exec proxy cat /data/caddy/pki/authorities/local/root.crt > caddy-root-ca.crt
```

Puis importer `caddy-root-ca.crt` dans le magasin de certificats de confiance
du système (Windows : double-clic → Installer le certificat → Autorités de
certification racines de confiance) ou du navigateur (Firefox : Paramètres →
Vie privée et sécurité → Certificats → Importer). Après import, recharger la
page : le cadenas doit apparaître sans avertissement.

---

## 10. Non-exposition directe du backend et de MySQL

```bash
curl -m 3 http://localhost:3000/api/health
```
Attendu : échec de connexion (`Connection refused` ou timeout) — le backend
n'est volontairement pas publié en dehors du réseau Docker interne.

Sous Windows (PowerShell), vérifier qu'aucun processus n'écoute sur 3306 ou
3000 côté hôte :
```powershell
netstat -an | findstr "3000 3306"
```
Attendu : aucune ligne en `LISTENING`. Seuls 80 et 443 (Caddy) doivent
apparaître.

---

## 11. Persistance entre redémarrages

```bash
docker compose restart proxy
docker compose logs proxy | tail -5
```
Attendu : le message `"msg":"loaded certificate"` (pas `"certificate
obtained successfully"` à nouveau) — preuve que le volume `caddy_data` a bien
conservé la CA et le certificat entre deux démarrages du conteneur.

---

## 12. Régression — MySQL toujours fonctionnel (Partie 1)

```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p -e "SHOW DATABASES;"
```
(mot de passe : celui du `.env`, variable `MYSQL_PASSWORD`)

Attendu : `db_logs` apparaît dans la liste — la brique validée en Partie 1
n'a pas été cassée par l'ajout du proxy et du backend.

---

## 13. Arrêt propre

```bash
docker compose down
```
Attendu : les trois conteneurs et le réseau `presence_net` sont supprimés ;
les volumes nommés (`mysql_data`, `caddy_data`, `caddy_config`) restent
présents (`docker volume ls` doit encore les lister).

---

## 14. Dépannage rapide

| Symptôme | Cause probable | Action |
|---|---|---|
| `presence_backend` redémarre en boucle | Erreur dans `server.js` ou dépendance manquante | `docker compose logs backend` pour voir la stack trace |
| `curl -k https://localhost/api/health` renvoie une erreur 502 | Le backend n'est pas encore prêt ou a crashé | Vérifier `docker compose ps` puis les logs backend |
| Le port 443 est déjà utilisé | Un autre service (IIS, Skype, un ancien conteneur) occupe le port | `docker compose down` sur tout autre projet, ou changer temporairement le mapping de port dans `docker-compose.yml` |
| `docker compose config` échoue avec une variable vide | `.env` incomplet ou non copié depuis `.env.example` | Refaire `cp .env.example .env` et vérifier chaque valeur |
| `backend` crash en boucle avec `ENOENT ... open '/keys/private.pem'` (chemin SANS `/app`) | `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` absentes de l'environnement du service `backend` (bug latent depuis l'Étape 2, corrigé — voir Annexe A) ou `.env`/`keys/` supprimés localement (ex. `git clean -fd`) | `git pull origin dev` pour récupérer le correctif, puis suivre le protocole de relance complet de l'Annexe A |

---

## Critère de succès global — Étape 0.2

L'étape est validée si, et seulement si, **toutes** les sections 3 à 12
produisent le résultat attendu documenté ci-dessus, sans intervention
manuelle autre que celle explicitement décrite (y compris l'acceptation de
l'avertissement de certificat, qui fait partie du résultat attendu et non
d'un échec).

---

# Étape 1 — Modélisation DB, seed et connexion backend

Ce protocole suppose l'Étape 0.2 déjà validée (proxy, backend, réseau Docker
opérationnels). Si `docker-compose.yml` a déjà tourné une fois avec l'ancien
schéma (sans `database/`), le volume `mysql_data` existe déjà et l'entrypoint
MySQL **n'exécutera pas** les nouveaux scripts d'init (ils ne s'exécutent
qu'au tout premier démarrage d'un volume vide). Repartir de zéro si besoin :

```bash
docker compose down -v
```

`-v` supprime aussi les volumes (données MySQL et certificat Caddy) — sans
danger sur un prototype de développement, à éviter en tout autre contexte.

## 1. Mise à jour de l'environnement

```bash
git pull origin dev
cp .env.example .env    # uniquement si ton .env existant ne contient pas
                         # encore les variables MYSQL_ATTESTATIONS_*
```

Vérifier que `.env` contient bien `MYSQL_ATTESTATIONS_USER` et
`MYSQL_ATTESTATIONS_PASSWORD` avant de continuer (sinon `03-privileges.sh`
échouera au démarrage de MySQL faute de variable).

## 2. Démarrage à partir d'un volume propre

```bash
docker compose up -d --build
docker compose logs -f mysql
```

Attendu dans les logs (dans cet ordre, en clair, pas du JSON comme Caddy) :
```
[Entrypoint] ... Initializing database
...
[Entrypoint] ... /docker-entrypoint-initdb.d/01-schema.sql
[Entrypoint] ... /docker-entrypoint-initdb.d/02-seed.sql
[Entrypoint] ... /docker-entrypoint-initdb.d/03-privileges.sh
03-privileges.sh : utilisateur app_attestations cree (db_attestations uniquement) ; scans/corrections passees en ecriture seule pour app_logs.
...
[Entrypoint] ... MySQL init process done. Ready for start up.
```
`Ctrl+C` pour sortir du suivi de logs une fois cette séquence observée.
Aucune ligne `ERROR` ne doit apparaître pour ces trois scripts.

## 3. Vérification en ligne de commande MySQL — tables et seed

```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}" db_logs
```
(mot de passe demandé si non passé inline — utiliser celui du `.env`)

Dans le prompt `mysql>` :

```sql
SHOW TABLES;
```
Attendu : `appareils_enroles`, `corrections`, `etudiants`, `inscriptions`, `salles`, `scans`, `seances`, `uf` (8 tables).

```sql
SELECT COUNT(*) FROM etudiants;
```
Attendu : `4`.

```sql
SELECT id, nom, email FROM etudiants;
```
Attendu : les 4 étudiants de démonstration (Amara Diallo, Bilal Ozturk, Chiara Rossi, Driss El Amrani).

```sql
SELECT nom, JSON_PRETTY(polygone_geojson) FROM salles;
```
Attendu : `Local 12 - ESA Namur` avec un polygone GeoJSON de type `Polygon` à 5 points (le 5ᵉ referme le 1ᵉʳ).

```sql
SHOW CREATE TABLE scans\G
```
Attendu : la définition doit contenir `UNIQUE KEY uq_scan_nonce (jti,etudiant_id)`.

```sql
SHOW CREATE TABLE appareils_enroles\G
```
Attendu : doit contenir la colonne générée `actif_key` et `UNIQUE KEY uq_appareil_actif (actif_key)`.

```sql
exit
```

## 4. Vérification des privilèges séparés

```bash
docker compose exec mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "SHOW GRANTS FOR 'app_logs'@'%';"
```
Attendu, exactement (4 lignes) :
```
GRANT USAGE ON *.* TO `app_logs`@`%`
GRANT SELECT, INSERT ON `db_logs`.* TO `app_logs`@`%`
GRANT UPDATE, DELETE ON `db_logs`.`seances` TO `app_logs`@`%`
GRANT UPDATE, DELETE ON `db_logs`.`appareils_enroles` TO `app_logs`@`%`
```
Aucune ligne ne doit mentionner `db_attestations`, ni `scans`, ni
`corrections` — ces deux dernières tables ne reçoivent que le `SELECT,
INSERT` de la ligne globale sur `db_logs.*`, jamais de `GRANT` `UPDATE`/
`DELETE` dédié (c'est cette absence, et non un `REVOKE`, qui garantit leur
statut d'écriture seule — voir `ANALYSE_CODE.md` pour la note de révision sur
ce point).

```bash
docker compose exec mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "SHOW GRANTS FOR 'app_attestations'@'%';"
```
Attendu :
```
GRANT USAGE ON *.* TO `app_attestations`@`%`
GRANT SELECT, INSERT ON `db_attestations`.* TO `app_attestations`@`%`
```
Rien sur `db_logs`.

**Preuve active de l'isolement (au-delà de la lecture des GRANT)** :
```bash
docker compose exec mysql mysql -u${MYSQL_ATTESTATIONS_USER:-app_attestations} -p"${MYSQL_ATTESTATIONS_PASSWORD}" -e "SELECT COUNT(*) FROM db_logs.etudiants;"
```
Attendu : une erreur explicite, du type
`ERROR 1142 (42000): SELECT command denied to user 'app_attestations'@'...' for table 'etudiants'`
— preuve en conditions réelles, pas seulement documentaire, que la
séparation tient.

**Preuve du journal en écriture seule** :
```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}" -e "UPDATE db_logs.scans SET resultat='valide' WHERE 1=0;"
```
Attendu : `ERROR 1142 (42000): UPDATE command denied to user 'app_logs'@'...' for table 'scans'`
(la clause `WHERE 1=0` ne sélectionne aucune ligne — c'est le refus de la
commande elle-même qui est testé, pas son effet sur des données réelles).

## 5. Route `/api/health` (régression Étape 0.2)

```bash
curl -k https://localhost/api/health
```
Attendu (inchangé) : `{"status":"ok","message":"Backend is running securely"}`

## 6. Route `/api/db-health` — preuve bout en bout

```bash
curl -k https://localhost/api/db-health
```

Attendu, exactement :
```json
{"status":"ok","database":"connected","schema_initialized":true,"etudiants_count":4}
```

Si le backend a démarré avant que MySQL soit `healthy` (ne devrait pas
arriver grâce à `depends_on: condition: service_healthy`, mais à vérifier si
ce test échoue) :
```json
{"status":"error","database":"unreachable","message":"connect ECONNREFUSED ..."}
```
avec un code HTTP `500`. Dans ce cas : `docker compose logs backend` pour
confirmer l'erreur, puis `docker compose restart backend` une fois
`docker compose ps` confirme `mysql` à `(healthy)`.

## 7. Logs applicatifs du backend

```bash
docker compose logs backend
```
Ne doit contenir aucune ligne `Erreur /api/db-health` si le test 6 a réussi.
Si cette ligne apparaît malgré un test 6 réussi ensuite, c'est le signe d'une
erreur transitoire au démarrage (backend lancé avant MySQL réellement prêt) —
sans gravité si la requête suivante réussit, à signaler sinon.

## Critère de succès global — Étape 1

Validée si et seulement si : les 8 tables existent avec exactement le contenu
attendu (section 3), les deux utilisateurs MySQL ont des privilèges
strictement disjoints et ce cloisonnement est démontré activement — pas
seulement lu dans `SHOW GRANTS` (section 4), et `/api/db-health` renvoie
`etudiants_count: 4` (section 6).

---

# Étape 2 — Jeton RS256, rotation, diffusion WebSocket

Ce protocole suppose l'Étape 1 déjà validée. Nécessite un client WebSocket en
ligne de commande : `wscat` (Node, installable globalement) ou l'extension
WebSocket de Postman — les deux fonctionnent, les instructions ci-dessous
utilisent `wscat`.

```bash
npm install -g wscat
```

## 1. Redémarrage avec le nouveau code

```bash
git pull origin dev
docker compose up -d --build
docker compose ps
```

Attendu : les 3 conteneurs `Up`, `presence_mysql` `(healthy)`. Le volume
`keys/` est désormais monté sur `backend` — vérifier qu'aucune erreur de
démarrage n'apparaît :

```bash
docker compose logs backend
```

Attendu : `Backend demarre sur le port 3000`, **aucune** ligne du type
`Impossible de lire la cle privee`. Si cette erreur apparaît : vérifier que
`./generate_keys.sh` a bien été exécuté à la racine (section 2 du protocole
Étape 0.1) et que `keys/private.pem` existe sur ta machine.

## 2. Création d'une séance

```bash
curl -k -X POST https://localhost/api/seances \
  -H "Content-Type: application/json" \
  -d '{"uf_id":"11111111-1111-1111-1111-111111111111","salle_id":"22222222-2222-2222-2222-222222222222"}'
```

(ces deux UUID sont ceux du jeu de données de démonstration, `02-seed.sql`)

Attendu, exactement :
```json
{"status":"ok","seance_id":"<un-nouvel-uuid>","uf_id":"11111111-1111-1111-1111-111111111111","salle_id":"22222222-2222-2222-2222-222222222222","statut":"ouverte"}
```

**Note le `seance_id` retourné** — il sert à toutes les étapes suivantes.
Variante d'erreur à tester :
```bash
curl -k -X POST https://localhost/api/seances -H "Content-Type: application/json" -d '{}'
```
Attendu : `400` avec `{"status":"error","message":"uf_id et salle_id sont obligatoires."}`

```bash
curl -k -X POST https://localhost/api/seances \
  -H "Content-Type: application/json" \
  -d '{"uf_id":"00000000-0000-0000-0000-000000000000","salle_id":"22222222-2222-2222-2222-222222222222"}'
```
Attendu : `400` avec `{"status":"error","message":"uf_id ou salle_id inconnu (aucune ligne correspondante en base)."}` (uf_id inexistant).

**Vérification en base** :
```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}" -e "SELECT id, uf_id, salle_id, statut, date_ouverture FROM db_logs.seances;"
```
Attendu : la ligne correspondant au `seance_id` retourné par l'API, `statut = ouverte`.

## 3. Connexion WebSocket et observation de la rotation

Remplacer `<SEANCE_ID>` par la valeur obtenue en étape 2.

```bash
wscat -c "wss://localhost/api/ws/seances/<SEANCE_ID>" --no-check
```

(`--no-check` : équivalent du `-k` de `curl`, nécessaire pour la même raison
que d'habitude — certificat local Caddy non approuvé par défaut, cf. Étape
0.2/`TESTING.md`)

Attendu **immédiatement** à la connexion, un premier message :
```json
{"type":"token","token":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...."}
```

Puis **rien pendant 20 secondes**, puis un deuxième message du même format
(nouveau jeton, nouveau `jti`). Laisser tourner au moins 45 secondes pour
observer 2 à 3 rotations. Chronométrer approximativement l'écart entre deux
messages : il doit être proche de 20s (± latence réseau/traitement, quelques
centaines de ms tout au plus).

Laisser `wscat` ouvert et, dans un second terminal, vérifier les logs :
```bash
docker compose logs -f backend
```
Attendu : une ligne `[qrBroadcaster] Formateur connecte : seance=<SEANCE_ID> salle=22222222-...` à la connexion.

## 4. Vérification du contenu et de la signature d'un jeton

Copier un des jetons reçus (la valeur du champ `"token"`, sans les guillemets)
et le décoder tel quel sur [jwt.io](https://jwt.io) (décodage uniquement,
aucune donnée sensible n'est envoyée par ce site — le décodage se fait dans
le navigateur) : la partie payload doit afficher exactement 4 champs,
`session_id`, `salle_id`, `jti`, `iat`, `exp` (5 en comptant `iat`/`exp`
séparément).

**Vérification de la signature en ligne de commande** (plus rigoureux que
jwt.io, ne fait confiance qu'à ta propre clé publique locale) :

```bash
node -e "
const jwt = require('jsonwebtoken');
const fs = require('fs');
const publicKey = fs.readFileSync('keys/public.pem', 'utf8');
const token = process.argv[1];
const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
console.log(JSON.stringify(decoded, null, 2));
console.log('exp - iat =', decoded.exp - decoded.iat, '(attendu : 25)');
" "<COLLER_LE_TOKEN_ICI>"
```

(nécessite `jsonwebtoken` installé quelque part accessible — depuis
`backend/`, où il est déjà une dépendance, fonctionne directement)

Attendu : le JSON du payload s'affiche sans erreur (`jwt.verify` lève une
exception si la signature est invalide), et `exp - iat = 25` exactement.

**Test négatif — altération détectée** :
```bash
node -e "
const jwt = require('jsonwebtoken');
const fs = require('fs');
const publicKey = fs.readFileSync('keys/public.pem', 'utf8');
const token = process.argv[1] + 'X'; // alteration triviale
try {
  jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  console.log('ECHEC : aurait du etre rejete');
} catch (e) {
  console.log('OK, rejet attendu :', e.message);
}
" "<COLLER_LE_TOKEN_ICI>"
```
Attendu : `OK, rejet attendu : invalid signature` (ou message équivalent).

## 5. Fermeture de connexion et nettoyage de l'intervalle

Dans `wscat`, `Ctrl+C` pour fermer la connexion. Vérifier immédiatement après :
```bash
docker compose logs backend | tail -5
```
Attendu : une ligne `[qrBroadcaster] Rotation arretee pour la seance <SEANCE_ID> (deconnexion formateur).`

**Preuve qu'il n'y a pas de fuite** : rouvrir puis refermer `wscat` sur la
même séance 3-4 fois de suite, rapidement. Chaque ouverture doit produire
exactement une ligne `Formateur connecte`, chaque fermeture exactement une
ligne `Rotation arretee`. Laisser passer 30 secondes après la dernière
fermeture puis vérifier qu'aucun nouveau message `[qrBroadcaster]` n'apparaît
dans les logs — un intervalle mal nettoyé continuerait à logguer/générer des
jetons même sans connexion active.

## 6. Cas d'erreur : séance inexistante ou clôturée

```bash
wscat -c "wss://localhost/api/ws/seances/00000000-0000-0000-0000-000000000000" --no-check
```
Attendu : la connexion est immédiatement refusée (`wscat` affiche une erreur
du type `error: Unexpected server response: 404`), aucun message `token` n'est
jamais reçu.

## Critère de succès global — Étape 2

Validée si et seulement si : `POST /api/seances` crée bien une ligne en base
et retourne son `id` (section 2), la connexion WebSocket reçoit un jeton
immédiatement puis un nouveau toutes les ~20s (section 3), la signature de
chaque jeton est vérifiable avec la seule clé publique et `exp - iat = 25`
exactement (section 4), et l'intervalle de rotation s'arrête proprement à la
déconnexion sans laisser de trace résiduelle dans les logs (section 5).

---

# Stratégie de test automatisé (Jest/Supertest) et CI

Ce protocole complète (il ne remplace pas) les tests manuels des sections
précédentes. Les tests automatisés couvrent la logique déjà validée à la
main aux Étapes 1 et 2 — les rejouer à chaque `push` est tout l'intérêt de
cette section.

## 1. Lancer les tests en local

Prérequis : `docker compose up -d` déjà exécuté (MySQL doit être joignable
pour `health.test.js`), et `keys/private.pem`/`keys/public.pem` déjà générés
(`./generate_keys.sh`, Étape 0.1).

```bash
cd backend
npm install
npm test
```

**Avant tout `git push` touchant `backend/package.json` ou
`backend/package-lock.json`**, valider en plus que `npm ci` (la commande
réellement utilisée par la CI, section 3) réussit à partir d'un
`node_modules` propre :
```bash
rm -rf node_modules
npm ci
```
Contrairement à `npm install`, `npm ci` n'accepte aucun écart entre
`package.json` et `package-lock.json` — c'est un test de synchronisation du
lockfile, pas juste une installation. Le faire en local avant de pousser
évite de découvrir la désynchronisation seulement après un aller-retour de
pipeline (cf. `ANALYSE_CODE.md`, section « Fix CI : package-lock.json
désynchronisé »).

Attendu, exactement (l'ordre des suites peut varier) :
```
PASS tests/tokenService.test.js
  tokenService.generateSessionToken
    ✓ le TTL du jeton est STRICTEMENT de 25 secondes (exp - iat)
    ✓ le payload contient un identifiant unique a usage unique (le "nonce" du cahier des charges, implemente comme revendication JWT standard "jti")
    ✓ deux jetons generes successivement ont des jti distincts (pas de reutilisation de nonce)
    ✓ le payload contient exactement les session_id et salle_id fournis
    ✓ la verification echoue si on force HS256 avec la cle publique comme secret (anti algorithm-confusion)
    ✓ leve une erreur explicite si sessionId ou salleId est manquant
    ✓ rotation (20s) et TTL (25s) respectent le recouvrement de 5s acte lors de la revue de coherence

PASS tests/health.test.js
  GET /api/health
    ✓ repond 200, sante applicative pure sans dependance a la base
  GET /api/db-health
    ✓ repond 200 et confirme la connexion + le schema initialise avec le seed attendu

Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
```

**Si `health.test.js` échoue avec `Expected: 200, Received: 500`** : MySQL
n'est pas joignable depuis ta machine avec les variables d'environnement
actuelles. Vérifier `docker compose ps` (le service `mysql` doit être
`healthy`) et que les variables `MYSQL_*` de ton shell (ou d'un `.env`
chargé) correspondent à celles du conteneur.

**Aucun avertissement de ce type ne doit apparaître** :
```
Jest has detected the following 1 open handle potentially keeping Jest from exiting
```
S'il apparaît, un `pool.end()`/nettoyage manque quelque part — signaler,
ne pas ignorer (c'est précisément ce que `detectOpenHandles: true` est
configuré pour révéler, cf. `jest.config.js`).

## 2. Vérifier que le test attrape vraiment la règle des 25 secondes

Modifier temporairement `TOKEN_TTL_SECONDS` dans
`backend/src/services/tokenService.js` (par exemple `20` au lieu de `25`),
relancer `npm test` :
```bash
npm test -- tokenService.test.js
```
Attendu : le test `le TTL du jeton est STRICTEMENT de 25 secondes` échoue
explicitement (`Expected: 25, Received: 20`). **Remettre la valeur à `25`
immédiatement après ce test** (ne jamais laisser cette modification, elle
casserait RF-04). Cette manipulation ponctuelle prouve que le test protège
réellement la règle métier, pas seulement qu'il s'exécute sans erreur.

## 3. Déclencher la pipeline GitLab CI

Après un `git push` vers `dev` ou `main`, ou l'ouverture d'une Merge
Request : ouvrir l'onglet **CI/CD > Pipelines** du projet GitLab. Une
pipeline avec un seul job, `test_backend`, doit se déclencher automatiquement.

**Étapes attendues dans les logs du job** (accessible en cliquant sur le
job) :
```
$ apt-get update -qq && apt-get install -y -qq default-mysql-client
$ ./generate_keys.sh
Génération de la clé privée RSA 2048 bits (RS256)...
...
$ En attente de MySQL... (tentative 1/30)     [ou directement OK si rapide]
$ mysql -h "$MYSQL_HOST" -u root -p"$MYSQL_ROOT_PASSWORD" < database/01-schema.sql
$ mysql -h "$MYSQL_HOST" -u root -p"$MYSQL_ROOT_PASSWORD" < database/02-seed.sql
$ bash database/03-privileges.sh
03-privileges.sh : privileges mis en place avec succes !
$ cd backend
$ npm ci
$ npm test
...
Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
```
Statut final du job : ✅ vert (`passed`).

**Si le job échoue à l'étape `mysqladmin ping` (boucle des 30 tentatives
épuisée)** : le service `mysql:8.0` n'a pas démarré à temps — relancer le
job manuellement (bouton "Retry") ; si l'échec persiste, vérifier dans les
paramètres du runner GitLab que les services Docker sont autorisés.

**Si le job échoue à `mysql -h "$MYSQL_HOST" ... < database/01-schema.sql`**
avec une erreur d'authentification : vérifier que la ligne `command:
["--default-authentication-plugin=mysql_native_password"]` est bien présente
sous le service `mysql:8.0` dans `.gitlab-ci.yml`.

**Si le job échoue à l'étape `npm ci` avec `Missing: <paquet>@<version>
from lock file`** : `backend/package-lock.json` n'est plus synchronisé avec
`backend/package.json` (typiquement après une modification des dépendances
committée sans revalidation locale). Corriger en local — jamais en éditant
le lockfile à la main :
```bash
cd backend
rm -rf node_modules package-lock.json
npm install
rm -rf node_modules && npm ci   # doit reussir sans aucune re-resolution
```
puis committer le `package-lock.json` régénéré. Voir `ANALYSE_CODE.md`,
section « Fix CI : package-lock.json désynchronisé », pour le détail de
cette classe d'incident et pourquoi `npm ci` est volontairement strict.

## Critère de succès global — Stratégie de test et CI

Validée si et seulement si : `npm test` en local produit 9/9 tests réussis
sans avertissement de handle ouvert (section 1), le test du TTL échoue
explicitement quand la constante est altérée puis repasse au vert une fois
restaurée (section 2), et la pipeline GitLab CI s'exécute automatiquement
sur un `push` vers `dev`/`main` ou l'ouverture d'une Merge Request, avec les
9 mêmes tests validés contre un MySQL entièrement provisionné par les
scripts du projet (section 3).

---

# Étape 3 — Cascade de validation d'un scan (RF-12)

Ce protocole suppose l'Étape 2 déjà validée (jeton RS256, WebSocket) et
`docker compose up -d --build` déjà exécuté avec le code de cette étape.
Ferme V1 (jeton expiré) et V4 (rejeu) — le géofencing et l'authentification
par appareil (RF-07/RF-13) ne sont volontairement PAS couverts ici (cf.
`ANALYSE_CODE.md`, section Étape 3, « Objectif et périmètre exact »).

## 1. Redémarrage avec le nouveau code

```bash
git pull origin dev
docker compose up -d --build
docker compose logs backend | tail -5
```
Attendu : `Backend demarre sur le port 3000`, aucune erreur.

## 2. Créer une séance et générer un jeton valide

```bash
curl -k -X POST https://localhost/api/seances \
  -H "Content-Type: application/json" \
  -d '{"uf_id":"11111111-1111-1111-1111-111111111111","salle_id":"22222222-2222-2222-2222-222222222222"}'
```
Noter le `seance_id` retourné (`<SEANCE_ID>` ci-dessous).

Plutôt que d'ouvrir une connexion WebSocket et copier un jeton au vol
(Étape 2, section 3), générer directement un jeton pour cette séance en
exécutant le même code que le backend, **à l'intérieur du conteneur**
(mêmes clés, mêmes variables d'environnement) :
```bash
docker compose exec backend node -e "
const { generateSessionToken } = require('./src/services/tokenService');
console.log(generateSessionToken('<SEANCE_ID>', '22222222-2222-2222-2222-222222222222'));
"
```
Attendu : une chaîne JWT compacte (`eyJhbGciOiJSUzI1NiIs...`) s'affiche.
Copier cette valeur (`<JETON>` ci-dessous) — elle sert aux sections 3 à 5.

## 3. Cas nominal — scan accepté

```bash
curl -k -X POST https://localhost/api/scans \
  -H "Content-Type: application/json" \
  -d '{"jeton":"<JETON>","etudiant_id":"33333333-3333-3333-3333-333333333331"}'
```
Attendu, exactement (le `scan_id` change à chaque exécution) :
```json
{"status":"ok","scan_id":"<uuid>","seance_id":"<SEANCE_ID>","etudiant_id":"33333333-3333-3333-3333-333333333331","resultat":"valide"}
```
Code HTTP : `201`.

**Vérification en base** :
```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}" \
  -e "SELECT id, seance_id, etudiant_id, jti, resultat FROM db_logs.scans WHERE seance_id='<SEANCE_ID>';"
```
Attendu : une ligne, `resultat = valide`.

## 4. Cas d'échec V4 — rejeu du même jeton

Rejouer **exactement la même commande** que la section 3, avec le même `<JETON>` :
```bash
curl -k -X POST https://localhost/api/scans \
  -H "Content-Type: application/json" \
  -d '{"jeton":"<JETON>","etudiant_id":"33333333-3333-3333-3333-333333333331"}'
```
Attendu, exactement :
```json
{"status":"error","code":"REJEU_DETECTE","message":"Ce jeton a deja ete utilise par cet etudiant (rejeu detecte)."}
```
Code HTTP : `409`. Vérifier qu'**aucune deuxième ligne** n'a été ajoutée en
base (rejouer la requête SQL de la section 3 : toujours une seule ligne).

**Variante — même jeton, étudiant différent** (le rejeu est bloqué par
étudiant, pas globalement — cf. `UNIQUE(jti, etudiant_id)` et non
`UNIQUE(jti)` seul) :
```bash
curl -k -X POST https://localhost/api/scans \
  -H "Content-Type: application/json" \
  -d '{"jeton":"<JETON>","etudiant_id":"33333333-3333-3333-3333-333333333332"}'
```
Attendu : `201` (accepté — un autre étudiant scannant le même jeton affiché
dans la même salle est un usage légitime, pas un rejeu).

## 5. Cas d'échec V1 — jeton expiré

Générer un jeton dont l'expiration est déjà dépassée (même clé privée,
`expiresIn` négatif) :
```bash
docker compose exec backend node -e "
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const privateKey = fs.readFileSync(process.env.JWT_PRIVATE_KEY_PATH, 'utf8');
console.log(jwt.sign(
  { session_id: '<SEANCE_ID>', salle_id: '22222222-2222-2222-2222-222222222222' },
  privateKey,
  { algorithm: 'RS256', expiresIn: '-10s', jwtid: crypto.randomUUID() }
));
"
```
Puis :
```bash
curl -k -X POST https://localhost/api/scans \
  -H "Content-Type: application/json" \
  -d '{"jeton":"<JETON_EXPIRE>","etudiant_id":"33333333-3333-3333-3333-333333333333"}'
```
Attendu, exactement :
```json
{"status":"error","code":"JETON_EXPIRE","message":"Jeton expire : rescannez le QR code actuellement affiche."}
```
Code HTTP : `401`. Alternative en conditions réelles (sans forcer `expiresIn`) :
générer un jeton via la section 2, attendre 26 secondes réelles, puis
soumettre — même résultat attendu.

## 6. Cas d'échec — signature invalide et champs manquants

**Jeton altéré** (même principe qu'Étape 2, section 4 — une modification
triviale de la chaîne invalide la signature) :
```bash
curl -k -X POST https://localhost/api/scans \
  -H "Content-Type: application/json" \
  -d '{"jeton":"<JETON>X","etudiant_id":"33333333-3333-3333-3333-333333333331"}'
```
Attendu : `401` avec `"code":"JETON_INVALIDE"`.

**Champs manquants** :
```bash
curl -k -X POST https://localhost/api/scans -H "Content-Type: application/json" -d '{}'
```
Attendu : `400` avec `{"status":"error","message":"jeton et etudiant_id sont obligatoires."}`

## 7. Tests automatisés (Jest/Supertest)

**Commande exacte** (à l'intérieur du conteneur, jamais sur la machine hôte
directement — cf. section 9 ci-dessous pour ce qui se passe si tu oublies) :
```bash
docker compose exec backend npm test -- scan.test.js
```
Attendu : 6 tests verts (nominal, V1, signature invalide, V4, double scan,
champs manquants) — cf. `backend/tests/scan.test.js`. Ce fichier est détecté
automatiquement par `jest.config.js` (`testMatch: ['**/tests/**/*.test.js']`,
aucune modification nécessaire) et s'exécute donc aussi bien en local que
dans la pipeline GitLab CI (`.gitlab-ci.yml`, job `test_backend`, également
inchangé) — vérifier sur l'onglet **CI/CD > Pipelines** de GitLab qu'un
nouveau pipeline déclenché par ce push affiche bien `15 passed, 15 total`
dans les logs du job.

## 8. Règle métier de présence — double scan avec deux jetons différents

Suite de la section 2 : générer un **second** jeton pour la même séance
(nouvelle rotation ou nouvel appel manuel) :
```bash
docker compose exec backend node -e "
const { generateSessionToken } = require('./src/services/tokenService');
console.log(generateSessionToken('<SEANCE_ID>', '22222222-2222-2222-2222-222222222222'));
"
```
Avec un étudiant qui n'a **pas encore** scanné pour cette séance (par
exemple `33333333-3333-3333-3333-333333333334`, en supposant les sections 3
et 4 déjà exécutées avec d'autres étudiants) :
```bash
curl -k -X POST https://localhost/api/scans \
  -H "Content-Type: application/json" \
  -d '{"jeton":"<PREMIER_JETON>","etudiant_id":"33333333-3333-3333-3333-333333333334"}'
```
Attendu : `201`. Puis, avec le **second** jeton (différent, `jti` différent,
mais lui aussi parfaitement valide) et le **même** étudiant :
```bash
curl -k -X POST https://localhost/api/scans \
  -H "Content-Type: application/json" \
  -d '{"jeton":"<SECOND_JETON>","etudiant_id":"33333333-3333-3333-3333-333333333334"}'
```
Attendu, exactement :
```json
{"status":"error","code":"DOUBLE_SCAN","message":"Presence deja validee pour cette seance."}
```
Code HTTP : `409`. **Point clé à vérifier** : ce rejet n'est pas un rejeu
(les deux jetons ont des `jti` différents — vérifiable en les décodant sur
[jwt.io](https://jwt.io)) — c'est la règle métier d'unicité de présence
(`uq_scan_presence`, distincte de `uq_scan_nonce`) qui agit ici, cf.
`ANALYSE_CODE.md`.

**Si ce test échoue** (le second scan est accepté au lieu d'être rejeté) :
le volume `mysql_data` a probablement été initialisé **avant** ce correctif
et ne contient donc pas encore la contrainte `uq_scan_presence` — cf.
section 9 (dépannage) pour la procédure de reset.

## 9. Robustesse — `db.js` refuse de démarrer sans les variables MySQL

Simuler l'erreur qui a motivé ce correctif (lancer le code hors de Docker,
sans variables d'environnement) :
```bash
cd backend
env -i PATH="$PATH" node -e "require('./src/config/db.js')"
```
Attendu, exactement (et non plus une erreur MySQL du type `Access denied
for user ''@'...'`) :
```
Error: Variables d'environnement DB manquantes (MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD) -- Executez-vous le code dans Docker ? ...
```
Le process se termine immédiatement (code de sortie non nul), avant toute
tentative de connexion réseau à MySQL.

## Critère de succès global — Étape 3

Validée si et seulement si : le scan nominal (section 3) est accepté et
visible en base ; le rejeu exact du même jeton par le même étudiant
(section 4) est rejeté en 409 `REJEU_DETECTE` sans créer de deuxième ligne,
tandis que le même jeton par un étudiant différent est accepté ; un jeton
expiré (section 5) est rejeté en 401 avec le code `JETON_EXPIRE` ; un jeton
altéré (section 6) est rejeté en 401 avec le code `JETON_INVALIDE` ; deux
jetons différents et valides pour le même étudiant/même séance (section 8)
donnent `201` puis `409 DOUBLE_SCAN` ; `db.js` refuse de démarrer avec un
message explicite en l'absence des variables `MYSQL_*` critiques (section
9) ; et `docker compose exec backend npm test` (section 7) confirme ces 6
scénarios en automatisé, aussi bien en local qu'en CI (`15 passed, 15
total`).

---

# Étape 4 — Enrôlement cryptographique des appareils

Ce protocole suppose l'Étape 3 déjà validée. Nouveau prérequis : après
`git pull origin dev`, comme `01-schema.sql` a changé (colonne
`info_appareil`), un volume déjà initialisé doit être recréé :
```bash
docker compose down -v
docker compose up -d --build
docker compose ps
```
Attendu : **quatre** conteneurs désormais (`presence_mysql`,
`presence_backend`, `presence_frontend`, `presence_proxy`), tous `Up`
(`presence_mysql` en `healthy` après quelques secondes).

## 1. Le frontend répond bien derrière Caddy, en HTTPS

```bash
curl -k -o /dev/null -s -w "%{http_code}
" https://localhost/
```
Attendu : `200`. Puis, dans un navigateur (pas seulement `curl` — le test
suivant a besoin d'un vrai moteur JS) : ouvrir `https://localhost/`.
Avertissement de certificat attendu, comme depuis l'Étape 0.2 (accepter
pour continuer). La page « Enrôlement d'appareil » doit s'afficher, avec un
menu déroulant d'étudiants de démonstration, un champ de description
d'appareil, et un bouton « Générer une clé et s'enrôler ».

**Vérifier que le rechargement à chaud (HMR) fonctionne** (preuve que
`vite.config.js`/`hmr.clientPort` est correctement traversé par Caddy) :
modifier un texte dans `frontend/src/App.jsx`, enregistrer — la page doit se
mettre à jour dans le navigateur **sans rechargement complet**, en moins
d'une seconde. Si la page se recharge entièrement (ou pas du tout), inspecter
la console : une erreur de connexion WebSocket vers un port différent de 443
indique un problème de configuration HMR, pas un bug fonctionnel de
l'enrôlement lui-même.

## 2. Enrôlement via l'interface

Choisir un étudiant dans le menu déroulant, cliquer sur « Générer une clé et
s'enrôler ». Attendu : après un court instant, un bloc de résultat vert
s'affiche avec un JSON du type :
```json
{
  "status": "ok",
  "appareil_id": "<uuid>",
  "etudiant_id": "33333333-3333-3333-3333-333333333331",
  "statut": "actif",
  "appareil_precedent_revoque": false
}
```
Cliquer une seconde fois sur le bouton (même étudiant) : `appareil_precedent_revoque`
doit désormais valoir `true` — preuve que la règle RF-09 (un seul appareil
actif) fonctionne de bout en bout, pas seulement en test automatisé.

## 3. Vérification dans la console du navigateur (protocole manuel bas niveau)

Ouvrir les outils de développement (F12) sur `https://localhost/`, onglet
Console. `CryptoService` est exposé sur `window` en mode développement :
```js
const paire = await window.CryptoService.generateAndStoreKeyPair();
paire.privateKey.extractable   // attendu : false
paire.publicKey.extractable    // attendu : true
const pem = await window.CryptoService.exportPublicKey();
console.log(pem);              // attendu : "-----BEGIN PUBLIC KEY-----
...."
```
**Test négatif attendu** (preuve directe, dans le vrai navigateur, que la
clé privée ne peut pas être exportée) :
```js
await window.crypto.subtle.exportKey('pkcs8', paire.privateKey);
```
Attendu : une exception `InvalidAccessError` (`"key is not extractable"`),
levée par le moteur du navigateur lui-même — pas par du code applicatif.

## 4. Vérification dans IndexedDB (onglet Application)

Dans les outils de développement : onglet **Application** (Chrome/Edge) ou
**Stockage** (Firefox) → **IndexedDB** → `presence-appareil-db` →
`cles-cryptographiques`. Attendu : deux entrées,
`appareil-cle-privee` et `appareil-cle-publique`, chacune affichée comme un
objet `CryptoKey` (pas une chaîne, pas un JSON lisible — c'est attendu : le
navigateur affiche un objet opaque pour une clé non exportable). Recharger
entièrement la page (`F5`) puis relancer la commande de la section 3
(`window.CryptoService.exportPublicKey()`) sans regénérer de nouvelle
paire : le même PEM doit être retourné, preuve que la clé a bien persisté
d'un chargement de page à l'autre.

## 5. Vérification en base MySQL

```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}"   -e "SELECT id, etudiant_id, statut, info_appareil, date_enrolement, date_revocation FROM db_logs.appareils_enroles WHERE etudiant_id='33333333-3333-3333-3333-333333333331'\G"
```
Attendu : autant de lignes que d'enrôlements effectués pour cet étudiant
(section 2), **une seule** avec `statut: actif` (la plus récente), toutes
les autres `statut: revoque` avec `date_revocation` renseignée. La colonne
`cle_publique` (non affichée ci-dessus pour la lisibilité, à inspecter
séparément si besoin) doit contenir un bloc PEM `-----BEGIN PUBLIC
KEY-----`.

**Vérifier qu'il n'existe jamais deux lignes actives simultanément** :
```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}"   -e "SELECT etudiant_id, COUNT(*) AS nb_actifs FROM db_logs.appareils_enroles WHERE statut='actif' GROUP BY etudiant_id HAVING nb_actifs > 1;"
```
Attendu : **aucune ligne retournée** (la contrainte `uq_appareil_actif`
rend ce cas structurellement impossible, quel que soit le nombre
d'enrôlements effectués).

## 6. Tests automatisés

```bash
docker compose exec backend npm test -- enrolement.test.js
```
Attendu : 4 tests verts (premier enrôlement, remplacement RF-09, champs
manquants, `etudiant_id` inconnu). `docker compose exec backend npm test`
(sans filtre) doit désormais afficher `19 passed, 19 total` sur les 4
suites (`tokenService`, `health`, `scan`, `enrolement`).

## Critère de succès global — Étape 4

Validée si et seulement si : les quatre conteneurs démarrent proprement
après un `docker compose down -v` (section 0) ; `https://localhost/` sert
la page React (section 1), HMR fonctionnel ; un enrôlement réussi puis un
second pour le même étudiant démontrent RF-09 dans l'interface (section 2)
et en base (section 5, jamais deux actifs simultanés) ; la console du
navigateur confirme `extractable: false` sur la clé privée et l'échec de
son export (section 3) ; IndexedDB contient bien les deux clés et la clé
privée persiste entre rechargements (section 4) ; et
`docker compose exec backend npm test` confirme `23 passed, 23 total`
(section 6 — 19 tests à l'Étape 4, 23 depuis l'Étape 5 ; ce critère est
donc validé par le total courant).

---

# Étape 5 — Signature par l'appareil et boucle de vérification

Ce protocole suppose l'Étape 4 validée (appareil enrôlé). Aucun changement de
schéma à cette étape : **pas besoin de `docker compose down -v`**, un simple
`git pull` + rebuild suffit.

```bash
git pull origin dev
docker compose up -d --build
docker compose ps
```

## 1. Parcours complet dans l'interface (le plus rapide)

Ouvrir `https://localhost/`. La page comporte désormais **deux sections**
sous le sélecteur d'étudiant.

**Étape 1 — enrôler l'appareil** (si ce n'est pas déjà fait pour l'étudiant
sélectionné) : section « 1 · Enrôlement de l'appareil » → *Générer une clé et
s'enrôler*. Attendu : bloc vert avec `"statut": "actif"`.

**Étape 2 — ouvrir une séance** : section « 2 · Simulation de scan » →
*Ouvrir une séance de test*. Attendu : une pastille verte
« WebSocket connecté » avec l'identifiant de séance, et le champ « Jeton de
séance (JWT) » se remplit **automatiquement** en moins d'une seconde. Laisser
la page ouverte 25 s : le jeton doit être **remplacé** par un nouveau
(rotation toutes les 20 s, RF-05).

**Étape 3 — signer et envoyer** : *Signer et envoyer*. Attendu, bloc vert :
```json
{
  "status": "ok",
  "scan_id": "<uuid>",
  "seance_id": "<uuid>",
  "etudiant_id": "33333333-3333-3333-3333-333333333331",
  "resultat": "valide"
}
```
Ce seul parcours valide la chaîne entière : jeton signé RS256 par le serveur
→ diffusé en WebSocket → signé ECDSA par l'appareil → vérifié par le backend
avec la clé publique lue en base.

## 2. Cas d'échec à vérifier dans l'interface

**Rejeu (V4)** : recliquer sur *Signer et envoyer* sans attendre de nouveau
jeton. Attendu : `[REJEU_DETECTE] Ce jeton a deja ete utilise…` (409).

**Double scan** : attendre la rotation (nouveau jeton, `jti` différent), puis
*Signer et envoyer*. Attendu : `[DOUBLE_SCAN] Presence deja validee pour
cette seance.` (409) — le même étudiant ne peut valider qu'une présence par
séance, même avec un jeton différent et correctement signé.

**Signature d'un autre appareil (le cœur de l'Étape 5)** : changer
l'étudiant dans le sélecteur du haut **sans ré-enrôler** — la clé présente
dans IndexedDB reste celle de l'étudiant précédent — puis *Signer et
envoyer* avec un jeton frais. Attendu :
`[SIGNATURE_APPAREIL_INVALIDE] La signature de l'appareil est invalide…`
(401). C'est exactement le scénario « un tiers relaie le jeton depuis son
propre téléphone ».

**Aucun appareil enrôlé** : sélectionner un étudiant qui n'a jamais été
enrôlé (`Driss El Amrani` si les tests précédents ne l'ont pas utilisé), et
*Signer et envoyer*. Attendu :
`[AUCUN_APPAREIL_ENROLE] Aucun appareil actif n'est enrole…` (403 — et non
401 : c'est l'état du compte qui bloque, pas l'authentification).

## 3. Vérification bas niveau dans la console du navigateur

```js
// Le jeton courant est visible dans le champ de la section 2 ; on le reprend ici.
const jwt = document.getElementById('jeton').value.trim();
const signature = await window.CryptoService.signData(jwt);
console.log('Signature Base64 :', signature);
// Preuve du format BRUT r||s (IEEE P1363) et non DER :
console.log('Taille décodée :', atob(signature).length, 'octets (attendu : 64)');
```
Attendu : exactement **64 octets**. Une taille de ~70-72 octets indiquerait
du DER — format que le backend rejette (cf. `ANALYSE_CODE.md`, Étape 5,
« Le piège d'interopérabilité »).

**Test négatif — signature altérée** :
```js
const signatureCassee = btoa(atob(signature).slice(0, 63) + '\x00');
const r = await fetch('/api/scans', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    etudiant_id: '33333333-3333-3333-3333-333333333331',
    jeton: jwt,
    signature_appareil: signatureCassee,
  }),
});
console.log(r.status, await r.json());
```
Attendu : `401` et `code: "SIGNATURE_APPAREIL_INVALIDE"`.

## 4. Vérification en base

```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}" \
  -e "SELECT s.id, s.etudiant_id, s.resultat, s.horodatage, a.info_appareil
      FROM db_logs.scans s
      JOIN db_logs.appareils_enroles a
        ON a.etudiant_id = s.etudiant_id AND a.statut = 'actif'
      ORDER BY s.horodatage DESC LIMIT 5\G"
```
Attendu : les scans validés à la section 1, chacun rattaché à l'appareil
actif de son étudiant. **Aucune ligne ne doit exister** pour les tentatives
rejetées des sections 2 et 3 (signature invalide, aucun appareil) — preuve
que la vérification de signature intervient bien **avant** toute écriture.

## 5. Tests automatisés

```bash
docker compose exec backend npm test -- scan.test.js
```
Attendu : 10 tests verts, dont les 4 spécifiques à l'Étape 5 (signature d'un
autre appareil, signature syntaxiquement invalide, signature non rejouable
sur un autre jeton, étudiant sans appareil enrôlé).

```bash
docker compose exec backend npm test
```
Attendu : `23 passed, 23 total` sur 4 suites.

## Critère de succès global — Étape 5

Validée si et seulement si : le parcours complet de la section 1 aboutit à
`resultat: "valide"` avec un jeton reçu automatiquement par WebSocket ; les
quatre cas d'échec de la section 2 renvoient bien `REJEU_DETECTE` (409),
`DOUBLE_SCAN` (409), `SIGNATURE_APPAREIL_INVALIDE` (401) et
`AUCUN_APPAREIL_ENROLE` (403) ; la signature mesurée dans la console fait
exactement 64 octets (section 3) ; aucune ligne n'est écrite en base pour
les tentatives rejetées (section 4) ; et
`docker compose exec backend npm test` confirme `23 passed, 23 total`
(section 5).

---

# Étape 6 — Lecteur de QR code (caméra)

Aucun changement de schéma : pas de `docker compose down -v` nécessaire.
Le conteneur frontend doit en revanche réinstaller ses dépendances
(`jsqr`, `qrcode.react`, `vitest`) :

```bash
git pull origin dev
docker compose up -d --build
docker compose ps
```

## 1. Le piège du test sur téléphone — à lire AVANT d'essayer

Tester le scanner avec un vrai téléphone se heurte à deux obstacles réels,
indépendants du code :

1. **`localhost` ne désigne pas ton PC depuis le téléphone.** Il faut
   l'adresse LAN de la machine (`ipconfig` sous Windows), donc une URL du
   type `https://192.168.1.42/`.
2. **Le certificat de Caddy n'est pas reconnu par le téléphone.** `tls
   internal` émet un certificat pour `localhost`, pas pour cette IP, et son
   autorité est inconnue du téléphone. Le navigateur mobile bloquera — et
   comme `getUserMedia` exige un contexte sécurisé, **la caméra sera refusée**
   même en acceptant l'avertissement, dans plusieurs navigateurs.

**Le test recommandé n'utilise donc qu'un seul poste** : afficher le QR code
à l'écran (section 2 de l'interface) et le scanner avec **la webcam du même
ordinateur** (section 3). `https://localhost` est un contexte sécurisé
valide, le certificat est déjà accepté, et la chaîne testée est
rigoureusement la même. C'est aussi la raison pour laquelle `facingMode` est
en contrainte souple : sur un portable, la webcam frontale est acceptée.

Pour un vrai test mobile ultérieur, il faudra soit un certificat valide sur
un nom de domaine réel, soit un tunnel HTTPS public — hors périmètre de ce
prototype.

## 2. Parcours nominal (un seul poste)

Ouvrir `https://localhost/`.

1. **Section 1** — sélectionner un étudiant, *Générer une clé et s'enrôler*.
   Attendu : bloc vert, `"statut": "actif"`.
2. **Section 2** — *Ouvrir une séance de test*. Attendu : pastille verte
   « WebSocket connecté », puis **un QR code s'affiche**. Le laisser tourner
   ~25 s : le QR doit **changer visiblement** (nouveau jeton, RF-05).
3. **Section 3** — *Scanner le QR code*. Attendu, dans l'ordre :
   - une demande d'autorisation caméra du navigateur ;
   - pendant l'attente, un **spinner** et le texte « Accès à la caméra… » ;
   - après autorisation, le **flux vidéo** avec fenêtre de visée, coins
     blancs, pourtour assombri, ligne verte de balayage et le texte
     « Placez le QR code au centre » ;
   - présenter l'écran affichant le QR devant la webcam → **écran vert
     immédiat « QR code détecté »**, la caméra se coupe ;
   - puis le bloc vert « Présence validée » avec `"resultat": "valide"`.

**Vérification anti-fuite, à faire systématiquement** : dès l'écran vert, le
**voyant de la webcam doit s'éteindre**. S'il reste allumé, le flux n'a pas
été libéré — c'est exactement le défaut que
`src/components/QRScanner.test.jsx` est chargé de prévenir.

Refaire le test en cliquant *Fermer le scanner* au lieu de scanner : le
voyant doit s'éteindre là aussi. Puis une troisième fois en fermant **pendant
que la demande de permission est encore affichée** — c'est le cas de course
le plus délicat, celui où la caméra peut rester allumée silencieusement.

## 3. Refus de permission

**Chrome / Edge** : icône à gauche de la barre d'adresse → *Paramètres du
site* → *Caméra* → **Bloquer**. Recharger, puis *Scanner le QR code*.
Attendu : écran sombre, icône d'alerte rouge, et le message
« Accès à la caméra refusé. Autorisez-le dans les paramètres du site… ».
Aucun code technique brut (`NotAllowedError`) ne doit apparaître.

**Firefox** : bouton d'informations du site → *Autorisations* → *Utiliser la
caméra* → **Bloquer**.

Remettre ensuite sur *Autoriser*, recharger, vérifier que le scanner
redémarre normalement.

**Absence de caméra** : sur une machine sans webcam, le message attendu est
différent — « Aucune caméra détectée sur cet appareil. Utilisez la saisie
manuelle du jeton. » Les deux cas doivent rester distincts : ils appellent
des actions opposées.

## 4. Repli manuel

Cliquer *Saisir le jeton manuellement (sans caméra)*, coller le JWT visible
en section 2 (ou obtenu via la console), *Signer et envoyer*. Attendu :
identique au parcours caméra. Ce chemin reste le seul moyen de reproduire
volontairement un jeton expiré ou altéré (cf. Étape 5, section 2).

## 5. Réduction des animations

Activer la réduction des animations du système (Windows : *Paramètres →
Accessibilité → Effets visuels → Effets d'animation* → désactivé), recharger,
ouvrir le scanner. Attendu : la ligne de balayage et le spinner **ne sont pas
animés** (`motion-safe:`), tout le reste fonctionne à l'identique.

## 6. Tests automatisés

```bash
docker compose exec frontend npm test
```
Attendu : `5 passed` — dont « CAS CRITIQUE : démontage PENDANT que
getUserMedia() est en attente ». Aucune caméra réelle n'est utilisée.

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npm run build
docker compose exec backend npm test
```
Attendu : 0 erreur, build réussi, et `23 passed, 23 total` côté backend
(non-régression : l'Étape 6 ne touche pas au backend).

## Critère de succès global — Étape 6

Validée si et seulement si : le QR s'affiche et se renouvelle en section 2 ;
le scan par webcam aboutit à `"resultat": "valide"` (section 2) ; **le voyant
de la caméra s'éteint** après un scan réussi, après une fermeture manuelle, et
après une fermeture pendant la demande de permission ; un refus de permission
affiche un message actionnable distinct de celui de l'absence de caméra
(section 3) ; le repli manuel fonctionne (section 4) ; les animations sont
désactivées en mode réduction de mouvement (section 5) ; et
`docker compose exec frontend npm test` confirme `5 passed` (section 6).

---

# Étape 7a/7c — Authentification et identité issue de la session

**Migration OBLIGATOIRE** : le schéma et le seed changent (tables
`utilisateurs` et `sessions`, comptes de connexion). Un volume déjà
initialisé ne les recevra pas.

```bash
git pull origin dev
docker compose down -v
docker compose up -d --build
docker compose ps
```

## Comptes de démonstration

| Email | Mot de passe | Rôle |
|---|---|---|
| `amara.diallo@example.org` | `Etudiant123!` | étudiant |
| `bilal.ozturk@example.org` | `Etudiant123!` | étudiant |
| `chiara.rossi@example.org` | `Etudiant123!` | étudiant |
| `driss.elamrani@example.org` | `Etudiant123!` | étudiant |
| `formateur@example.org` | `Formateur123!` | formateur |

## 1. Connexion et cookie de session

```bash
curl -k -i -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"amara.diallo@example.org","mot_de_passe":"Etudiant123!"}'
```
Attendu : `200`, un en-tête `Set-Cookie` contenant **`HttpOnly`**,
**`Secure`** et **`SameSite=Strict`**, et un corps JSON décrivant
l'utilisateur. **Le jeton de session ne doit apparaître nulle part dans le
corps** — uniquement dans le cookie.

Pour la suite, conserver le cookie dans un fichier :
```bash
curl -k -c cookies.txt -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"amara.diallo@example.org","mot_de_passe":"Etudiant123!"}'
curl -k -b cookies.txt https://localhost/api/auth/moi
```
Attendu : le second appel renvoie `200` avec `"role":"etudiant"`.

## 2. Anti-énumération de comptes

```bash
curl -k -s -X POST https://localhost/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"amara.diallo@example.org","mot_de_passe":"FAUX"}'
echo
curl -k -s -X POST https://localhost/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"nexiste.pas@example.org","mot_de_passe":"FAUX"}'
```
Attendu : **exactement la même réponse** dans les deux cas (`401`,
`IDENTIFIANTS_INVALIDES`, message identique). Comparer aussi les temps de
réponse — ils doivent être du même ordre (~130 ms) :
```bash
curl -k -s -o /dev/null -w "compte existant  : %{time_total}s\n" -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"amara.diallo@example.org","mot_de_passe":"FAUX"}'
curl -k -s -o /dev/null -w "compte inexistant: %{time_total}s\n" -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"nexiste.pas@example.org","mot_de_passe":"FAUX"}'
```
Un écart marqué (1 ms contre 130 ms) signalerait que le leurre ne fonctionne
plus, et permettrait de déterminer quelles adresses possèdent un compte.

## 3. Les routes protégées refusent l'accès sans session

```bash
curl -k -s -X POST https://localhost/api/scans -H "Content-Type: application/json" -d '{}'
echo
curl -k -s -X POST https://localhost/api/enrolements -H "Content-Type: application/json" -d '{}'
```
Attendu : `401` avec `"code":"NON_AUTHENTIFIE"` dans les deux cas.

Avec un cookie inventé :
```bash
curl -k -s -X POST https://localhost/api/scans \
  -H "Content-Type: application/json" -H "Cookie: presence_session=invente" -d '{}'
```
Attendu : `401` avec `"code":"SESSION_INVALIDE"`.

## 4. Le formateur ne peut ni scanner ni enrôler

```bash
curl -k -c form.txt -s -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"formateur@example.org","mot_de_passe":"Formateur123!"}' > /dev/null
curl -k -b form.txt -s -X POST https://localhost/api/enrolements \
  -H "Content-Type: application/json" -d '{"public_key":"x"}'
```
Attendu : `403` avec `"code":"ROLE_INSUFFISANT"` — et non 401 : le formateur
est bien authentifié, c'est son rôle qui ne l'autorise pas.

## 5. L'usurpation par le corps de la requête ne fonctionne plus

Le test central de l'Étape 7c. Connecté en tant qu'Amara, tenter d'enrôler
un appareil au nom de Bilal :
```bash
curl -k -b cookies.txt -s -X POST https://localhost/api/enrolements \
  -H "Content-Type: application/json" \
  -d '{"public_key":"-----BEGIN PUBLIC KEY-----\nMFkw...\n-----END PUBLIC KEY-----\n",
       "etudiant_id":"33333333-3333-3333-3333-333333333332"}'
```
Attendu : la réponse contient `"etudiant_id":"33333333-3333-3333-3333-333333333331"`
(**Amara**, celle de la session) et **jamais** l'identifiant de Bilal. Le
champ envoyé est silencieusement ignoré.

## 6. La déconnexion invalide réellement la session

```bash
curl -k -b cookies.txt -s https://localhost/api/auth/moi | head -c 80; echo
curl -k -b cookies.txt -s -X POST https://localhost/api/auth/logout; echo
curl -k -b cookies.txt -s https://localhost/api/auth/moi
```
Attendu : `200`, puis `{"status":"ok"}`, puis **`401 SESSION_INVALIDE`** en
rejouant le **même** cookie. C'est ce qu'un JWT auto-porteur ne permettrait
pas : il resterait valide jusqu'à son expiration.

## 7. Le jeton n'est pas stocké en clair

```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}" \
  -e "SELECT id, utilisateur_id, LEFT(jeton_hash,16) AS empreinte, date_expiration FROM db_logs.sessions\G"
```
Attendu : `jeton_hash` est une empreinte hexadécimale de 64 caractères,
**jamais** la valeur présente dans le cookie. Vérifier aussi que les mots de
passe sont bien hachés :
```bash
docker compose exec mysql mysql -u${MYSQL_USER:-app_logs} -p"${MYSQL_PASSWORD}" \
  -e "SELECT email, LEFT(mot_de_passe_hash,20) AS debut, role FROM db_logs.utilisateurs;"
```
Attendu : chaque valeur commence par `scrypt$32768$8$1$`, et **les quatre
étudiants ont des empreintes différentes** bien qu'ayant le même mot de
passe — preuve directe du sel par compte.

## 8. La contrainte de cohérence rôle/lien est portée par la base

```bash
docker compose exec mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" \
  -e "INSERT INTO db_logs.utilisateurs (id,email,mot_de_passe_hash,nom,role,etudiant_id)
      VALUES (UUID(),'test@x.org','x','Test','formateur','33333333-3333-3333-3333-333333333331');"
```
Attendu : **échec** avec une violation de `chk_utilisateur_role_lien` — un
formateur ne peut pas être rattaché à un étudiant, même en root, même en SQL
direct.

## 9. Tests automatisés

```bash
docker compose exec backend npm test
```
Attendu : **`44 passed, 44 total`** sur 5 suites (`tokenService`, `health`,
`scan`, `enrolement`, `auth`).

## Critère de succès global — Étape 7a/7c

Validée si et seulement si : la connexion pose un cookie
`HttpOnly; Secure; SameSite=Strict` sans exposer le jeton dans le corps
(section 1) ; compte inexistant et mot de passe erroné sont indistinguables
en statut, message **et** durée (section 2) ; les routes protégées répondent
401 sans session et avec un cookie inventé (section 3) ; un formateur reçoit
403 (section 4) ; un `etudiant_id` glissé dans le corps est ignoré au profit
de celui de la session (section 5) ; la déconnexion invalide réellement le
cookie (section 6) ; jetons et mots de passe ne sont jamais en clair en base
(section 7) ; la contrainte `CHECK` refuse un formateur rattaché à un
étudiant (section 8) ; et `docker compose exec backend npm test` confirme
`44 passed` (section 9).

---

# Étape 7b — Interface de connexion, routage et tableaux de bord

Aucun changement de schéma : **pas besoin de `docker compose down -v`** si
l'Étape 7a/7c a déjà été appliquée. Le conteneur frontend doit en revanche
réinstaller ses dépendances (`react-router-dom`).

```bash
git pull origin dev
docker compose up -d --build
docker compose ps
```

Ouvrir `https://localhost/` (accepter l'avertissement de certificat comme
depuis l'Étape 0.2).

## 1. Redirection et écran de connexion

Attendu à l'ouverture de `https://localhost/` : redirection automatique vers
`/login`, puis un écran centré avec le logo, les champs e-mail et mot de
passe, un bouton principal, et deux boutons discrets de pré-remplissage.

Vérifier que le bouton **Se connecter est désactivé** tant qu'un des deux
champs est vide.

Ouvrir directement `https://localhost/etudiant` sans être connecté. Attendu :
redirection vers `/login`. **Point à vérifier après connexion** : vous devez
arriver sur `/etudiant`, la destination demandée ayant été mémorisée.

## 2. Erreur d'identifiants

Saisir `amara.diallo@example.org` avec un mot de passe erroné. Attendu : un
encadré rouge avec une icône et le message « Email ou mot de passe
incorrect. », les champs passant en bordure rouge, et le mot de passe effacé.
Aucun code technique ne doit apparaître.

Essayer ensuite avec un e-mail inexistant. Attendu : **exactement le même
message** (anti-énumération, cf. Étape 7a).

## 3. Connexion étudiant

Cliquer sur **Pré-remplir étudiant**, puis **Se connecter**. Attendu :
- un bref état de chargement sur le bouton ;
- redirection automatique vers `/etudiant` ;
- en-tête affichant « Amara Diallo » et « Espace étudiant ».

## 4. Le rôle est respecté

Connecté en tant qu'étudiant, ouvrir `https://localhost/formateur`. Attendu :
redirection immédiate vers `/etudiant`, sans message d'erreur. Inversement,
connecté en formateur, `/etudiant` renvoie vers `/formateur`.

## 5. Parcours étudiant complet

Sur `/etudiant`, la carte « Votre appareil » affiche une puce d'état.
Cliquer sur **Associer cet appareil**. Attendu : puce passant à « Associé »
et message vert de confirmation. Recliquer : le message doit indiquer que
l'appareil précédent a été révoqué (RF-09).

**Vérification centrale de l'Étape 7c** : ouvrir les outils de développement
(F12), onglet **Réseau**, puis relancer l'association. Inspecter la requête
`POST /api/enrolements` :

- l'onglet **Charge utile** ne doit contenir que `public_key` et
  `device_info` ; **aucun `etudiant_id`** ;
- l'onglet **Cookies** doit montrer que `presence_session` a bien été envoyé ;
- dans **Application → Cookies**, `presence_session` doit porter la mention
  `HttpOnly` cochée. Taper `document.cookie` dans la console doit renvoyer
  une chaîne **ne contenant pas** `presence_session` : c'est la preuve
  directe qu'une faille XSS ne pourrait pas voler la session.

Ouvrir ensuite une séance depuis un second navigateur connecté en formateur
n'est pas encore possible (Étape 7d). Pour tester le scan dès maintenant,
générer un jeton en ligne de commande :

```bash
curl -k -c form.txt -s -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"formateur@example.org","mot_de_passe":"Formateur123!"}' > /dev/null

curl -k -b form.txt -s -X POST https://localhost/api/seances \
  -H "Content-Type: application/json" \
  -d '{"uf_id":"11111111-1111-1111-1111-111111111111","salle_id":"22222222-2222-2222-2222-222222222222"}'
```
Puis afficher son QR code avec le jeton obtenu (voir Étape 6, section 2) et
le scanner depuis `/etudiant`. Attendu : écran vert « QR code détecté », puis
message « Votre présence a bien été enregistrée. »

Vérifier dans l'onglet Réseau que `POST /api/scans` n'envoie que `jeton` et
`signature_appareil`.

## 6. Tableau de bord formateur

Se déconnecter, puis **Pré-remplir formateur** et se connecter. Attendu :
`/formateur`, une carte « Votre compte » avec nom et e-mail, et une carte
« Ouvrir une séance » présentant un aperçu grisé avec l'étiquette
« Étape 7d ». Les champs de cet aperçu sont volontairement inertes.

## 7. Déconnexion et expiration de session

Cliquer sur **Se déconnecter**. Attendu : retour à `/login`. Utiliser le
bouton **Précédent** du navigateur : vous ne devez **pas** revenir dans
l'espace connecté, mais être redirigé vers `/login`.

**Test de la session perdue en cours d'utilisation** : se reconnecter, puis
supprimer manuellement le cookie (Application → Cookies → supprimer
`presence_session`), et déclencher une action (associer l'appareil).
Attendu : redirection automatique vers `/login`, sans page blanche ni erreur
technique affichée.

## 8. Rendu mobile

Dans les outils de développement, activer le mode appareil mobile (par
exemple iPhone SE, 375 px). Attendu : une seule colonne, aucun débordement
horizontal, texte lisible sans zoom, boutons occupant toute la largeur, et
en-tête où le libellé « Se déconnecter » est remplacé par une icône afin de
ne pas écraser le nom.

Vérifier également que l'en-tête reste visible en faisant défiler la page.

## 9. Réduction des animations

Activer la réduction des animations du système. Attendu : les apparitions de
cartes, le spinner et la ligne de balayage du scanner ne sont plus animés,
tout le reste fonctionnant à l'identique.

## 10. Vérifications automatisées

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npm test
docker compose exec frontend npm run build
docker compose exec backend npm test
```
Attendu : 0 avertissement au lint, `5 passed` côté frontend, build réussi,
et `44 passed, 44 total` côté backend.

**Contrôle de sécurité sur le build** : les identifiants de démonstration ne
doivent pas se retrouver dans le bundle de production.
```bash
docker compose exec frontend sh -c "npm run build > /dev/null && grep -r 'Etudiant123' dist/ || echo 'ABSENT du bundle (attendu)'"
```

## Critère de succès global — Étape 7b

Validée si et seulement si : `/` redirige vers `/login` puis vers le bon
tableau de bord après connexion (sections 1 et 3) ; une destination demandée
avant connexion est restaurée ensuite (section 1) ; les identifiants erronés
et les comptes inexistants donnent le même message (section 2) ; l'accès à
un tableau de bord d'un autre rôle redirige sans erreur (section 4) ;
`POST /api/enrolements` et `POST /api/scans` n'envoient **aucun**
`etudiant_id` et `document.cookie` ne révèle pas la session (section 5) ; la
déconnexion empêche le retour arrière et la perte de session redirige
proprement (section 7) ; le rendu mobile tient en 375 px sans débordement
(section 8) ; et les quatre commandes de la section 10 passent, identifiants
de démonstration absents du bundle.

---

# Étape 7b (bis) — Refonte visuelle, accessibilité et plein écran

```bash
git pull origin dev
docker compose up -d --build
```

## 1. Aspect général

Ouvrir `https://localhost/`. Attendu : fond blanc cassé légèrement chaud,
cartes blanches, aucune zone sombre en dehors du scanner. La marque affiche
« Prise de présence » et non « Présence », et le titre de l'onglet également.

## 2. Contraste, vérification automatisée

Dans les outils de développement, onglet **Lighthouse**, lancer un audit
**Accessibilité** sur `/login` puis sur `/etudiant` une fois connecté.
Attendu : aucune violation de la catégorie « contrast ».

Vérification ponctuelle avec le sélecteur de couleur intégré : inspecter un
texte d'aide (par exemple « Jeu de données de démonstration »), ouvrir le
nuancier de la propriété `color` dans l'onglet Styles. Chrome affiche le
ratio de contraste et deux coches AA/AAA. Attendu : au moins AA sur tous les
textes.

**Point souvent oublié à contrôler** : cliquer dans le champ e-mail, puis
regarder sa bordure au repos (sans focus). Elle doit rester nettement
visible sur le fond blanc, y compris en réduisant la luminosité de l'écran.

## 3. En-tête et navigation

Connecté sur `/etudiant` : la marque en haut à gauche est plus grande
qu'auparavant. Cliquer dessus. Attendu : retour à la page précédente.

Ouvrir `https://localhost/etudiant` dans un **onglet neuf** (donc sans
historique), puis cliquer sur la marque. Attendu : redirection vers la racine,
et non un bouton sans effet.

Naviguer au clavier avec la touche Tab : la marque et le bouton de
déconnexion doivent recevoir un anneau de focus visible.

## 4. Déconnexion discrète

Attendu sur ordinateur : une icône de sortie suivie du libellé
« Se déconnecter », sans bordure ni fond au repos, un fond gris apparaissant
au survol. Sur mobile (375 px) : seule l'icône reste, le nom de l'utilisateur
n'étant plus écrasé.

## 5. Projection du QR en plein écran

Se connecter en formateur. La carte « Ouvrir une séance » affiche un QR
d'aperçu et un bouton **Projeter en plein écran**.

Cliquer dessus. Attendu : le QR occupe tout l'écran sur fond blanc, avec le
titre « Aperçu de projection » au-dessus et le rappel « Appuyez sur Échap
pour revenir ».

**Deux contrôles qui comptent** :
- Sortir avec la touche **Échap** (et non par le bouton), puis regarder le
  bouton : son libellé doit être revenu à « Projeter en plein écran ». S'il
  affiche encore « Quitter », l'état interne s'est désynchronisé de celui du
  navigateur.
- Reculer de quelques mètres de l'écran et vérifier que le QR reste net : il
  est rendu en SVG, il ne doit pas pixelliser.

Sur Safari ou iPad, le bouton doit fonctionner de la même façon grâce à
l'API préfixée. Si un navigateur refuse le plein écran, un message doit
apparaître et proposer la touche F11, plutôt que de laisser un bouton inerte.

## 6. Non-régression

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npm test
docker compose exec backend npm test
```
Attendu : 0 avertissement, `5 passed` côté frontend, `44 passed` côté backend.

## Critère de succès global — Étape 7b (bis)

Validée si et seulement si : l'interface est claire et sans zone sombre hors
scanner (section 1) ; Lighthouse ne relève aucune violation de contraste et
les bordures de champ restent visibles au repos (section 2) ; la marque
agrandie ramène à la page précédente, et à la racine depuis un onglet neuf
(section 3) ; la déconnexion est discrète et se réduit à une icône sur mobile
(section 4) ; le plein écran fonctionne, et sortir par Échap remet le libellé
du bouton en cohérence (section 5) ; les suites de tests restent vertes
(section 6).

---

# Annexe A — Runbook de relance après perte de `.env`/`keys/` (incident `git clean -fd`)

## Contexte

Cet incident type se produit quand une commande de nettoyage Git non
qualifiée (`git clean -fd`) est exécutée après un pull : elle supprime
**tous** les fichiers non suivis par Git, y compris ceux volontairement
gitignorés (`.env`, `keys/`) car ils contiennent des secrets locaux qui ne
doivent jamais être commités. Symptôme observé :
```
Error: [tokenService] Impossible de lire la cle privee RS256 (/keys/private.pem)
: ENOENT: no such file or directory, open '/keys/private.pem'.
Executez ./generate_keys.sh a la racine du projet avant de demarrer le backend.
```
puis, en tentant de lancer les tests pendant que le conteneur boucle :
```
Error response from daemon: Container [...] is restarting, wait until the container is running.
```

Deux causes distinctes se cumulent ici (voir `ANALYSE_CODE.md`, section
« Fix critique ») : la perte réelle de `.env`/`keys/`, ET un bug latent de
`docker-compose.yml` (variables `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH`
jamais transmises au conteneur `backend`) présent depuis l'Étape 2 et
corrigé à cette occasion. Le protocole ci-dessous suppose le correctif déjà
récupéré via `git pull`.

## Protocole de relance, étape par étape

**1. Récupérer le correctif**
```bash
git checkout dev
git pull origin dev
```
Attendu : `docker-compose.yml` contient désormais, sous `backend.environment`,
les deux lignes `JWT_PRIVATE_KEY_PATH: ${JWT_PRIVATE_KEY_PATH:-./keys/private.pem}`
et `JWT_PUBLIC_KEY_PATH: ${JWT_PUBLIC_KEY_PATH:-./keys/public.pem}`
(vérifiable avec `grep JWT_ docker-compose.yml`).

**2. Restaurer `.env`**
```bash
cp .env.example .env
```
Éditer `.env` si des valeurs spécifiques (mots de passe) doivent être
conservées ; sinon les valeurs d'exemple suffisent pour un usage local.
Attendu : le fichier existe à la racine, contient bien `JWT_PRIVATE_KEY_PATH=./keys/private.pem`
et les variables `MYSQL_*`.

**3. Régénérer les clés RS256**
```bash
./generate_keys.sh
```
Attendu : `keys/private.pem` (droits 600) et `keys/public.pem` (droits 644)
créés — le script refuse d'écraser une clé déjà présente, donc sans risque
à relancer si des clés existent déjà. Ce chemin (`./keys/`) est exactement
celui attendu par le volume `./keys:/app/keys:ro` de `docker-compose.yml`.

**4. Purger TOTALEMENT l'état Docker, y compris les volumes**
```bash
docker compose down -v --remove-orphans
```
**Pourquoi `-v` est indispensable ici et pas juste `down` seul** : `.env`
vient d'être régénéré depuis `.env.example`. Si l'ancien volume `mysql_data`
(issu d'une initialisation précédente, avec d'anciens mots de passe) est
conservé, MySQL redémarre dessus SANS rejouer `01-schema.sql`/`02-seed.sql`/
`03-privileges.sh` (l'entrypoint officiel ne les exécute qu'au tout premier
démarrage d'un volume vide) — les identifiants dans le nouveau `.env` ne
correspondraient alors plus à ceux réellement configurés dans MySQL, et le
backend échouerait à se connecter avec une erreur d'authentification, un
second incident masquant la résolution du premier. `--remove-orphans`
nettoie en plus tout conteneur résiduel d'une configuration antérieure du
projet. Attendu : `docker volume ls` ne liste plus `mysql_data`,
`caddy_data`, `caddy_config` pour ce projet ; `docker compose ps` ne liste
plus aucun conteneur `presence_*`.

**5. Reconstruire et relancer proprement**
```bash
docker compose up -d --build
```
Attendu : les trois conteneurs démarrent (`docker compose ps` → tous
`running`/`healthy`) ; `docker compose logs backend` affiche la séquence de
démarrage normale (connexion MySQL établie, `Backend demarre sur le port
3000`) sans aucune ligne `ENOENT` ni redémarrage en boucle.

## Vérification finale

```bash
docker compose ps
docker compose logs backend --tail=30
curl -k https://localhost/api/health
curl -k https://localhost/api/db-health
```
Attendu : `docker compose ps` montre les trois services up ; les logs backend
ne contiennent aucune erreur ; `/api/health` renvoie un JSON de statut OK ;
`/api/db-health` renvoie `etudiants_count: 4` (le seed est rejoué sur le
volume neuf). Une fois ces quatre vérifications passées, les tests
d'intégration (section « Stratégie de test automatisé ») peuvent reprendre
normalement.

---

# Annexe B — Travailler avec DEUX dépôts distants (GitHub + GitLab de l'école)

## Le problème vécu

Une erreur `npm ci ... Missing: @emnapi/core` a « persisté » en CI à travers
plusieurs correctifs successifs. Cause réelle : **la pipeline GitLab
s'exécutait sur un dépôt différent de celui où les correctifs étaient
poussés**. Trois indices l'ont établi, tous lisibles dans les logs du job :

- le chemin de build (`/builds/<groupe-école>/…/Projet_innovant`) ne
  correspondait pas au dépôt GitHub de développement ;
- le commit testé (`91f5bbd8`) **n'existait dans aucun** des deux historiques
  connus localement (`git cat-file -t 91f5bbd8` → *Not a valid object name*) ;
- la ligne exécutée était `bash ./generate_keys.sh` alors que le
  `.gitlab-ci.yml` du dépôt de développement écrit `./generate_keys.sh` — le
  fichier CI lui-même différait donc entre les deux dépôts.

**Règle à retenir** : quand une erreur de CI résiste à un correctif dont on a
vérifié qu'il fonctionne en local, la première chose à contrôler n'est pas le
correctif — c'est **quel commit la pipeline a réellement testé**. Le
`Checking out <sha>` en tête de log répond immédiatement à la question.

## Configurer les deux dépôts

```bash
git remote -v                        # etat actuel
git remote add ecole <URL-DU-GITLAB-DE-L-ECOLE>
git remote -v                        # doit lister origin ET ecole
```

Pousser vers les deux à chaque fois :
```bash
git push origin dev
git push ecole dev
```

**Alternative — un seul `git push` pour les deux** (à préférer, car il rend
l'oubli impossible) : configurer plusieurs URL de push sur `origin`.
```bash
git remote set-url --add --push origin <URL-GITHUB>
git remote set-url --add --push origin <URL-DU-GITLAB-DE-L-ECOLE>
git remote -v                        # origin doit afficher DEUX lignes (push)
```
Après cette configuration, `git push origin dev` écrit dans les deux dépôts.
Attention : la première commande `set-url --add --push` **remplace** l'URL de
push implicite, il faut donc bien ajouter les deux, GitHub compris — sinon
les push vers GitHub cessent silencieusement.

## Vérifier AVANT de pousser

`verifier-avant-push.sh` (racine du projet) rejoue en local, dans l'image
Docker exacte de la CI (`node:20`), les étapes qui échouent le plus souvent :

```bash
./verifier-avant-push.sh
```

Il contrôle deux choses :

1. **`npm ci` réussit** pour `backend/` et `frontend/`. La vérification se
   fait dans un conteneur Linux, jamais dans l'environnement Windows local :
   seuls `package.json` et `package-lock.json` sont copiés dans un répertoire
   vierge du conteneur, de sorte qu'aucun `node_modules` de l'hôte ne puisse
   fausser le résultat. Le dossier est monté en lecture seule — le script ne
   modifie jamais rien.
2. **Chaque dépôt distant est à jour** sur la branche courante. C'est ce
   contrôle qui aurait signalé immédiatement le problème ci-dessus, avec un
   message du type :
   ```
   ecole  : EN RETARD de 3 commit(s) (50ffaf17)
       -> git push ecole dev
   ```

Code de sortie `0` si tout va bien, `1` sinon.

**Rendre la vérification automatique** (optionnel) :
```bash
cp outils/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```
Le push est alors refusé si la vérification échoue. Contournement ponctuel :
`git push --no-verify`. À noter : `.git/hooks/` n'est jamais versionné par
Git (un dépôt ne doit pas pouvoir faire exécuter du code chez qui le clone),
d'où cette copie manuelle en une commande.

## Si le `dev` du GitLab a divergé

Le `.gitlab-ci.yml` différant entre les deux dépôts, l'historique GitLab
contient probablement des commits absents de GitHub. Un `git push ecole dev`
sera alors refusé (*non-fast-forward*). Constater l'écart avant toute chose :

```bash
git fetch ecole
git log --oneline -10 ecole/dev
git log --oneline --left-right --boundary ecole/dev...dev
```

Ne **jamais** régler cela par un `--force` réflexe : il écraserait
définitivement les commits présents uniquement côté école. Selon ce que
montre le `log`, soit fusionner (`git merge ecole/dev`, puis résoudre les
conflits — typiquement sur `.gitlab-ci.yml`), soit, si les commits côté école
n'ont aucune valeur, forcer en connaissance de cause avec
`git push --force-with-lease ecole dev` (`--force-with-lease` plutôt que
`--force` : il refuse d'écraser si quelqu'un a poussé entre-temps).
