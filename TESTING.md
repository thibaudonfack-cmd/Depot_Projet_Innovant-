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
Attendu : des privilèges sur `db_logs.*`, **aucune** ligne mentionnant
`db_attestations`. Et en y regardant le détail, `scans`/`corrections` ne
doivent apparaître dans aucun `GRANT ... UPDATE/DELETE` — seuls `SELECT` et
`INSERT` (via les privilèges globaux sur `db_logs.*`, moins ce qui a été
explicitement révoqué) doivent permettre d'agir dessus.

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
