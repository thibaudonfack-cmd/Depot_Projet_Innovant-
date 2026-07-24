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

## Prochaine étape suggérée

Étape 0 - Partie 2 (ou Brique 1 du chapitre 5) : ajout du proxy TLS + squelette backend Express, pour que le contexte sécurisé (HTTPS) soit posé avant tout code qui en dépend (WebCrypto, géolocalisation, Service Worker) — conformément à la correction n°5 ci-dessus.
