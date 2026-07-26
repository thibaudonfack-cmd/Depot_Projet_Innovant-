# ANALYSE_CODE.md

Document vivant. Mis à jour à chaque étape avec le détail de ce qui a été créé, où, pourquoi, et selon quels choix d'architecture/sécurité. Objectif : que tu puisses relire n'importe quelle ligne du dépôt sans avoir à me redemander pourquoi elle existe.

---

## Corrections actées suite à la revue de cohérence (avant Étape 0)

Cinq points de dérive identifiés entre le mémoire figé (chap. 2-4) et le discours de sprint ont été corrigés. Ils sont consignés ici pour qu'aucune implémentation future ne les réintroduise.

| # | Point | Erreur évitée | Règle qui fait foi |
|---|---|---|---|
| 1 | TTL du jeton | Ne pas coder `exp = iat + 20s` | Rotation **20 s**, TTL **25 s** (recouvrement de 5 s pour ne pas rejeter un scan en cours de rotation). Paramètre à câbler tel quel dans `tokenService.js` à l'étape suivante. |
| 2 | Rôle du nonce | Ne pas dire/coder que le nonce empêche le partage de capture (SMS/photo) | Le nonce ferme **V4** (rejeu d'une requête réseau déjà acceptée). C'est l'**expiration** du jeton qui ferme **V1** (partage). Deux mécanismes, deux vecteurs distincts — ne jamais les fusionner dans le code ni dans la documentation. |
| 3 | Géofence | Ne pas la traiter comme une option | Composant obligatoire de la cascade (RF-13) : c'est le seul mécanisme qui ferme **V2**. Sans lui, seuls 3 des 4 vecteurs sont couverts. |
| 4 | Mode dégradé | Ne pas l'omettre du plan / de la stack | RF-15/16 et QR1 (connectivité instable) en dépendent entièrement : Service Worker + file IndexedDB + resynchronisation avec re-vérification de fraîcheur. Traité comme brique à part entière, pas comme un détail de la PWA. |
| 5 | Contexte sécurisé (HTTPS) | Ne pas le reporter en fin de projet | WebCrypto, `getUserMedia`, Geolocation et Service Worker refusent de s'exécuter hors contexte sécurisé. Le TLS doit être présent dès le premier déploiement (proxy dans `docker-compose.yml`), pas ajouté après coup. **Non traité dans cette Partie 1** (seul le service `mysql` est monté ici) — sera introduit dès l'ajout du proxy/backend à l'étape suivante, pas repoussé au-delà.

Deux précisions de modélisation à respecter dans tout le code futur :
- Le **polygone de géofence est un attribut de `Salle`**, jamais de `Séance` — sinon il est dupliqué à chaque ouverture de séance dans la même pièce (violation de normalisation, source d'incohérence si le polygone est corrigé).
- Le **délai de 14 jours d'ENORApp** est une référence pour le workflow de **correction** (RF-17/18, cible < 24h), **pas** pour la génération des attestations. Ne jamais coder de minuteur/délai sur le service d'attestation.

---

## Étape 0 — Partie 1 : Scaffolding, sécurité, base de données

### Vue d'ensemble

Objectif de cette sous-étape : poser les fondations du monorepo (arborescence, secrets, clés cryptographiques, persistance MySQL) **sans lancer de serveur applicatif**. Rien n'est encore exécutable comme "produit" ; tout ce qui suit est de l'infrastructure et de la configuration.

### Arborescence créée

```
.
├── .gitignore
├── .env.example
├── .env                    (non versionné)
├── generate_keys.sh
├── docker-compose.yml
├── ANALYSE_CODE.md
├── backend/                (vide pour l'instant, .gitkeep)
├── pwa/                    (vide pour l'instant, .gitkeep)
└── keys/                   (non versionné)
    ├── private.pem         (non versionné)
    └── public.pem          (non versionné)
```

`backend/` et `pwa/` contiennent chacun un `.gitkeep` : Git ne suit pas les dossiers vides, seulement les fichiers. Sans ce fichier, ces deux dossiers n'apparaîtraient pas dans le dépôt tant qu'aucun fichier applicatif n'y est ajouté — ce qui aurait rendu l'arborescence invisible à un tiers clonant le dépôt à ce stade.

### 1. `.gitignore`

**Rôle** : empêcher que des secrets ou des artefacts non pertinents n'entrent jamais dans l'historique Git — une fois qu'un secret est commité, sa suppression ultérieure ne l'efface pas de l'historique sans réécriture (`filter-repo`/`BFG`), donc la prévention prime absolument sur la correction.

**Choix de contenu, justifiés ligne par ligne** :
- `keys/`, `*.pem`, `*.key` : la clé privée RS256 signe les jetons de séance et les attestations. Sa fuite permettrait à quiconque de forger une présence ou une attestation opposable en justice — c'est la pierre angulaire de la valeur probante (Loi 1985, art. 114) et de l'intégrité RGPD (art. 32). Double filtre (nom de dossier **et** extension) pour survivre à un déplacement accidentel d'une clé hors de `keys/`.
- `.env`, `.env.local`, `.env.*.local` : mots de passe MySQL et chemins de clés. Seul `.env.example` (sans valeurs réelles) est versionné.
- `node_modules/`, `**/node_modules/` : dépendances reconstructibles via `npm install`, inutiles en historique et volumineuses.
- `mysql-data/`, `*.sqlite*` : anticipation du volume de données MySQL si jamais un bind-mount local est utilisé au lieu d'un volume nommé Docker.
- `dist/`, `build/`, `.cache/`, `coverage/` : anticipation des builds PWA et des rapports de test des étapes suivantes.
- Section OS/éditeurs : hygiène standard, évite le bruit de fichiers `.DS_Store`/`Thumbs.db`/config d'IDE dans les diffs.

### 2. `.env.example` et `.env`

**Rôle** : `.env.example` documente le contrat de configuration sans exposer de secret — c'est le fichier que tout nouveau contributeur (ou moi, à la prochaine étape) copie pour démarrer. `.env` contient les valeurs réelles locales et n'est jamais commité.

**Variables et pourquoi elles existent déjà à ce stade** :
- `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` : chemins vers les clés générées par `generate_keys.sh`. Déclarées maintenant même si aucun service ne les consomme encore, pour que le contrat d'environnement soit stable dès le premier commit — le service jeton de l'étape suivante n'aura qu'à les lire, pas à les inventer.
- `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` : consommées directement par l'image officielle `mysql:8.0` dans `docker-compose.yml`.
- `MYSQL_DATABASE=db_logs` : l'image officielle ne crée automatiquement qu'**une seule** base au premier démarrage. La seconde base (`db_attestations`) et surtout la **séparation stricte des privilèges** (l'utilisateur applicatif standard ne doit avoir aucun droit d'écriture sur `db_attestations` — seul le service d'attestation y écrit, conformément à la séparation logs/attestations de 2.2.5/4.4) seront provisionnées par un script d'initialisation SQL dédié à l'étape "modèle de données". **Volontairement non traité ici** pour ne pas préempter une décision qui appartient à la brique suivante ; le signaler évite qu'on découvre l'écart plus tard en pensant à un oubli.
- `MYSQL_HOST=mysql` : anticipe la résolution DNS interne au réseau Docker (le service s'appellera `mysql` dans `docker-compose.yml`) — le backend de l'étape suivante n'aura pas à connaître d'adresse IP.
- `NODE_ENV`, `PORT` : préparés pour le service backend, non consommés à ce stade.

Les valeurs dans `.env` (`dev_root_pw_2026`, etc.) sont des mots de passe de convenance pour poste de développement local uniquement — explicitement commentées comme telles dans le fichier. À durcir avant tout déploiement partagé.

### 3. `generate_keys.sh`

**Rôle** : produire la paire de clés RS256 utilisée pour deux usages distincts déjà actés au chapitre 2 (2.3.3) — signer les JWT de séance (RF-04) et signer les attestations de présence (RF-19). Une seule paire suffit pour le prototype : les deux usages partagent la même autorité de signature serveur.

**Pourquoi RS256 côté serveur (et pas HMAC, pas ECDSA ici)** :
- **RS256 est asymétrique** (RSA + SHA-256) : la clé privée signe, la clé publique vérifie. C'est ce qui permet à un tiers — l'auditeur externe (SPF Emploi, jury de délibération) — de vérifier l'authenticité d'une attestation en ne détenant **que** la clé publique, sans jamais avoir accès au serveur ni à un secret partagé. C'est la traduction technique directe de l'exigence de valeur probante de la Loi de 1985 (RNF-14).
- **HMAC (HS256)** a été explicitement écarté : un schéma symétrique exigerait que le vérificateur détienne le même secret que l'émetteur, ce qui est incompatible avec une vérification par un tiers sans accès au système.
- **ECDSA** est réservé côté **client** (enrôlement d'appareil, section 2.3.3/2.3.5) — clé non extractible générée dans le navigateur via WebCrypto. Les deux mécanismes de signature asymétrique servent deux frontières de confiance différentes et ne doivent pas être confondus : RS256 authentifie une émission **serveur** vérifiable par tous ; ECDSA authentifie un **appareil** auprès du seul serveur.

**Détails d'implémentation** :
- RSA 2048 bits : taille standard recommandée, compromis sécurité/performance adapté à un usage de signature (pas de chiffrement de gros volumes).
- Garde-fou `if [[ -f "$PRIVATE_KEY" ]]; then exit 1; fi` : empêche l'écrasement accidentel d'une clé déjà en service — une régénération silencieuse invaliderait tous les jetons et attestations déjà signés, cassant la vérifiabilité de tout ce qui a été émis avant.
- `chmod 600` (privée) / `644` (publique) : la clé privée ne doit être lisible que par le propriétaire du processus ; la clé publique est, par nature, destinée à être diffusée. **Limite observée dans cet environnement d'exécution** : le point de montage utilisé pour partager les fichiers avec ton poste ne persiste pas les bits de permission Unix fins (le `chmod` s'exécute sans erreur mais `stat` renvoie systématiquement `700` pour les deux fichiers). Ce n'est pas un défaut de conception du script — sur un système de fichiers standard (ce sera le cas dans le conteneur Docker et sur ta machine), les permissions demandées s'appliqueront normalement. La garantie de sécurité réelle à ce stade repose sur l'exclusion Git (`keys/` dans `.gitignore`), pas sur les bits de permission de ce point de montage particulier.
- Exécuté une fois : `keys/private.pem` (2048 bits) et `keys/public.pem` générés et vérifiés (`openssl rsa -pubin -text -noout` confirme une clé RSA 2048 bits valide).

### 4. `docker-compose.yml`

**Rôle** : démarrer uniquement la persistance MySQL à ce stade, sans backend ni proxy — conformément au périmètre explicite de cette Partie 1.

**Choix justifiés** :
- `image: mysql:8.0` : version stable, alignée avec la stack visée au chapitre 4 (composants) — pas de raison de cibler une version plus récente non testée avec le reste de l'architecture.
- **Aucun port publié vers l'hôte** (`ports:` volontairement absent) : dans l'architecture de déploiement (4.3), MySQL n'est jamais exposé en dehors du réseau Docker interne — seul le proxy TLS l'est. Publier `3306:3306` dès maintenant créerait une habitude à corriger plus tard ; autant respecter la contrainte dès l'infra, comme demandé pour le contexte sécurisé. Pour une inspection ponctuelle en développement, `docker compose exec mysql mysql -u root -p` reste disponible sans exposer le port.
- `volumes: mysql_data:/var/lib/mysql` avec un volume nommé (`driver: local`) plutôt qu'un bind-mount : les données survivent à `docker compose down` (mais pas à `docker compose down -v`), sans dépendre d'un chemin hôte spécifique — portable entre ta machine et un futur serveur de déploiement.
- `healthcheck` : permet aux services qui dépendront de MySQL (backend, à l'étape suivante, via `depends_on: condition: service_healthy`) d'attendre que le serveur soit réellement prêt à accepter des connexions, pas seulement que le conteneur soit démarré — évite une classe d'erreurs de démarrage en cascade classique avec MySQL (le process écoute avant que l'initialisation des tables système soit terminée).
- Toutes les valeurs sensibles sont injectées via `${VARIABLE}` depuis `.env` — aucun secret en dur dans un fichier versionné.

**Validation effectuée** : syntaxe YAML vérifiée par parsing (`yaml.safe_load`), structure conforme. Docker n'étant pas disponible dans cet environnement d'exécution sandboxé, le démarrage réel du conteneur (`docker compose up`) est à valider sur ta machine ou lors du déploiement — c'est la seule vérification qui n'a pas pu être faite ici, à noter avant de considérer cette brique "testée en conditions réelles".

### 5. Dépôt Git local

**Rôle** : préparer le dépôt à être poussé vers GitLab dès que la connexion sera établie (voir échange en cours dans la conversation).

**Particularité d'environnement à connaître pour la suite** : le dossier de travail partagé avec ton poste (celui où vivent tous les fichiers ci-dessus) ne supporte pas de façon fiable la création/suppression de certains fichiers internes à Git (verrous `.git/index.lock`, fichiers `.git/HEAD`, etc. — `git init` classique y échoue silencieusement puis bloque au premier commit). Contournement appliqué : le répertoire Git interne (`GIT_DIR`) est hébergé hors de ce point de montage, à `/sessions/loving-serene-bardeen/repo.git` dans l'environnement d'exécution, tandis que l'arborescence de travail (`GIT_WORK_TREE`) reste le dossier partagé avec toi. Concrètement, toute commande Git dans les étapes suivantes devra être invoquée avec ces deux options :

```bash
git --git-dir=/sessions/loving-serene-bardeen/repo.git \
    --work-tree=/sessions/loving-serene-bardeen/mnt/outputs \
    <commande>
```

Ceci est une particularité de l'environnement d'exécution où je travaille, pas de ton projet ni de ta machine : une fois le dépôt poussé sur GitLab et cloné sur un poste standard (le tien, ou un runner CI/CD), ce contournement n'a plus lieu d'être — un `git clone` classique y fonctionnera normalement, sans configuration particulière.

**État actuel** : premier commit réalisé.
- Commit : `Etape 0 - Partie 1: scaffolding, securite, base de donnees (mysql)`
- Fichiers suivis : `.gitignore`, `.env.example`, `docker-compose.yml`, `generate_keys.sh`, `backend/.gitkeep`, `pwa/.gitkeep`
- Fichiers correctement exclus (vérifié par `git status` avant commit) : `.env`, `keys/private.pem`, `keys/public.pem`
- Branche : `master`
- Remote : aucun pour l'instant — en attente de la configuration GitLab (URL du projet + méthode d'authentification), voir échange dédié.

---

## Étape 0 — Partie 2 : Proxy HTTPS, backend minimal, orchestration complète

### Vue d'ensemble

Objectif : rendre le réseau Docker opérationnel de bout en bout — un backend Express répondant derrière un proxy HTTPS — sans encore implémenter de logique métier (jeton, validation, géofence). Cette partie ferme le point de vigilance n°5 de la revue de cohérence (« contexte sécurisé à traiter dès l'infra ») et complète le `docker-compose.yml` amorcé en Partie 1.

### Pourquoi le HTTPS est obligatoire dès le premier jour (et pas seulement « une bonne pratique »)

Trois API navigateur indispensables au projet refusent de s'exécuter hors contexte sécurisé (HTTPS), au sens strict de la spécification W3C Secure Contexts :

- **Web Cryptography API** (2.3.5) : sans elle, impossible de générer la paire de clés ECDSA non extractible qui enrôle l'appareil étudiant (RF-07) — le mécanisme qui ferme V3.
- **`getUserMedia`** (2.3.9) : sans elle, impossible d'accéder à la caméra pour scanner le QR (RF-10).
- **Service Worker** (2.3.8) : sans lui, impossible d'implémenter le mode dégradé (RF-15/16, QR1) — pas de file locale, pas de synchronisation différée.

Un navigateur qui charge la PWA en HTTP simple ne proposera littéralement pas ces API au code JavaScript (elles sont `undefined`, pas seulement « déconseillées »). Poser le HTTPS maintenant, avant tout code applicatif qui en dépend, évite de découvrir cette contrainte bloquante au moment de coder la PWA — ce qui aurait forcé une reprise d'architecture a posteriori.

**Nuance importante, à ne pas perdre de vue pour la suite** : les navigateurs traitent nativement `http://localhost` (et `127.0.0.1`) comme une origine « potentiellement de confiance », donc comme un contexte sécurisé, **même sans TLS**. Le test HTTPS mis en place ici sur `localhost`/`api.localhost` valide donc la mécanique du proxy Caddy et le routage `/api/*` vers le backend — mais il ne valide pas encore, à lui seul, la contrainte réelle du terrain : un téléphone étudiant qui rejoint le serveur via une adresse du réseau local de l'établissement (une IP ou un nom d'hôte qui n'est pas littéralement `localhost`) n'aura **pas** ce contexte sécurisé automatique et exigera un certificat TLS valide pour cette origine précise. Cette validation-là n'aura de sens qu'à l'étape PWA (scan caméra depuis un vrai appareil sur le LAN) — à traiter explicitement à ce moment-là, pas oubliée ici.

### Fichiers créés ou modifiés

```
.
├── Caddyfile               (nouveau)
├── docker-compose.yml      (complété : services backend, proxy, réseau, volumes Caddy)
├── README.md                (nouveau)
├── TESTING.md               (nouveau)
└── backend/
    ├── package.json         (nouveau)
    ├── package-lock.json    (nouveau, généré par npm)
    ├── server.js             (nouveau)
    └── Dockerfile            (nouveau)
```

### 1. `Caddyfile`

**Rôle** : point d'entrée HTTPS unique du système. Termine le TLS avant que le trafic n'atteigne le backend, et route `/api/*` vers le service `backend` sur le réseau Docker interne.

**Choix justifiés** :
- `tls internal` : indique explicitement à Caddy d'agir comme sa propre autorité de certification locale plutôt que de tenter d'obtenir un certificat public (Let's Encrypt), impossible pour un nom d'hôte non public comme `localhost`. Le certificat émis est cryptographiquement valide (chaîne de confiance complète, algorithmes standards) mais son autorité n'est pas préinstallée dans le magasin de confiance du système d'exploitation hôte — d'où l'avertissement navigateur documenté dans `TESTING.md`. Rendre ce choix explicite (plutôt que de laisser Caddy le déduire implicitement du nom d'hôte) documente l'intention dans le fichier de configuration lui-même.
- Deux noms d'hôte déclarés (`localhost`, `api.localhost`) : `localhost` pour un accès direct simple, `api.localhost` en anticipation d'une convention de nommage plus proche de ce qui sera utilisé en LAN (`api.<etablissement>.local` ou équivalent) — sans avoir à modifier la structure du Caddyfile plus tard, seulement les noms d'hôte.
- `handle /api/*` / `handle` (bloc par défaut) : sépare explicitement le trafic applicatif (relayé au backend) de tout le reste (réponse informative), plutôt qu'un `reverse_proxy` global qui masquerait une éventuelle mauvaise route.
- `encode gzip` : compression standard, coût de configuration nul, bénéfice direct sur la taille des réponses JSON une fois l'API plus riche.
- `log { output stdout }` : les logs du proxy sortent sur la sortie standard du conteneur, consultables par `docker compose logs proxy` — pas de fichier de log à gérer manuellement pour un prototype.
- `admin off` : désactive l'API d'administration locale de Caddy (port 2019), qui n'a aucune utilité ici et n'a pas à être exposée, même en interne — réduction de surface par défaut, cohérente avec la posture de sécurité du projet.

### 2. `backend/server.js`, `backend/package.json`, `backend/Dockerfile`

**Rôle de `server.js`** : premier service applicatif du système, strictement limité à une route `GET /api/health`. Sert à valider la chaîne complète — client → Caddy (HTTPS) → réseau Docker interne → backend → réponse — avant d'y ajouter la moindre logique métier (jeton, cascade de validation). Aucune connexion MySQL, aucune route liée au chapitre 5 : volontairement minimal, conformément à la mission.

**Pourquoi Express** : c'est le choix déjà acté dans l'architecture des composants (chapitre 4.2, package backend Node.js/Express) — pas une redécouverte, une continuité. Express 5 (version installée par `npm install express`, la dernière stable disponible) est rétro-compatible avec ce besoin minimal ; aucune des ruptures de compatibilité de la version 5 (gestion des erreurs asynchrones, syntaxe des routes à paramètres) n'affecte une route simple sans paramètre comme `/api/health`.

**`package.json`** : `main` pointé sur `server.js` (pas le `index.js` par défaut de `npm init -y`, corrigé pour refléter le fichier réel) ; script `start` ajouté pour un lancement homogène (`npm start`), utilisé implicitement par le `CMD` du Dockerfile.

**`Dockerfile` (mode développement)** :
- `node:20-alpine` : image légère, aucune dépendance native dans ce projet (pas de compilation requise), donc pas besoin d'une image `-slim` ou complète.
- `COPY package*.json ./` suivi de `RUN npm install` **avant** `COPY . .` : exploite le cache de layers Docker — tant que les dépendances ne changent pas, `npm install` n'est pas ré-exécuté à chaque modification de `server.js`, ce qui accélère les reconstructions pendant le développement itératif des prochaines briques.
- `EXPOSE 3000` : documentaire (n'ouvre aucun port vers l'hôte à lui seul — c'est `docker-compose.yml` qui décide de publier ou non un port). Cohérent avec le choix de ne publier aucun port pour `backend` : seul Caddy est joignable depuis l'extérieur du conteneur hôte.
- `CMD ["node", "server.js"]` : lancement direct, sans `nodemon` ni rechargement à chaud — volontairement minimal pour cette étape ; un outillage de développement plus confortable pourra être ajouté sans changer la structure si le besoin se fait sentir.

**Test effectué hors Docker** (Docker n'étant pas disponible dans l'environnement où j'exécute ces commandes) : `node server.js` lancé directement, `curl http://localhost:3000/api/health` a retourné exactement `{"status":"ok","message":"Backend is running securely"}` — la logique applicative est donc validée indépendamment de la conteneurisation. Le test en conditions réelles (via Docker et le proxy HTTPS) est à effectuer sur ta machine, protocole détaillé dans `TESTING.md`.

### 3. `docker-compose.yml` — services `backend` et `proxy`, réseau `presence_net`

**Service `backend`** :
- `build: { context: ./backend, dockerfile: Dockerfile }` : construit l'image depuis le Dockerfile ci-dessus plutôt que d'utiliser une image publique — c'est notre code, pas un service tiers.
- Variables d'environnement injectées : `PORT`, `NODE_ENV`, et déjà les variables MySQL (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`) — non consommées par `server.js` à ce stade, mais déclarées maintenant pour que le contrat d'environnement du service soit stable avant l'étape « modèle de données », qui n'aura qu'à les lire.
- `depends_on: mysql: condition: service_healthy` : le backend n'est démarré qu'une fois MySQL réellement prêt (grâce au `healthcheck` défini en Partie 1) — anticipe la connexion à la base qui sera ajoutée à l'étape suivante, évite une classe d'erreurs de démarrage en cascade.
- Aucun port publié : seul Caddy est joignable depuis l'hôte, conformément au diagramme de déploiement (4.3).

**Service `proxy`** :
- `image: caddy:2-alpine` : image officielle, légère.
- `ports: ["80:80", "443:443"]` : seul point d'entrée externe du système, cohérent avec l'architecture (4.3) où le proxy est le seul composant exposé.
- `volumes` : le `Caddyfile` est monté en lecture seule (`:ro`) — Caddy ne doit jamais pouvoir modifier sa propre configuration depuis l'intérieur du conteneur. Deux volumes nommés supplémentaires, `caddy_data` et `caddy_config`, persistent l'autorité de certification interne et les certificats émis : sans eux, Caddy régénérerait une nouvelle CA à chaque redémarrage du conteneur, ce qui obligerait à re-approuver un nouveau certificat dans le navigateur à chaque fois — une gêne inutile en développement itératif.
- `depends_on: backend` : ordre de démarrage logique (le proxy route vers le backend, autant qu'il existe déjà au démarrage), bien que Caddy gère de toute façon les erreurs de connexion en amont avec retries.

**Réseau `presence_net`** : réseau bridge nommé explicitement plutôt que de laisser Docker Compose créer un réseau par défaut sans nom clair — les trois services s'y résolvent par leur nom de service (`mysql`, `backend`, `proxy`), ce qui est déjà ce qu'utilise `Caddyfile` (`reverse_proxy backend:3000`) et ce que backend utilisera pour joindre MySQL (`MYSQL_HOST=mysql`) à l'étape suivante.

**Validation effectuée** : syntaxe YAML vérifiée par parsing, trois services bien déclarés (`mysql`, `backend`, `proxy`). Docker n'étant pas disponible dans cet environnement d'exécution, le démarrage réel (`docker compose up -d`) reste à valider sur ta machine — protocole complet dans `TESTING.md`.

### 4. `README.md`

**Rôle** : point d'entrée minimal pour quiconque clone le dépôt, conformément à RNF-15 (déploiement sans compétence d'administration avancée). Prérequis (Docker, Git), commande unique (`docker compose up -d`), et l'avertissement de certificat local anticipé explicitement — pour qu'il ne soit jamais interprété comme un échec de déploiement.

### 5. `TESTING.md`

Nouveau fichier séparé de `ANALYSE_CODE.md` : celui-ci explique les choix d'architecture (le « pourquoi »), `TESTING.md` est un protocole opérationnel (le « comment vérifier ») — les deux publics et les deux usages sont différents, d'où deux fichiers plutôt qu'une section de plus dans un document déjà long. Contenu détaillé dans le fichier lui-même.

---

## Étape 1 — Modélisation de la base de données et connexion backend

### Vue d'ensemble

Objectif : faire exister le modèle de données du chapitre 4.4 sous forme de vraies tables MySQL, les peupler d'un jeu de démonstration, et prouver que le backend peut réellement les interroger — via une nouvelle route `/api/db-health` qui ne se contente pas de vérifier « le tuyau réseau » mais valide schéma + données en une seule requête.

### Fichiers créés

```
database/
├── 01-schema.sql          (nouveau)
├── 02-seed.sql             (nouveau)
└── 03-privileges.sh        (nouveau)
backend/
├── src/config/db.js         (nouveau)
├── package.json              (modifié : + mysql2)
└── server.js                  (modifié : + route /api/db-health)
docker-compose.yml            (modifié : volume d'init DB, variables attestations)
.env.example / .env           (modifiés : variables MYSQL_ATTESTATIONS_*)
```

### Pourquoi SQL brut (`mysql2/promise`) et aucun ORM — choix architectural fort

C'est la décision la plus structurante de cette étape, à défendre explicitement devant le jury. Quatre arguments, pas une préférence de style :

**1. Contrôle exact des contraintes qui ferment les vecteurs de fraude.** La contrainte `UNIQUE(jti, etudiant_id)` sur `scans` (fermeture de V4, section 2.3.4/4.4) et la colonne générée `actif_key` sur `appareils_enroles` (émulation d'un index unique partiel pour RF-09, fermeture de V3) sont des mécanismes SQL avancés — colonnes générées `STORED`, index composites — que la plupart des ORM (Sequelize, TypeORM, Prisma) expriment mal ou pas du tout nativement, obligeant soit à sortir de l'abstraction (SQL brut *quand même*, mais caché derrière une couche supplémentaire), soit à migrer la contrainte côté application (perte de la garantie *au niveau du moteur*, donc contournable par un bug applicatif). Écrire le DDL à la main donne un accès direct à toute la richesse de MySQL, sans négociation avec un traducteur générique.

**2. Traçabilité exigée par le Décret de 1991 et la Loi de 1985.** Chaque requête SQL de ce projet doit être auditable — au sens propre : un tiers doit pouvoir lire *exactement* ce qui est exécuté contre la base, sans deviner ce qu'un générateur de requêtes a produit à partir d'un DSL objet. Le SQL brut rend cette lecture directe : `03-privileges.sh` contient littéralement les `GRANT`/`REVOKE` appliqués, `db.js` contient littéralement les requêtes envoyées. Un ORM interpose une couche de traduction (souvent optimisée pour la commodité, pas pour la lisibilité du SQL final) entre l'intention et l'exécution — un obstacle inutile pour une soutenance où chaque choix doit être justifiable ligne à ligne.

**3. Cohérence avec le principe de minimisation des dépendances (RNF-15).** Un ORM ajoute une surface de code tierce non négligeable (dialecte SQL généré, système de migrations propriétaire, couche de mapping objet-relationnel) pour un bénéfice quasi nul sur un schéma de neuf tables qui ne changera pas de moteur de base de données. `mysql2/promise` est un driver, pas un framework : il traduit des appels JavaScript en connexions TCP et en résultats de requêtes, rien de plus. Moins de dépendances, moins de surface de mise à jour de sécurité, moins de comportement « magique » à expliquer en défense.

**4. Séparation infra/application déjà actée (voir confirmation ci-dessous).** Le schéma vit dans `database/`, provisionné par Docker au démarrage — un ORM aurait naturellement tiré cette responsabilité vers le code applicatif (migrations versionnées dans le repo backend, exécutées au boot ou via une CLI dédiée), ce qui aurait dilué la frontière nette actuellement en place entre « ce que l'infrastructure garantit » et « ce que l'application interroge ».

**Limite assumée, à ne pas cacher** : sans ORM, il n'y a pas de protection automatique contre l'injection SQL par construction — c'est la responsabilité du code applicatif d'utiliser systématiquement des requêtes paramétrées (`pool.query(sql, [valeurs])`, jamais de concaténation de chaînes). Cette discipline sera appliquée dès la première requête paramétrée du chapitre 5 (aucune requête de ce projet, à ce jour, n'interpole une valeur utilisateur directement dans une chaîne SQL) et documentée à chaque brique où elle s'applique.

### Comment la séparation physique logs/attestations est garantie — pas seulement documentée

La séparation actée en 2.2.5/4.4/4.8 est mise en œuvre à **trois niveaux indépendants**, pas un seul :

1. **Deux bases logiques distinctes** (`CREATE DATABASE db_attestations` dans `01-schema.sql`, en plus de `db_logs` déjà créée par l'image officielle) — pas deux schémas dans la même base, deux bases MySQL à part entière.
2. **Aucune contrainte `FOREIGN KEY` entre elles** — `attestations.etudiant_id` et `attestations.uf_id` sont des colonnes `CHAR(36)` ordinaires, sans `REFERENCES` vers `db_logs.etudiants`/`db_logs.uf` (MySQL ne le permettrait de toute façon pas nativement entre deux bases, mais c'est surtout un choix délibéré, pas une limite technique subie). Conséquence directe et vérifiable : la purge de `db_logs` en fin d'UF (RF-20, future étape) ne peut **structurellement** jamais échouer à cause d'une contrainte d'intégrité référentielle vers `db_attestations`, et ne peut pas non plus supprimer en cascade une attestation déjà émise — il n'existe simplement aucun lien technique par lequel une suppression pourrait se propager.
3. **Deux utilisateurs MySQL aux privilèges disjoints** (`03-privileges.sh`) : `app_attestations` ne reçoit `SELECT, INSERT` que sur `db_attestations.*` ; `app_logs` (utilisateur du pool applicatif principal, `db.js`) ne reçoit **aucun** privilège sur `db_attestations` — en MySQL, l'absence de `GRANT` vaut refus total, il n'y a rien à révoquer explicitement pour l'interdire. Un bug ou une injection SQL réussie contre le pool applicatif standard ne pourrait donc, au pire, atteindre que `db_logs` : `db_attestations` resterait hors de portée même dans ce scénario dégradé, par construction du système de privilèges MySQL, pas par une vérification applicative contournable.

Un bénéfice de sécurité supplémentaire, obtenu avec ces `GRANT` explicites en cascade : `app_logs` part d'une base `SELECT, INSERT` sur **l'ensemble** de `db_logs.*`, puis ne regagne `UPDATE, DELETE` que sur les deux tables qui en ont réellement besoin aujourd'hui (`seances` pour la clôture RF-02, `appareils_enroles` pour la révocation de clé RF-08). `scans` et `corrections` restent donc en écriture seule (`INSERT` uniquement, jamais `UPDATE`/`DELETE`) — implémentation concrète, au niveau moteur, de l'exigence RF-18 (« le journal des corrections est en lecture seule ») et de l'auditabilité RNF-13 : même un bug applicatif ne peut pas altérer ou effacer une ligne de ces deux tables.

**Note de révision (correction post-implémentation)** : la première version de `03-privileges.sh` tentait un `REVOKE UPDATE, DELETE ON db_logs.scans FROM app_logs` ciblé, en partant du privilège `ALL PRIVILEGES` que l'image officielle accorde par défaut à `MYSQL_USER` au niveau de la *base* (`db_logs.*`). MySQL refuse ce `REVOKE` : une révocation doit cibler exactement le même niveau de granularité que l'octroi (`ERROR 1147`, *"There is no such grant defined ... on table"*), or le privilège avait été accordé au niveau base, pas table. La stratégie a été inversée : plutôt que « tout accorder puis révoquer étroit » (bloqué par cette règle), le script réduit d'abord `app_logs` à zéro privilège (`REVOKE ALL PRIVILEGES, GRANT OPTION`), accorde `SELECT, INSERT` sur l'ensemble de `db_logs.*`, puis regagne `UPDATE, DELETE` explicitement, table par table, uniquement là où c'est nécessaire. Le résultat est équivalent pour `scans`/`corrections`, et *plus strict* pour le reste (`etudiants`, `uf`, `salles`, `inscriptions` perdent aussi `UPDATE`/`DELETE`) — sans régression : aucune fonctionnalité codée à ce jour n'écrit autre chose que des `INSERT`/`SELECT` sur ces tables. Point de vigilance pour la suite : toute future exigence de modification de ces tables depuis le pool applicatif nécessitera un `GRANT UPDATE` explicite, à ajouter à ce script.

### 1. `database/01-schema.sql`

Traduction directe de l'ERD (4.4), table par table — voir le fichier lui-même pour le détail commenté de chaque table. Trois choix méritent d'être isolés ici :

- **`polygone_geojson` en type `JSON` natif, pas `SPATIAL`/`GEOMETRY`.** L'algorithme de géofencing retenu au chapitre 4 est PNPOLY (ray casting), exécuté côté application (Node.js) — pas une requête spatiale MySQL (`ST_Contains`). Stocker du GeoJSON pur conserve le format natif produit par la `Geolocation API` du navigateur, sans conversion vers/depuis un type binaire propriétaire, et reste directement lisible (`SELECT polygone_geojson`) pour une démonstration en défense — un `GEOMETRY` afficherait un binaire illisible sans fonction de conversion supplémentaire.
- **`appareils_enroles.actif_key`, colonne générée `STORED`.** MySQL ne supporte pas nativement la syntaxe `UNIQUE ... WHERE` (index unique partiel) qu'offre PostgreSQL. La colonne générée `IF(statut = 'actif', etudiant_id, NULL)` combinée à un index `UNIQUE` sur cette colonne est l'équivalent fonctionnel exact : MySQL autorise plusieurs `NULL` dans un index unique (jamais considérés en doublon) mais refuse deux lignes `actif` pour le même étudiant. RF-09 est ainsi garanti par le moteur de la base, pas seulement vérifié dans le code applicatif avant insertion (qui resterait contournable par un accès concurrent).
- **`corrections.scan_id` obligatoire (`NOT NULL`), sans exception.** Traduction littérale de l'ERD, qui ne montre pas ce champ comme nullable. Conséquence assumée : corriger une absence pour un étudiant qui n'a produit aucune tentative de scan nécessitera de créer d'abord une ligne `scans` de `resultat = 'manuel'` (le mécanisme déjà prévu par RF-22 pour la procédure de secours), puis la correction s'y rattache. Aucune présence ni absence corrigée n'existe donc jamais « hors sol », sans scan associé — cohérent avec l'exhaustivité exigée par le Décret de 1991 (S-J6).

### 2. `database/02-seed.sql`

Jeu de données de démonstration explicitement autorisé par le périmètre du prototype (3.1.2 : « jeu de données de démonstration provisionné au déploiement »). Choix délibéré d'UUID **fixes** plutôt que générés (`11111111-...`, `22222222-...`, `33333333-...`) : reproductibles à chaque déploiement, faciles à citer tels quels dans `TESTING.md` ou lors d'une démonstration, sans avoir à interroger la base au préalable pour retrouver un identifiant généré aléatoirement. Contenu : 1 UF (« Anglais - Niveau 2 »), 1 salle avec un polygone GeoJSON réel (rectangle englobant, cohérent avec la marge assumée documentée en 4.8), 4 étudiants fictifs, 4 inscriptions.

### 3. `database/03-privileges.sh`

Détaillé dans la section « séparation physique » ci-dessus. Un point d'implémentation à noter : ce fichier est un `.sh`, pas un `.sql`, précisément parce qu'il doit interpoler des secrets (`MYSQL_ATTESTATIONS_PASSWORD`) depuis les variables d'environnement du conteneur — un `.sql` exécuté par l'entrypoint officiel est transmis tel quel au client `mysql`, sans substitution de shell. C'est le mécanisme documenté par l'image officielle pour tout provisioning nécessitant un secret, pas un contournement improvisé.

La logique de privilèges applique un principe de liste blanche (*whitelist*) plutôt que liste noire (*blacklist*) : `app_logs` est ramené à zéro privilège (`REVOKE ALL PRIVILEGES, GRANT OPTION`), puis reçoit explicitement `SELECT, INSERT` sur toute `db_logs.*`, et enfin `UPDATE, DELETE` uniquement sur `seances` et `appareils_enroles`. Ce choix n'est pas qu'une préférence de style : une tentative initiale de liste noire (accorder tous les privilèges puis révoquer `UPDATE`/`DELETE` table par table sur `scans`/`corrections`) échouait avec `ERROR 1147` — MySQL exige qu'un `REVOKE` cible exactement le même niveau de granularité que l'octroi d'origine, or le privilège initial de `MYSQL_USER` est accordé au niveau base par l'image officielle, pas au niveau table. La liste blanche contourne cette contrainte nativement, puisque `GRANT` ne la subit pas.

### 4. `docker-compose.yml` — volume d'initialisation

Ajout d'un seul volume sur le service `mysql` : `./database:/docker-entrypoint-initdb.d:ro`. Monté en lecture seule — le conteneur MySQL ne doit jamais pouvoir modifier les scripts qui l'ont initialisé. Les deux nouvelles variables (`MYSQL_ATTESTATIONS_USER`, `MYSQL_ATTESTATIONS_PASSWORD`) ne sont injectées que dans l'environnement du service `mysql` (consommées par `03-privileges.sh`), jamais dans celui du `backend` — le pool applicatif principal n'a et n'aura aucune raison de les connaître.

### 5. `backend/src/config/db.js`

Pool de connexions `mysql2/promise`, pas une connexion unique partagée : chaque requête HTTP emprunte une connexion le temps de sa requête SQL puis la restitue. Une connexion unique partagée entre requêtes concurrentes mélangerait des résultats entre requêtes parallèles (un risque réel dès que plusieurs étudiants scannent simultanément, cas nominal de ce projet) ; ouvrir/fermer une connexion TCP à chaque requête serait inutilement coûteux. `connectionLimit: 10` est un choix de dimensionnement de prototype (largement suffisant pour l'échelle visée, ~150 étudiants, cf. RNF-09), ajustable sans changer la structure du code.

Le pool se connecte avec les identifiants `app_logs` (base `db_logs`) — **pas** avec `app_attestations` : ce pool est le pool applicatif général, `db_attestations` reste hors de sa portée par construction (cf. séparation ci-dessus). La connexion à `db_attestations` sera ajoutée avec le futur service d'attestation (RF-19), pas avant — pas de connexion prématurée à une base que rien n'utilise encore.

### 6. `backend/server.js` — route `GET /api/db-health`

Choix délibéré de ne **pas** se limiter à un `SELECT 1` : `SELECT COUNT(*) FROM etudiants` valide trois choses en une seule requête — (1) le pool atteint réellement MySQL à travers le réseau Docker interne, (2) `01-schema.sql` a bien créé la table, (3) `02-seed.sql` a bien inséré ses lignes. Un `SELECT 1` n'aurait prouvé que le point (1), laissant planer un doute sur l'exécution effective des scripts d'initialisation.

Gestion d'erreur explicite (`try/catch`) : si MySQL est injoignable, la route répond `500` avec un JSON structuré (`{"status":"error","database":"unreachable","message":...}`) plutôt que de laisser le processus Node planter ou de renvoyer une erreur HTML par défaut. **Testé sans Docker** dans l'environnement où ce code a été écrit (MySQL absent) : la route a répondu exactement `500 {"status":"error","database":"unreachable","message":"connect ECONNREFUSED 127.0.0.1:3306"}` — comportement défensif confirmé avant même le test en conditions réelles sur ta machine.

## Étape 2 — Backend cœur : jeton RS256, rotation, diffusion WebSocket

### Vue d'ensemble

Première brique du cœur métier : ouverture d'une séance (RF-01), génération de jetons signés RS256 (RF-04), et leur diffusion temps réel vers l'affichage formateur avec rotation stricte (RF-05/RF-06). Aucune validation de scan n'est encore implémentée à ce stade — cette étape produit et diffuse des jetons, elle ne les consomme pas encore (ce sera l'objet de la cascade de validation, étape suivante).

### Fichiers créés ou modifiés

```
backend/
├── src/services/tokenService.js      (nouveau)
├── src/services/qrBroadcaster.js      (nouveau)
├── src/controllers/seanceController.js (nouveau)
├── src/routes/seanceRoutes.js          (nouveau)
├── server.js                            (modifié : http.createServer, express.json, montage routes+WS)
├── package.json                          (modifié : + jsonwebtoken, uuid, ws)
└── .dockerignore                          (nouveau)
docker-compose.yml                        (modifié : volume keys/ sur le service backend)
```

### Pourquoi le TTL (25s) diffère de la rotation (20s) — le recouvrement n'est pas une marge de confort, c'est une nécessité

Ces deux constantes répondent à deux questions différentes, et les confondre serait une erreur de conception, pas seulement de vocabulaire :

- **La rotation (`ROTATION_INTERVAL_SECONDS = 20`)** gouverne l'affichage : combien de temps un jeton reste visible à l'écran du formateur avant d'être remplacé par le suivant. C'est la variable qui borne l'exploitation de V1 (partage de capture) — plus la fenêtre est courte, moins une photo transmise par SMS a de chances d'être encore valide au moment où le destinataire la scanne.
- **Le TTL (`TOKEN_TTL_SECONDS = 25`)** gouverne la validation côté serveur : combien de temps ce jeton précis reste acceptable, indépendamment de ce qui est actuellement affiché à l'écran.

Sans recouvrement (TTL = rotation = 20s), un étudiant qui scanne légitimement au moment exact de la rotation — capture de l'image à t≈19,9s, décodage + requête HTTP arrivant côté serveur à t≈20,3s à cause de la latence réseau documentée sur le terrain (S-T1, WiFi instable de l'ESA Namur) — se ferait rejeter un scan pourtant honnête, simplement parce que le jeton qu'il a capturé a expiré 0,3 seconde avant que sa requête n'arrive. Les 5 secondes de recouvrement (25 − 20) couvrent exactement ce délai capture → soumission, sans affaiblir la fermeture de V1 : un jeton reste visible 20s maximum, et n'est acceptable que 5s de plus après avoir disparu de l'écran — pas 5 minutes, pas indéfiniment.

**Point de conception à souligner** : ce recouvrement n'est implémenté nulle part comme un mécanisme dédié (pas de logique « accepter aussi le jeton n-1 »). Il émerge naturellement du fait que chaque jeton porte sa propre expiration indépendante (`exp = iat + 25s`, fixé par `tokenService.js` au moment de sa génération) et que la validation — future étape — ne vérifiera jamais que « l'horodatage actuel est antérieur à `exp` », sans notion de jeton « courant » ou « précédent ». À t=24s par exemple, le jeton émis à t=0 (encore valide 1s) et celui émis à t=20 (valide encore 21s) sont *tous les deux* acceptables simultanément — c'est exactement le comportement voulu, obtenu sans code supplémentaire. Moins de logique dédiée signifie moins de surface de bug sur un mécanisme de sécurité.

### 1. `backend/src/services/tokenService.js`

**Vocabulaire — `jti` plutôt que `nonce` littéral.** La mission de cette étape désigne le champ comme « nonce (UUID v4) », mais l'implémentation retient la revendication JWT standard **`jti`** (RFC 7519, *JWT ID*), déjà utilisée dans tout le reste du projet : RF-04 (« un nonce unique (jti) »), RF-14 (« couple (jti, étudiant) »), et la colonne `scans.jti` du schéma construit à l'Étape 1. Nommer littéralement le champ `nonce` dans le payload aurait créé une divergence de vocabulaire avec une base de données et une documentation déjà figées — le code de la cascade de validation (étape suivante) aurait dû lire `payload.nonce` pour l'insérer dans une colonne `jti`, sans raison. `jti` est produit via l'option native `jwtid` de `jsonwebtoken`, qui l'ajoute au payload exactement comme `iat`/`exp` sont ajoutés via `expiresIn` — aucune revendication n'est construite manuellement.

**`algorithm: 'RS256'` explicite dans `jwt.sign()` — non négociable.** Sans cette option, `jsonwebtoken` retombe sur `HS256` par défaut, quel que soit le type de clé fournie. Un `HS256` appliqué à une clé privée RSA reviendrait à traiter cette clé comme un secret partagé HMAC — exactement la classe de vulnérabilité connue sous le nom d'*algorithm confusion* sur les JWT (un jeton HS256 peut ensuite être forgé par quiconque connaît, ou obtient, la clé « secrète » utilisée pour le vérifier ; ici la clé publique RSA, publique par définition). Testé explicitement (voir section Tests ci-dessous) : une vérification en `HS256` avec la clé publique comme secret est bien rejetée par `jsonwebtoken`, confirmant que l'algorithme signé (`RS256`, encodé dans l'en-tête du JWT) est correctement contraint des deux côtés.

**Lecture de la clé au chargement du module, pas à chaque appel.** La clé privée est lue une seule fois (`fs.readFileSync` au niveau module, hors de toute fonction) : elle ne change jamais en cours d'exécution, et une lecture disque par jeton généré serait un coût inutile, potentiellement fréquent (une rotation toutes les 20s, pour chaque séance active en parallèle). Si la clé est absente, le module lève une exception **au chargement** (`require('./tokenService')` échoue), pas à la première utilisation : le backend refuse de démarrer plutôt que de démarrer « à moitié » et de planter au premier formateur qui ouvre une séance. Message d'erreur explicite renvoyant vers `./generate_keys.sh`.

**Résolution du chemin de la clé.** `JWT_PRIVATE_KEY_PATH` (`.env` : `./keys/private.pem`) est résolu par `path.resolve()`, qui l'interprète relativement à `process.cwd()` — en conteneur, `WORKDIR /app` (Dockerfile), donc `/app/keys/private.pem`, exactement le point de montage ajouté au `docker-compose.yml` cette étape (voir plus bas). En l'absence de variable d'environnement (exécution locale hors Docker), repli sur un chemin relatif au fichier lui-même (`__dirname/../../../keys/private.pem`, soit la racine du dépôt) — un développeur lançant `node server.js` sans configurer son `.env` obtient tout de même un comportement correct.

### 2. `backend/src/controllers/seanceController.js` + `src/routes/seanceRoutes.js`

**Génération de l'identifiant côté application, pas via le `DEFAULT (UUID())` du schéma.** Détail technique précis à noter : `01-schema.sql` définit `id CHAR(36) DEFAULT (UUID())`, qui s'applique quand la colonne `id` est omise de l'`INSERT` — mais `mysql2` (comme tout driver MySQL) n'expose l'identifiant généré côté serveur que via `result.insertId`, un champ réservé aux colonnes `AUTO_INCREMENT`, toujours vide pour une valeur par défaut de type expression. Sans génération applicative, retourner l'`id` de la séance créée dans la réponse HTTP aurait nécessité une requête de lecture supplémentaire immédiatement après l'insertion — elle-même fragile en cas d'insertions concurrentes (quelle ligne relire ?). La solution retenue (`uuidv4()` généré en Node, inséré explicitement) est plus simple, sans requête supplémentaire, et cohérente avec la génération du `jti` du jeton par le même mécanisme.

**Distinction 400 / 500 sur l'échec d'insertion.** Une contrainte `FOREIGN KEY` violée (`uf_id` ou `salle_id` inexistant) produit le code d'erreur `ER_NO_REFERENCED_ROW_2` côté MySQL — capturé explicitement pour renvoyer un `400` avec un message clair, plutôt qu'un `500` générique qui masquerait une erreur de saisie du client derrière une apparence de panne serveur.

### 3. `backend/src/services/qrBroadcaster.js`

**Chemin WebSocket sous `/api/ws/seances/<id>`, pas sous une racine `/ws/` séparée.** Le `Caddyfile` actuel (Étape 0.2) ne relaie que `/api/*` vers le backend ; tout le reste tombe dans le bloc `handle` par défaut. Placer le WebSocket sous `/api/` évite une modification du `Caddyfile` à cette étape — Caddy relaie nativement les upgrades WebSocket à travers `reverse_proxy` sans configuration supplémentaire, une seule règle de routage à maintenir (`/api/*` vers `backend:3000`) plutôt que deux.

**`salle_id` lu en base à la connexion, jamais fourni par le client WebSocket.** C'est le point de conception le plus important de ce fichier. Le formateur pourrait théoriquement fournir n'importe quelle valeur dans l'URL ou une query string — mais le `salle_id` embarqué dans chaque jeton signé est précisément la donnée que la future vérification de géofencing (RF-13) comparera à la position GPS de l'étudiant. Faire confiance à une valeur fournie par le client à cet endroit romprait la garantie même que le géofencing est censé apporter : un jeton pourrait prétendre appartenir à une salle différente de la séance réellement ouverte. La requête `SELECT salle_id, statut FROM seances WHERE id = ?` au moment de la connexion fait de la base de données la seule autorité sur cette valeur.

**Effet de bord positif : `RF-02` (aucun jeton après clôture).** La même requête vérifie `statut = 'ouverte'` et rejette (HTTP 409) toute connexion à une séance close ou inexistante (HTTP 404). Une séance clôturée cesse ainsi de recevoir de nouveaux jetons — cohérent avec RF-02, même si RF-02 porte formellement sur le rejet des *scans* après clôture (étape suivante) plutôt que sur l'arrêt de la diffusion elle-même.

**`clearInterval` systématique à la fermeture.** Chaque connexion WebSocket ouvre son propre minuteur de rotation (`setInterval`). Sans nettoyage explicite au `close`/`error`, chaque rechargement de la page formateur ou coupure réseau laisserait un minuteur orphelin tourner indéfiniment côté serveur : fuite mémoire, et génération continue de jetons RS256 qui ne seront plus jamais ni affichés ni scannés — un gaspillage silencieux qui s'aggraverait à chaque reconnexion.

**Simplification assumée : un minuteur par connexion, pas un minuteur partagé par séance.** Si plusieurs onglets formateur se connectent à la même séance, chacun reçoit son propre flux de jetons, avec des `jti` différents et une phase de rotation non synchronisée (chaque flux tourne indépendamment toutes les 20s à partir de l'instant de sa propre connexion). Ce n'est pas un problème de sécurité — chaque jeton reste individuellement valide et fermera V4 indépendamment — mais un onglet dupliqué afficherait un QR différent de l'écran de projection principal. Non traité ici : le cas d'usage nominal du prototype est un unique écran de projection par séance (chapitre 3, CU-1). Un minuteur unique par séance, partagé entre connexions (modèle pub/sub), serait l'évolution naturelle si le multi-écran devenait un besoin réel.

### 4. `docker-compose.yml` — volume `keys/` sur le service `backend`

**Gap corrigé, pas seulement ajouté.** Le service `backend` ne montait jusqu'ici aucun accès au dossier `keys/` — un oubli resté sans conséquence tant qu'aucun code ne lisait la clé privée (Étapes 0-1). Cette étape l'aurait rendu bloquant : `tokenService.js` aurait échoué au chargement du module dans le conteneur (fail-fast volontaire, cf. plus haut), empêchant tout le backend de démarrer. Le volume est monté en lecture seule (`:ro`) — le conteneur backend n'a et n'aura jamais de raison d'écrire dans ce dossier.

### 5. `backend/.dockerignore`

Ajouté à cette étape car désormais réellement utile : `npm install jsonwebtoken uuid ws` exécuté localement (pour les tests décrits ci-dessous) a créé un `node_modules/` sur la machine où ce code est écrit. Sans `.dockerignore`, `COPY . .` dans le `Dockerfile` copierait ce `node_modules` hôte par-dessus celui fraîchement installé par `RUN npm install` À L'INTÉRIEUR du conteneur (la séquence du `Dockerfile` fait `RUN npm install` puis `COPY . .` — dans cet ordre, un `node_modules` présent dans le contexte de build écrase silencieusement le résultat de l'installation conteneurisée). Aucune des dépendances actuelles n'a de binaire natif (toutes sont du JavaScript pur), donc ce risque n'aurait probablement pas provoqué de crash immédiat sur ce projet précis — mais c'est le genre de désynchronisation silencieuse (version installée ≠ version de `package-lock.json`) qui ne se découvre qu'au pire moment. Corrigé maintenant, pas laissé pour plus tard.

### Tests effectués sans Docker (MySQL indisponible dans cet environnement, `sudo` bloqué — impossible d'installer un serveur MySQL local pour un test bout-en-bout complet)

- **`tokenService.js`, avec les vraies clés générées à l'Étape 0.1** : jeton signé puis vérifié avec la clé publique seule → payload conforme (`session_id`, `salle_id`, `jti` UUID, `iat`, `exp`), **`exp − iat = 25` confirmé exactement**. Vérification avec une mauvaise clé → rejetée. Vérification en forçant `algorithms: ['HS256']` avec la clé publique comme secret → rejetée (confusion d'algorithme bloquée dans les deux sens). Deux appels consécutifs → deux `jti` distincts.
- **`POST /api/seances`, serveur réel lancé en local (Node, hors Docker), MySQL injoignable** : requête valide → `500` propre avec message clair (pas de crash) ; requête sans `uf_id`/`salle_id` → `400` avec message de validation, sans jamais atteindre la base.
- **WebSocket, même serveur** : connexion à `/api/ws/seances/<uuid>` avec MySQL injoignable → upgrade rejeté avec `500` HTTP explicite (le client WS reçoit un `unexpected-response`, pas un crash serveur) ; connexion à un chemin ne correspondant pas au pattern (`/api/ws/n-importe-quoi`) → connexion fermée immédiatement, sans réponse.

Le test du chemin nominal complet (créer une séance réelle, se connecter en WebSocket, observer la rotation toutes les 20s avec des jetons portant le bon `salle_id` lu en base) nécessite un MySQL réel et reste à effectuer sur ta machine — protocole détaillé dans `TESTING.md`.

---

## Stratégie de test et pipeline CI/CD

### Vue d'ensemble

Cette étape ne livre aucune nouvelle exigence fonctionnelle : elle instrumente ce qui existe déjà (Étapes 1 et 2) avec des tests automatisés, et branche une pipeline GitLab CI qui les exécute à chaque `push` vers `dev`/`main` et à chaque Merge Request. Objectif direct : qu'une régression sur le TTL du jeton, la structure du payload, ou la connexion à la base soit détectée par la machine avant une relecture humaine — pas après.

### Correction rétroactive : `uuid` remplacé par `crypto.randomUUID()` (Étapes 2 corrigée)

**Le premier bénéfice concret de cette étape est arrivé avant même que les tests ne soient poussés** : écrire `tokenService.test.js` a immédiatement fait échouer Jest avec `SyntaxError: Unexpected token 'export'`, à l'intérieur de `node_modules/uuid/dist-node/index.js`. Cause précise : la version 14 du paquet `uuid` (installée à l'Étape 2) déclare `"type": "module"` et son build "node" (`dist-node/index.js`) est écrit en syntaxe ESM native (`export { ... } from './max.js'`). Node.js 22 sait charger ce fichier via `require()` grâce à son support natif (et récent) du chargement synchrone de modules ESM — c'est pourquoi le script de test manuel de l'Étape 2 (exécuté directement via `node`, hors Jest) fonctionnait sans erreur. Jest, lui, implémente son propre système de résolution et de transformation de modules (`jest-resolve`/`jest-runtime`), indépendant de celui de Node, et n'applique aucune transformation aux fichiers situés dans `node_modules` par défaut : il se heurte donc directement à la syntaxe `export`, qu'il ne sait pas interpréter.

Trois options existaient : contourner via `transformIgnorePatterns` dans `jest.config.js` (fragile, un correctif de configuration pour un problème qui n'aurait jamais dû exister) ; revenir à une version antérieure de `uuid` dotée d'un build CommonJS classique (fige une dépendance à une version obsolète pour des raisons accidentelles) ; ou supprimer la dépendance. **`crypto.randomUUID()`** — fonction native de Node.js depuis la version 14.17, stable depuis longtemps, disponible dans l'image `node:20-alpine` du `Dockerfile` sans rien installer — génère exactement le même format (UUID v4, RFC 4122) sans aucune des trois options précédentes. Remplacé dans les deux points d'usage : `tokenService.js` (génération du `jti`) et `seanceController.js` (génération de l'`id` de séance). Le paquet `uuid` est retiré de `package.json` (`npm uninstall uuid`) : une dépendance externe en moins, cohérent avec le principe de minimisation déjà invoqué pour justifier l'absence d'ORM (Étape 1) — et zéro risque résiduel de ce type d'incompatibilité, puisqu'il n'y a plus de paquet tiers à faire évoluer sous nos pieds.

Ce n'est pas un détail anecdotique : c'est la démonstration, dès le premier test écrit, de ce pour quoi une suite de tests automatisés existe.

### Pourquoi Jest + Supertest pour le backend (et pas un autre framework)

**Jest** est retenu comme exécuteur de tests unitaires et d'intégration : intégré (assertions, mocks, couverture, watch mode) sans empiler des paquets séparés (Mocha + Chai + Sinon + nyc, par exemple), ce qui correspond au même principe de minimisation des dépendances déjà appliqué à `mysql2`/pas-d'ORM. **Supertest** s'y branche naturellement : il sait interroger directement un objet `app` Express (`request(app).get(...)`) sans jamais ouvrir de socket sur un port réel — chaque requête de test instancie et referme son propre serveur HTTP éphémère en interne. C'est ce qui a motivé le refactor de `server.js` (voir plus bas) : sans un `app` exporté indépendamment de l'appel à `.listen()`, Supertest n'aurait rien à quoi s'attacher.

### E2E différé à l'Étape 7 — pas oublié, pas encore pertinent

Aucun test de bout en bout (parcours navigateur complet : ouverture de séance, affichage du QR, scan par un étudiant) n'est mis en place ici, et ce n'est pas un oubli. Un test E2E exercerait une interface qui n'existe pas encore : ni la PWA étudiante (scan, WebCrypto, mode dégradé), ni l'interface de projection formateur ne sont construites à ce stade — seules des routes HTTP/WebSocket nues existent. Écrire des tests Playwright contre une interface non développée reviendrait soit à tester des pages qui n'existent pas, soit à construire des interfaces jetables uniquement pour les besoins du test, un gaspillage d'effort double. **Playwright** est retenu par anticipation (peut piloter un vrai navigateur, y compris les API contraintes au contexte sécurisé HTTPS comme `getUserMedia`/WebCrypto — essentiel pour tester la PWA) mais son introduction est explicitement reportée à l'Étape 7, une fois la PWA et l'interface formateur codées (chapitre 5, dernières briques). Jest/Supertest couvrent d'ici là très largement la logique serveur, seule chose qui existe.

### Fichiers créés ou modifiés

```
backend/
├── jest.config.js                  (nouveau)
├── tests/
│   ├── tokenService.test.js         (nouveau)
│   └── health.test.js                (nouveau)
├── server.js                          (modifié : app/httpServer exportés, garde require.main)
├── src/services/tokenService.js       (modifié : uuid -> crypto.randomUUID())
├── src/controllers/seanceController.js (modifié : uuid -> crypto.randomUUID())
└── package.json                        (modifié : + jest, supertest ; script "test" ; - uuid)
database/03-privileges.sh              (modifié : -h "${MYSQL_HOST:-localhost}")
.gitlab-ci.yml                          (nouveau)
```

### 1. `backend/server.js` — refactor pour rendre le backend testable

**Changement structurel, pas additif.** Avant cette étape, `server.js` créait l'application, l'attachait au serveur HTTP, et appelait `httpServer.listen(PORT, ...)` de façon inconditionnelle, sans rien exporter. Un tel fichier ne peut pas être `require()`-é par un test : soit l'import démarre un vrai serveur en écoute sur le port applicatif (conflit si plusieurs suites de test tournent, port déjà occupé si un vrai backend Docker tourne en parallèle), soit il ne donne accès à rien d'exploitable par Supertest.

Deux ajouts minimaux, sans toucher à la logique métier existante :
- `if (require.main === module) { httpServer.listen(...) }` : `require.main === module` n'est vrai que lorsque `server.js` est le point d'entrée direct du process (`node server.js`, ou le `CMD` du `Dockerfile`) — faux lorsqu'il est importé depuis `tests/health.test.js` via `require('../server')`. Le comportement de production (`docker compose up`) est strictement inchangé.
- `module.exports = { app, httpServer };` : expose l'objet Express à Supertest sans jamais avoir besoin d'un port réseau réel.

### 2. `backend/jest.config.js`

- `testEnvironment: 'node'` : explicite, pas laissé au défaut historique de Jest (`jsdom`, pensé pour du code front-end) — ce projet n'a ni DOM ni navigateur côté backend.
- `testMatch: ['**/tests/**/*.test.js']` : le motif par défaut de Jest aurait de toute façon trouvé ces fichiers, mais l'expliciter documente l'intention sans obliger un lecteur à connaître les conventions internes de Jest.
- `detectOpenHandles: true` : signale explicitement toute connexion, socket ou minuteur non refermé en fin de suite — le complément direct de la règle d'or de cette étape (« gérer proprement le teardown »). Ce réglage ne corrige rien lui-même, il rend visible tout oubli futur.
- `testTimeout: 10000` : borne la durée d'un test individuel — un MySQL qui ne répond jamais en CI ne doit pas faire tourner la pipeline indéfiniment.
- **Volontairement pas de `forceExit: true`** : cette option masquerait un teardown incomplet plutôt que de le signaler, exactement le contraire de ce que `detectOpenHandles` cherche à révéler. Le teardown réel (`pool.end()` explicite dans `health.test.js`) est la solution retenue, pas un contournement.

### 3. `backend/tests/tokenService.test.js` — test unitaire, aucune dépendance DB

Sept assertions, toutes contre le payload décodé avec la seule clé publique (jamais la clé privée) :
- **`exp - iat === 25` exactement** (`toBe`, pas une comparaison approximative) : c'est la règle métier explicitement demandée par cette mission, testée au sens strict.
- Présence et format d'un `jti` de type UUID v4 (le « nonce » du cahier des charges — voir Étape 2 pour la justification du choix de nom de revendication).
- Unicité du `jti` entre deux appels successifs.
- Fidélité de `session_id`/`salle_id` au payload.
- Rejet si l'algorithme est forcé à `HS256` avec la clé publique comme secret (protection anti *algorithm confusion*, déjà testée manuellement à l'Étape 2 — désormais automatisée et rejouée à chaque `push`).
- Erreur explicite si `sessionId`/`salleId` manquant.
- Cohérence des constantes `ROTATION_INTERVAL_SECONDS`/`TOKEN_TTL_SECONDS` et de leur écart de 5 secondes.

**Exécuté dans l'environnement où ce code est écrit (Docker indisponible, mais aucune dépendance DB requise) : 7/7 tests passent.**

### 4. `backend/tests/health.test.js` — test d'intégration Supertest

Deux suites : `GET /api/health` (aucune dépendance DB, doit toujours passer) et `GET /api/db-health` (nécessite un MySQL réellement joignable, avec le schéma et le seed chargés). L'assertion `etudiants_count === 4` n'est pas un chiffre arbitraire : c'est la valeur exacte du seed (`02-seed.sql`, Étape 1) — une valeur différente signalerait soit un seed non chargé, soit une modification du seed sans mise à jour de ce test, dans les deux cas un signal utile plutôt qu'une assertion permissive (`toBeGreaterThan(0)`) qui masquerait le problème.

`afterAll(() => pool.end())` : le pool `mysql2` est créé au chargement de `src/config/db.js`, importé transitivement via `require('../server')`. Sans cette fermeture explicite, le handle TCP resterait ouvert après la fin des tests — exactement ce que `detectOpenHandles: true` est configuré pour révéler.

**Exécuté dans l'environnement où ce code est écrit, sans MySQL disponible (`sudo` bloqué, impossible d'en installer un — même limite que les étapes précédentes)** : `GET /api/health` passe (1/1) ; `GET /api/db-health` échoue avec un écart clair et attendu (`Expected: 200, Received: 500`), Jest se termine en 0,65s sans avertissement de handle ouvert ni blocage. C'est le comportement correct compte tenu de l'absence de base de données ici, pas un défaut du test ni du code — la validation complète (200 attendu, `etudiants_count: 4`) nécessite un MySQL réel et se fera soit sur ta machine (`docker compose up` puis `npm test`), soit automatiquement dans la pipeline GitLab CI décrite ci-dessous.

### 5. `database/03-privileges.sh` — ajout de `-h "${MYSQL_HOST:-localhost}"`

Modification d'une seule ligne, nécessaire pour que ce même script soit rejouable tel quel contre le service MySQL éphémère de la CI (voir ci-dessous), sans dupliquer sa logique dans un fichier séparé. Par défaut (`localhost`), le comportement en développement local (exécution à l'intérieur du conteneur MySQL via `docker-entrypoint-initdb.d`, où `MYSQL_HOST` n'est pas défini) est strictement inchangé.

### 6. `.gitlab-ci.yml` — documentation détaillée

**Déclenchement (`rules`)** : trois conditions en alternative (`OR` implicite entre les entrées d'une liste `rules`) — pipeline de Merge Request (`$CI_PIPELINE_SOURCE == "merge_request_event"`), push sur `dev`, push sur `main`. Exactement le périmètre demandé, rien de plus (pas de déclenchement sur des tags ou d'autres branches).

**`services: mysql:8.0`** : le mécanisme natif de GitLab CI pour lier un conteneur de service au job — reachable depuis le script via son `alias` (`mysql`) comme nom d'hôte, résolu par le DNS interne du job. **Différence essentielle avec `docker-compose`, à ne pas manquer** : les `services` GitLab ne supportent pas le montage de volumes hôte. Le mécanisme `/docker-entrypoint-initdb.d/` qui initialise automatiquement MySQL en local (Étape 1) ne s'applique donc *pas* ici — c'est pourquoi le `before_script` exécute explicitement `01-schema.sql`/`02-seed.sql`/`03-privileges.sh` comme des étapes de script, connectées au service par le réseau (`mysql -h "$MYSQL_HOST" ...`), plutôt que de compter sur un mécanisme d'auto-initialisation qui n'existe pas dans ce contexte.

**`command: ["--default-authentication-plugin=mysql_native_password"]`** sur le service : force le plugin d'authentification historique de MySQL plutôt que `caching_sha2_password` (par défaut depuis MySQL 8.0). Risque ciblé : le client `mysql` installé via `apt` dans l'image `node:20` (paquet `default-mysql-client`, généralement fourni par MariaDB sur Debian) a un historique documenté de mauvaise négociation de `caching_sha2_password`. Ce réglage ne concerne que ce client en ligne de commande utilisé pour l'initialisation — `mysql2` (utilisé par l'application et par Jest) supporte nativement les deux plugins, sans configuration particulière.

**Variables (`variables:`)** : valeurs de test jetables (`ci_root_test_pw`, etc.), sans aucun rapport avec les secrets de développement local (`.env`, jamais commité) ni un futur environnement de production — trois jeux de secrets pour trois contextes, jamais partagés. `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` sont construits en chemins **absolus** via la variable prédéfinie `$CI_PROJECT_DIR`, précisément pour éviter toute ambiguïté de résolution : le `before_script` s'exécute à la racine du dépôt (génération des clés), tandis que `script` se déplace dans `backend/` (`npm test`) — un chemin relatif aurait été résolu différemment selon l'étape où `tokenService.js` le lit.

**`before_script` — reprise systématique de l'existant plutôt qu'une réimplémentation pour la CI** :
1. Installation du client `mysql` (absent de `node:20` par défaut).
2. `./generate_keys.sh` : génère une paire de clés RS256 **strictement éphémère**, propre à cette exécution de pipeline, jamais persistée au-delà du job. Aucune clé réelle (développement ou production) ne transite jamais par la CI — il n'en existe d'ailleurs aucune dans le dépôt Git, par construction (`.gitignore`, Étape 0.1).
3. Boucle d'attente active (`mysqladmin ping`, 30 tentatives × 2s) : contrairement à `docker-compose` (`depends_on: condition: service_healthy`), les `services` GitLab CI ne bloquent pas le job tant que le service n'est pas prêt à accepter des connexions — cette boucle remplace ce que le `healthcheck` fait automatiquement en local.
4. Exécution de `01-schema.sql`, `02-seed.sql`, `03-privileges.sh` **tels quels** (à l'option `-h` près, ajoutée ci-dessus) : la CI valide donc la configuration réelle du projet, jamais une copie qui pourrait diverger silencieusement à mesure que le schéma évolue dans les étapes suivantes.

**`script`** : `cd backend && npm ci && npm test`. `npm ci` plutôt que `npm install` : installation stricte à partir de `package-lock.json` (déjà committé), plus rapide et déterministe — le comportement standard attendu d'une CI, jamais de résolution de version « la plus récente compatible » qui pourrait varier d'une exécution à l'autre.

### Risque accepté : vulnérabilités `npm audit` dans les dépendances de développement

`npm install --save-dev jest supertest` signale 19 vulnérabilités « high » lors de l'audit — toutes situées profondément dans l'arbre de dépendances de Jest lui-même (`brace-expansion` via `minimatch` via `glob` via `@jest/reporters`/`@jest/core`), jamais dans le code exécuté en production. Le correctif proposé par `npm audit fix --force` rétrograderait `jest` à la version `25.0.0` — cinq versions majeures en arrière, une régression inacceptable pour gagner la suppression d'un avertissement portant sur un outillage de test, dont la vulnérabilité (déni de service via un motif "glob" conçu pour être pathologique) suppose un attaquant capable de contrôler la configuration de test elle-même, un scénario hors de propos ici. Risque documenté et accepté tel quel, à réévaluer si une mise à jour mineure de Jest la corrige nativement (à vérifier périodiquement, pas à ce stade).

---

## Fix critique : `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` absentes de `docker-compose.yml`

### Symptôme observé

Après un incident local (`git clean -fd` ayant supprimé `.env` et `keys/` non suivis par Git), le conteneur `backend` entrait en crash-loop au démarrage réel via `docker compose up -d --build` :
```
Error: [tokenService] Impossible de lire la cle privee RS256 (/keys/private.pem) : ENOENT: no such file or directory, open '/keys/private.pem'.
```
Le chemin `/keys/private.pem` (sans `/app`) était le premier signal anormal : le volume de la clé est monté sur `/app/keys` (`docker-compose.yml`, fix de l'Étape 2), jamais sur `/keys` à la racine du système de fichiers du conteneur.

### Cause exacte, vérifiée par calcul

`tokenService.js` résout le chemin de la clé ainsi : utiliser `process.env.JWT_PRIVATE_KEY_PATH` s'il est défini, sinon retomber sur `path.resolve(__dirname, '../../../keys/private.pem')` — un chemin de secours pensé pour une exécution locale directe (`node server.js` lancé depuis un clone du dépôt, où `backend/src/services/` remonte bien de trois niveaux jusqu'à la racine du dépôt).

Le bug : `docker-compose.yml` montait déjà `./keys:/app/keys:ro` sur le service `backend` depuis l'Étape 2, mais **n'injectait jamais `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` dans l'environnement de ce service** — un oubli au moment d'ajouter ce volume. Résultat : dans le conteneur, la variable est toujours vide, et le chemin de secours s'active systématiquement. Or dans le conteneur, `__dirname` vaut `/app/src/services` (le `Dockerfile` ne copie que le contenu de `backend/`, pas le dépôt entier) ; remonter de trois niveaux depuis `/app/src/services` atterrit à la racine du système de fichiers (`/`), pas à `/app` — d'où `/keys/private.pem` plutôt que `/app/keys/private.pem`.

Vérifié par calcul direct (`path.resolve`) plutôt que supposé :
```
__dirname conteneur  (/app/src/services)  -> chemin de secours -> /keys/private.pem       (BUG, correspond exactement a l'erreur observee)
__dirname local      (<repo>/backend/...)  -> chemin de secours -> <repo>/keys/private.pem  (correct, explique pourquoi jamais detecte en local)
Avec JWT_PRIVATE_KEY_PATH injecte + cwd=/app -> /app/keys/private.pem                        (correct, correspond au point de montage)
```

**Ce bug est indépendant de l'incident `git clean -fd`.** Perdre `.env`/`keys/` était un vrai problème à corriger (fichiers non suivis par construction, cf. `.gitignore`), mais même avec un `.env` et des clés parfaitement restaurés, le conteneur aurait planté exactement de la même façon — la variable d'environnement critique n'était tout simplement jamais transmise au conteneur, quel que soit le contenu de `.env` sur l'hôte. C'est ce double diagnostic (incident hôte + bug latent dans `docker-compose.yml`) qui explique pourquoi ce problème n'avait jamais été détecté plus tôt : tous les tests de `tokenService.js` menés jusqu'ici (Étapes 2 et Tests/CI) s'exécutaient soit en Node directement avec la variable explicitement forcée dans le shell, soit en CI (où la même variable est explicitement injectée via `.gitlab-ci.yml`) — jamais via un `docker compose up` réel avec le seul `.env` comme source de vérité.

### Correctif

Deux lignes ajoutées à l'environnement du service `backend` :
```yaml
JWT_PRIVATE_KEY_PATH: ${JWT_PRIVATE_KEY_PATH:-./keys/private.pem}
JWT_PUBLIC_KEY_PATH: ${JWT_PUBLIC_KEY_PATH:-./keys/public.pem}
```
La syntaxe `${VAR:-defaut}` (et non `${VAR}` seul) est délibérée : si `.env` venait à nouveau à manquer une de ces deux variables (exactement le scénario qui vient de se produire), Docker Compose injecte quand même un chemin correct plutôt qu'une chaîne vide qui aurait fait replonger le code dans le même chemin de secours bogué. Défense en profondeur directement motivée par l'incident réel, pas une précaution abstraite.

### Leçon pour la suite : purge des volumes après régénération de `.env`

Un `.env` régénéré avec de nouveaux mots de passe MySQL (`.env.example` copié tel quel, ou toute autre valeur) ne doit **jamais** être combiné avec un volume `mysql_data` déjà existant issu d'une initialisation précédente : MySQL n'exécute ses scripts d'initialisation (et ne fixe les mots de passe) qu'au tout premier démarrage sur un volume vide — un volume déjà peuplé conserve ses anciens identifiants, indépendamment de ce que `.env` contient désormais. D'où la nécessité, dans le protocole de relance après un incident de ce type, de purger explicitement les volumes (`docker compose down -v`) et pas seulement les conteneurs, chaque fois que `.env` est recréé de zéro. Documenté comme étape obligatoire dans `TESTING.md` (section dépannage) et dans le runbook fourni pour cet incident.

---

## Fix CI : `package-lock.json` désynchronisé (`npm ci` — `@emnapi/core` manquant)

### Symptôme observé

Le job `test_backend` de la pipeline GitLab CI échouait à l'étape `npm ci` :
```
npm error npm ci can only install packages when your package.json and package-lock.json
or npm-shrinkwrap.json are in sync. Missing: @emnapi/core@1.11.3 from lock file
```

### Pourquoi `npm ci` est strict (et pourquoi c'est voulu)

Contrairement à `npm install`, `npm ci` ne **résout jamais** de version depuis les
intervalles semver de `package.json` (les `^x.y.z`) : il exige que
`package-lock.json` contienne déjà, pour chaque paquet direct et transitif,
une entrée exacte et cohérente avec `package.json`, puis installe strictement
cet arbre figé, sans jamais interroger le registre pour choisir une version.
C'est précisément ce qui rend `npm ci` adapté à une pipeline : deux exécutions
du job, à des mois d'intervalle, installent bit-à-bit le même arbre de
dépendances, y compris pour des sous-dépendances non listées dans
`package.json` (ex. `@emnapi/core`, une dépendance transitive optionnelle de
`@unrs/resolver-binding-wasm32-wasi`, elle-même utilisée par la chaîne de
résolution de modules de Jest 30 — jamais installée directement par ce
projet, mais fixée dans le lockfile comme tout le reste de l'arbre). Un
`npm install` local, lui, peut légitimement re-résoudre certaines
sous-dépendances au fil du temps si le lockfile n'est pas parfaitement à jour
avec l'état exact du registre au moment de l'installation — et c'est
exactement cette dérive, une fois commitée telle quelle sans être rejouée
via `npm ci` en local avant de pousser, qui a produit un `package-lock.json`
qui décrivait un arbre légèrement différent (`@emnapi/core@1.10.0`) de celui
qu'un `npm ci` strict, lancé à un instant différent contre `package.json`,
jugeait requis (`@emnapi/core@1.11.3`).

### Correctif appliqué

```bash
cd backend
rm -rf node_modules package-lock.json
npm install
npm ci   # verification a blanc : doit reussir sans aucune re-resolution
```
Le nouveau `package-lock.json` a été regénéré intégralement à partir du
`package.json` actuel, puis validé par un second passage `npm ci` (à partir
d'un `node_modules` supprimé) confirmant qu'il n'y a plus aucun écart entre
les deux fichiers. Aucune dépendance **directe** n'a changé de version
(`express@5.2.1`, `jsonwebtoken@9.0.3`, `mysql2@3.23.1`, `ws@8.21.1`,
`jest@30.4.2`, `supertest@7.2.2` — identiques à avant) : seule la partie
transitive/optionnelle du graphe (résolveur de modules de Jest) a été
re-figée. Les 7 tests de `tokenService.test.js` repassent au vert après ce
changement (clé RS256 régénérée localement via `./generate_keys.sh`, cf.
`TESTING.md`).

`npm audit` signale toujours les mêmes 19 vulnérabilités "high", toutes
sur la même chaîne `jest` → `glob`/`minimatch`/`brace-expansion`
(devDependency, jamais exécutée en production) déjà actée précédemment
dans la section « Stratégie de test et pipeline CI/CD » — aucune régression
ni nouveau risque introduit par cette régénération.

### `.gitlab-ci.yml` : aucune modification nécessaire

Le job `test_backend` exécute déjà `npm ci` dans une image fraîche
(`image: node:20`) à chaque run, sans `cache:` sur `node_modules` ni
réutilisation d'un état d'installation précédent — la seule source de vérité
pour la pipeline est le `package-lock.json` commité. Une fois ce fichier
resynchronisé, le job n'a besoin d'aucun ajustement : il validera
naturellement le nouvel arbre au prochain run.

### Comment éviter cette désynchronisation à l'avenir

Règle simple, à appliquer systématiquement avant tout commit touchant
`backend/package.json` ou `backend/package-lock.json` : ne jamais committer
un lockfile obtenu uniquement via `npm install`, sans le revalider par un
`npm ci` derrière (idéalement avec `node_modules` supprimé, pour reproduire
fidèlement les conditions d'un runner CI qui repart toujours de zéro). Un
`npm ci` local qui échoue AVANT le push est le même échec que celui que la
pipeline aurait rencontré après — le détecter en local coûte une commande,
le détecter en CI coûte un aller-retour de pipeline.

---

## Prochaine étape suggérée

Étape 3 : cascade de validation d'un scan (RF-12) — endpoint `POST /api/scans`, vérification de signature du jeton avec la clé publique, contrôle de fraîcheur (`exp`), consommation du nonce (`INSERT` protégé par la contrainte `UNIQUE(jti, etudiant_id)` posée à l'Étape 1), avant d'aborder l'enrôlement d'appareil (RF-07) et le géofencing (RF-13). Tests rétroactifs à écrire au fil de cette brique plutôt qu'après coup, maintenant que la stratégie de test est en place.
