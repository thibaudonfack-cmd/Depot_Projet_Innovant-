-- =============================================================================
-- 01-schema.sql
-- Schema relationnel du prototype - traduction directe de l'ERD (chapitre 4.4).
-- Execute automatiquement par l'image officielle MySQL au premier demarrage
-- (docker-entrypoint-initdb.d), UNE SEULE FOIS, avant tout autre service.
--
-- Deux bases logiques distinctes, conformement a la separation architecturale
-- actee en 2.2.5/4.4/4.8 :
--   - db_logs         : journaux operationnels, purges en fin d'UF (RF-20)
--   - db_attestations : attestations certifiees, conservees 5 ans (RF-19, S-J5)
-- db_logs est deja creee par l'image officielle via MYSQL_DATABASE (.env) au
-- moment ou ce script s'execute. db_attestations ne l'est pas : on la cree ici.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS db_attestations
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE db_logs;

-- -----------------------------------------------------------------------------
-- etudiants
-- -----------------------------------------------------------------------------
CREATE TABLE etudiants (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  nom        VARCHAR(255) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_etudiants_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- appareils_enroles
-- RF-07 (enrolement cryptographique) / RF-09 (un seul appareil actif par compte)
--
-- La colonne generee "actif_key" implemente RF-09 au niveau du SCHEMA, pas
-- seulement au niveau applicatif : elle vaut etudiant_id quand statut='actif',
-- NULL sinon. MySQL autorise plusieurs NULL dans un index UNIQUE (ils ne sont
-- jamais consideres en doublon) mais refuse deux lignes 'actif' pour le meme
-- etudiant_id. C'est l'equivalent, en MySQL, d'un "partial unique index"
-- Postgres (UNIQUE ... WHERE statut = 'actif') -- MySQL ne supporte pas cette
-- syntaxe nativement, d'ou cette colonne generee STORED comme substitut.
--
-- info_appareil (ajoutee Etape 4) : description libre fournie par le client
-- (ex. "iPhone 13 - Safari"), a but PUREMENT INFORMATIF/journalisation (utile
-- pour un etudiant ou un formateur qui consulte la liste des appareils
-- enroles). Ne joue AUCUN role de securite : c'est la cle publique
-- (cle_publique) qui authentifie l'appareil, jamais cette description en
-- clair, librement modifiable par le client (cf. enrolementController.js,
-- ANALYSE_CODE.md section Etape 4). NULL autorise : un client peut choisir
-- de ne pas la fournir sans que l'enrolement echoue pour autant.
-- -----------------------------------------------------------------------------
CREATE TABLE appareils_enroles (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  etudiant_id      CHAR(36)     NOT NULL,
  cle_publique     TEXT         NOT NULL,
  info_appareil    VARCHAR(255) NULL,
  statut           ENUM('actif', 'revoque') NOT NULL DEFAULT 'actif',
  date_enrolement  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_revocation  DATETIME     NULL,
  actif_key        CHAR(36) GENERATED ALWAYS AS (IF(statut = 'actif', etudiant_id, NULL)) STORED,
  CONSTRAINT fk_appareil_etudiant FOREIGN KEY (etudiant_id) REFERENCES etudiants(id),
  UNIQUE KEY uq_appareil_actif (actif_key),
  KEY idx_appareil_etudiant (etudiant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- defis_enrolement  (preuve de possession -- challenge-response)
--
-- Ferme un angle mort de l'enrolement : jusqu'ici, le serveur enregistrait la
-- cle publique qu'on lui presentait, sans aucun moyen de verifier que
-- l'expediteur detenait la cle privee correspondante. Rien n'empechait donc
-- de soumettre la cle publique d'un tiers -- elle est publique par nature et
-- se recupere aisement.
--
-- Le principe : le serveur emet une valeur aleatoire, le client la signe avec
-- la cle privee qu'il vient de generer, et transmet signature ET cle publique.
-- Si la signature se verifie avec cette cle publique, l'expediteur detient
-- necessairement la cle privee associee. C'est une preuve, pas une
-- declaration.
--
-- USAGE UNIQUE, verifie de facon atomique (voir enrolementController.js).
-- Sans cela, rejouer un couple (defi, signature) intercepte permettrait de
-- refaire un enrolement -- exactement l'attaque par rejeu que le mecanisme
-- doit fermer.
--
-- DUREE DE VIE COURTE (2 minutes) : le defi n'a de sens que le temps de
-- l'echange. Une fenetre longue laisserait des defis exploitables trainer en
-- base, et multiplierait les occasions d'interception.
--
-- Le defi est rattache a l'ETUDIANT : un defi emis pour l'un ne peut pas
-- servir a enroler un appareil pour un autre.
-- -----------------------------------------------------------------------------
CREATE TABLE defis_enrolement (
  id                CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  etudiant_id       CHAR(36)  NOT NULL,
  valeur            CHAR(64)  NOT NULL,
  date_creation     DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_expiration   DATETIME  NOT NULL,
  date_consommation DATETIME  NULL,
  CONSTRAINT fk_defi_etudiant FOREIGN KEY (etudiant_id) REFERENCES etudiants(id),
  UNIQUE KEY uq_defi_valeur (valeur),
  KEY idx_defi_etudiant (etudiant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- utilisateurs  (Etape 7a -- EXTENSION MVP)
--
-- ECART ASSUME PAR RAPPORT AU PERIMETRE INITIAL. Le commentaire de la table
-- "corrections" plus bas indique que "la gestion des comptes est explicitement
-- hors perimetre du prototype (cf. 3.1.2)". Cette table contredit donc une
-- decision de perimetre ecrite dans le memoire. Ce n'est pas un oubli : les
-- tests de l'Etape 6 ont montre qu'un scanner utilisable exige une identite
-- reelle -- sans authentification, etudiant_id est choisi librement par le
-- client, ce qui vide de sens toute la chaine cryptographique des Etapes 4 et
-- 5. Extension revendiquee comme telle en soutenance, le rapport initial
-- n'etant pas modifie retroactivement.
--
-- LIEN VERS etudiants, ET NON FUSION. La table etudiants est referencee par
-- des cles etrangeres dans inscriptions, appareils_enroles et scans ; la
-- remplacer imposerait de reprendre tout le schema. utilisateurs porte donc
-- uniquement l'IDENTITE DE CONNEXION (email, mot de passe, role) et pointe
-- vers l'etudiant metier quand il y a lieu. Un formateur n'a pas de ligne
-- dans etudiants -- d'ou etudiant_id NULLABLE.
--
-- La contrainte CHECK garantit la coherence role <-> lien : un compte
-- 'etudiant' DOIT referencer un etudiant, un compte 'formateur' ne doit
-- JAMAIS en referencer. Sans elle, un formateur pourrait etre rattache a un
-- etudiant et scanner en son nom -- exactement le contournement que l'Etape
-- 7c cherche a fermer. Verifie au niveau du SCHEMA et pas seulement dans le
-- code applicatif (MySQL applique reellement CHECK depuis la version 8.0.16 ;
-- l'image utilisee par ce projet est mysql:8.0, donc au-dela).
--
-- UNIQUE(etudiant_id) : un etudiant ne peut avoir qu'UN seul compte. MySQL
-- autorise plusieurs NULL dans un index UNIQUE, donc cette contrainte
-- n'entrave pas les formateurs (tous a NULL) -- meme propriete que celle
-- exploitee par appareils_enroles.actif_key.
-- -----------------------------------------------------------------------------
CREATE TABLE utilisateurs (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  email             VARCHAR(255) NOT NULL,
  mot_de_passe_hash VARCHAR(255) NOT NULL,
  nom               VARCHAR(255) NOT NULL,
  role              ENUM('etudiant', 'formateur') NOT NULL,
  etudiant_id       CHAR(36)     NULL,
  date_creation     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_utilisateur_etudiant FOREIGN KEY (etudiant_id) REFERENCES etudiants(id),
  CONSTRAINT chk_utilisateur_role_lien CHECK (
    (role = 'etudiant'  AND etudiant_id IS NOT NULL) OR
    (role = 'formateur' AND etudiant_id IS NULL)
  ),
  UNIQUE KEY uq_utilisateur_email (email),
  UNIQUE KEY uq_utilisateur_etudiant (etudiant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- sessions  (Etape 7a)
--
-- Sessions COTE SERVEUR plutot qu'un jeton auto-porteur (JWT) : choix
-- delibere, justifie en detail dans ANALYSE_CODE.md (Etape 7a). En resume,
-- un JWT reste valide jusqu'a son expiration meme apres une deconnexion --
-- il n'existe aucun moyen de le revoquer sans introduire, precisement, une
-- liste cote serveur. Une table de sessions rend la deconnexion reelle et
-- fait de la base la seule autorite sur la validite d'une session, ce qui
-- est la ligne de conduite suivie partout ailleurs dans ce projet (cf.
-- qrBroadcaster.js : "la base est la seule autorite sur salle_id").
--
-- jeton_hash, ET NON LE JETON : seule l'empreinte SHA-256 du jeton de
-- session est stockee. Une fuite de la base (sauvegarde egaree, injection
-- SQL en lecture, acces DBA non autorise) ne permet donc PAS d'usurper une
-- session en cours -- l'attaquant obtiendrait des empreintes, pas les
-- valeurs a placer dans un cookie. Meme raisonnement que pour les mots de
-- passe : ce que le serveur n'a pas besoin de connaitre en clair, il ne le
-- stocke pas en clair. SHA-256 sans sel suffit ici, contrairement aux mots
-- de passe : le jeton fait 256 bits d'entropie aleatoire, il n'est donc pas
-- attaquable par dictionnaire ou table precalculee.
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
  id              CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  utilisateur_id  CHAR(36)  NOT NULL,
  jeton_hash      CHAR(64)  NOT NULL,
  date_creation   DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_expiration DATETIME  NOT NULL,
  CONSTRAINT fk_session_utilisateur FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id),
  UNIQUE KEY uq_session_jeton (jeton_hash),
  KEY idx_session_utilisateur (utilisateur_id),
  KEY idx_session_expiration (date_expiration)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- uf (unites de formation)
-- -----------------------------------------------------------------------------
CREATE TABLE uf (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  intitule     VARCHAR(255) NOT NULL,
  date_cloture DATE         NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- salles
--
-- polygone_geojson en type JSON natif (et non SPATIAL/GEOMETRY) : justifie en
-- detail dans ANALYSE_CODE.md (section Etape 1) -- resume : l'algorithme de
-- geofencing retenu (PNPOLY / ray casting, chapitre 4) s'execute cote
-- application (Node.js), pas via une requete spatiale MySQL (ST_Contains).
-- JSON conserve le format natif de la Geolocation API / GeoJSON sans
-- conversion, et reste directement lisible pour la defense devant jury.
-- -----------------------------------------------------------------------------
CREATE TABLE salles (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  nom               VARCHAR(255) NOT NULL,
  polygone_geojson  JSON         NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- inscriptions
-- -----------------------------------------------------------------------------
CREATE TABLE inscriptions (
  id          CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  etudiant_id CHAR(36) NOT NULL,
  uf_id       CHAR(36) NOT NULL,
  CONSTRAINT fk_inscription_etudiant FOREIGN KEY (etudiant_id) REFERENCES etudiants(id),
  CONSTRAINT fk_inscription_uf FOREIGN KEY (uf_id) REFERENCES uf(id),
  UNIQUE KEY uq_inscription (etudiant_id, uf_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- seances
-- -----------------------------------------------------------------------------
--
-- Etape 7d : heure_debut_prevue / heure_fin_prevue.
--
-- A distinguer soigneusement de date_ouverture, qui existe deja : cette
-- derniere est l'instant REEL ou le formateur a clique, les nouvelles
-- colonnes sont l'horaire PREVU du cours. Les deux different presque
-- toujours (un cours de 9h00 est ouvert a 8h57 ou 9h04) et servent a des
-- choses differentes : date_ouverture trace ce qui s'est passe, les heures
-- prevues definissent le cadre attendu. Les confondre rendrait impossible
-- de dire, plus tard, si une seance a commence en retard.
--
-- Stockees en DATETIME, donc SANS fuseau : la convention du projet est de
-- tout conserver en UTC et de convertir a l'affichage. Un DATETIME local
-- ferait diverger les cumuls d'heures de part et d'autre du changement
-- d'heure, ce qui est redhibitoire des lors que ces heures servent a
-- justifier des quotas (cf. etude d'architecture du suivi du temps).
--
-- Nullables : le prototype doit continuer d'accepter les seances creees
-- avant cette etape, et le suivi du temps proprement dit n'est pas encore
-- implemente.
CREATE TABLE seances (
  id                 CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  uf_id              CHAR(36)  NOT NULL,
  salle_id           CHAR(36)  NOT NULL,
  date_ouverture     DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  heure_debut_prevue DATETIME  NULL,
  heure_fin_prevue   DATETIME  NULL,
  -- Quota d'heures conventionne, distinct des bornes ci-dessus : une seance
  -- de 4 h peut ne valider que 3 h 30 au titre du programme. Les confondre
  -- interdirait de justifier un ecart devant une inspection.
  quota_minutes      INT       NULL,
  -- Position de reference du geofencing (RF-13), capturee sur l'appareil du
  -- formateur au moment ou il ouvre la seance.
  --
  -- ATTENTION AU TYPE : DECIMAL(10,8) conviendrait pour la latitude
  -- (max 90, donc 2 chiffres avant la virgule) mais DEBORDERAIT pour la
  -- longitude, qui va jusqu'a 180 et en exige 3. Une longitude de 180.x
  -- serait rejetee ou tronquee silencieusement. D'ou la dissymetrie
  -- deliberee des deux colonnes ci-dessous.
  --
  -- 8 decimales representent environ 1 mm : tres au-dela de la precision
  -- reelle d'un GPS (10 a 50 m en interieur), mais sans cout notable, et
  -- cela evite d'avoir a justifier un arrondi.
  latitude_reference  DECIMAL(10,8) NULL,
  longitude_reference DECIMAL(11,8) NULL,
  -- Rayon de tolerance retenu pour CETTE seance. Stocke plutot que fige dans
  -- le code : une salle de sport et un local de 20 m2 n'appellent pas la meme
  -- tolerance, et une valeur historisee permet de reinterpreter un releve
  -- ancien avec les regles qui s'appliquaient alors.
  rayon_tolerance_m   INT           NULL,
  date_cloture       DATETIME  NULL,
  statut          ENUM('ouverte', 'cloturee') NOT NULL DEFAULT 'ouverte',
  CONSTRAINT fk_seance_uf FOREIGN KEY (uf_id) REFERENCES uf(id),
  CONSTRAINT fk_seance_salle FOREIGN KEY (salle_id) REFERENCES salles(id),
  KEY idx_seance_uf (uf_id),
  KEY idx_seance_salle (salle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- scans
--
-- UNE contrainte UNIQUE, appliquee au niveau base de donnees (jamais en
-- pre-verification applicative -- cf. ANALYSE_CODE.md, section Etape 3 : un
-- SELECT prealable ouvrirait une fenetre de course, seul le moteur InnoDB
-- peut garantir l'atomicite de la verification au moment de l'ecriture) :
--
--   - uq_scan_nonce (jti, etudiant_id) : fermeture du vecteur V4 (REJEU
--     cryptographique). Protege le JETON : un meme jeton (meme jti), deja
--     consomme par cet etudiant, ne peut plus l'etre une seconde fois.
--
-- REVISION (double scan entree/sortie). Cette table portait auparavant une
-- SECONDE contrainte, uq_scan_presence (seance_id, etudiant_id), destinee a
-- garantir qu'un etudiant n'ait qu'une seule presence par seance.
--
-- La regle etait juste, son emplacement ne l'etait pas. scans est le JOURNAL
-- BRUT des evenements : chaque presentation de jeton valide doit pouvoir y
-- laisser une trace. Interdire une seconde ligne revenait a interdire
-- d'enregistrer le scan de SORTIE -- et rendait donc le pointage du depart,
-- qui est la seule facon d'obtenir un temps de participation exact,
-- structurellement impossible. Le symptome etait un 409 DOUBLE_SCAN sur un
-- geste parfaitement legitime.
--
-- La regle metier est desormais portee par uq_presence sur la table
-- presences, qui est l'endroit correct : c'est l'ETAT qui doit etre unique,
-- pas l'EVENEMENT. Un etudiant a toujours au plus une presence par seance ;
-- cette presence est simplement alimentee par deux scans successifs.
--
-- Lecon generalisable : une contrainte d'unicite posee sur une table de
-- journal contraint l'HISTOIRE, pas l'ETAT. Les deux se confondent tant
-- qu'un fait ne peut survenir qu'une fois -- et divergent des qu'il peut
-- survenir deux fois pour un meme resultat.
-- -----------------------------------------------------------------------------
CREATE TABLE scans (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  seance_id    CHAR(36)     NOT NULL,
  etudiant_id  CHAR(36)     NOT NULL,
  jti          VARCHAR(255) NOT NULL,
  resultat     ENUM('valide', 'rejete', 'manuel') NOT NULL,
  motif_rejet  VARCHAR(100) NULL,
  horodatage   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_scan_seance FOREIGN KEY (seance_id) REFERENCES seances(id),
  CONSTRAINT fk_scan_etudiant FOREIGN KEY (etudiant_id) REFERENCES etudiants(id),
  UNIQUE KEY uq_scan_nonce (jti, etudiant_id),
  -- uq_scan_presence (seance_id, etudiant_id) A ETE RETIREE ICI.
  --
  -- Elle exprimait la bonne regle metier -- une seule presence par etudiant
  -- et par seance -- mais sur la MAUVAISE TABLE. scans est le journal brut
  -- des evenements : interdire une deuxieme ligne revenait a interdire
  -- d'ENREGISTRER le scan de sortie, et rendait donc le pointage du depart
  -- structurellement impossible.
  --
  -- La regle metier n'est pas perdue pour autant : elle est portee par
  -- uq_presence sur la table presences, qui est l'endroit correct. Un
  -- etudiant ne peut toujours avoir qu'une seule presence par seance -- mais
  -- cette presence peut desormais etre alimentee par DEUX scans, celui de
  -- l'arrivee et celui du depart.
  --
  -- La protection anti-rejeu (V4) est inchangee : elle repose sur
  -- uq_scan_nonce (jti, etudiant_id), ci-dessus. Un meme jeton ne peut
  -- toujours pas etre presente deux fois ; c'est un jeton DIFFERENT, emis
  -- plus tard dans la meme seance, qui porte le depart.
  KEY idx_scan_seance (seance_id),
  KEY idx_scan_etudiant (etudiant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- presences  (suivi du temps)
--
-- TABLE D'ETAT, distincte de scans qui reste le JOURNAL BRUT IMMUABLE.
-- C'est le point d'architecture le plus important de cette partie : scans est
-- en ecriture seule pour l'utilisateur applicatif depuis l'Etape 1 (ni UPDATE
-- ni DELETE, cf. 03-privileges.sh, RF-18/RNF-13). Y ajouter une heure de fin
-- modifiable romprait cette immuabilite, qui est precisement ce qui donne au
-- journal sa valeur probatoire. On separe donc : scans consigne ce qui s'est
-- passe, presences porte l'etat courant, deduit puis eventuellement corrige.
--
-- QUE DES INSTANTS, JAMAIS DE DUREE STOCKEE. La duree se calcule a la lecture
-- (heure_depart - heure_arrivee). Trois raisons :
--   1. une duree stockee peut diverger de ses bornes apres correction, et
--      plus rien ne dit alors laquelle fait foi ;
--   2. les instants sont composables (chevauchements, pauses, cumuls par UF),
--      une duree ne l'est pas ;
--   3. en cas d'inspection il faut pouvoir repondre "a quelle heure
--      exactement ?", pas seulement "combien d'heures ?" -- une duree seule
--      est indefendable devant un controle.
--
-- Tous les DATETIME de ce schema sont en UTC, la conversion vers l'heure
-- locale se faisant a l'affichage. Un stockage en heure locale ferait diverger
-- les cumuls de part et d'autre du changement d'heure.
--
-- heure_depart NULLABLE : la presence reste ouverte tant que l'etudiant n'est
-- pas parti (ou tant que la seance n'est pas cloturee). Un NULL signifie
-- "en cours", pas "donnee manquante".
--
-- scan_arrivee_id relie la presence au scan qui l'a creee : c'est le lien
-- entre l'etat et sa preuve d'origine. Nullable, car une presence peut avoir
-- ete creee manuellement par un formateur pour un etudiant dont le telephone
-- etait hors service (mode degrade).
-- -----------------------------------------------------------------------------
CREATE TABLE presences (
  id              CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  seance_id       CHAR(36)  NOT NULL,
  etudiant_id     CHAR(36)  NOT NULL,
  scan_arrivee_id CHAR(36)  NULL,
  -- Symetrique de scan_arrivee_id : le depart pointe par l'etudiant est
  -- rattache au scan qui l'a produit. Sans ce lien, une heure de depart
  -- serait indistinguable d'une saisie manuelle du formateur, alors que les
  -- deux n'ont pas du tout la meme valeur probante -- l'une est adossee a un
  -- jeton signe et a un appareil enrole, l'autre a la parole d'une personne.
  -- Reste NULL quand le depart n'a pas ete scanne (correction manuelle,
  -- rectification acceptee, ou depart deduit de l'heure de fin prevue).
  scan_depart_id  CHAR(36)  NULL,
  heure_arrivee   DATETIME  NOT NULL,
  heure_depart    DATETIME  NULL,
  source          ENUM('scan', 'correction_formateur', 'rectification_validee')
                    NOT NULL DEFAULT 'scan',
  -- Position rapportee par l'appareil de l'etudiant au moment du scan.
  latitude_scan   DECIMAL(10,8) NULL,
  longitude_scan  DECIMAL(11,8) NULL,
  -- Rayon d'incertitude annonce par le navigateur (coords.accuracy), en
  -- metres. Conserve car il conditionne la LECTURE de la distance : 40 m
  -- d'ecart avec une incertitude de 10 m et les memes 40 m avec une
  -- incertitude de 150 m ne disent pas du tout la meme chose.
  precision_m     INT           NULL,
  -- Distance calculee (Haversine) entre le scan et la reference de la seance.
  distance_m      INT           NULL,
  -- TROIS etats, et non deux : TRUE (dans le rayon), FALSE (hors du rayon de
  -- facon certaine), NULL (indeterminable). NULL couvre l'absence de position
  -- de reference, le refus de partager la position, et une precision trop
  -- mauvaise pour conclure. Le distinguer de FALSE est essentiel : signaler
  -- "position incertaine" a un etudiant dont le GPS n'a simplement pas
  -- fonctionne serait injuste et decredibiliserait l'indicateur.
  position_coherente TINYINT(1) NULL,
  CONSTRAINT fk_presence_seance FOREIGN KEY (seance_id) REFERENCES seances(id),
  CONSTRAINT fk_presence_etudiant FOREIGN KEY (etudiant_id) REFERENCES etudiants(id),
  CONSTRAINT fk_presence_scan FOREIGN KEY (scan_arrivee_id) REFERENCES scans(id),
  CONSTRAINT fk_presence_scan_depart FOREIGN KEY (scan_depart_id) REFERENCES scans(id),
  -- Coherence des bornes portee par le SCHEMA et non par le seul code : une
  -- duree negative fausserait les cumuls d'heures sans qu'aucune erreur ne
  -- soit levee. Le NULL est accepte (presence en cours).
  CONSTRAINT chk_presence_bornes CHECK (heure_depart IS NULL OR heure_depart > heure_arrivee),
  -- Une seule presence par etudiant et par seance. Depuis le retrait de
  -- uq_scan_presence sur la table scans (voir son en-tete), cette contrainte
  -- est la SEULE a porter cette regle metier -- et c'est bien ici sa place :
  -- elle contraint l'etat, la ou scans ne doit contraindre que l'unicite des
  -- jetons. Un second scan ne cree donc jamais de ligne supplementaire : il
  -- met a jour celle-ci en y inscrivant heure_depart.
  UNIQUE KEY uq_presence (seance_id, etudiant_id),
  KEY idx_presence_etudiant (etudiant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- demandes_rectification
--
-- L'etudiant dispose de 24 h apres la seance pour signaler que son temps ne
-- reflete pas la realite. La fenetre est verifiee COTE SERVEUR contre
-- l'horloge de la base, jamais contre une date fournie par le client -- meme
-- principe qu'a l'Etape 7c.
--
-- Elle court a partir de heure_fin_prevue de la seance, et NON du depart
-- effectif de l'etudiant : sinon un etudiant parti tot disposerait d'une
-- fenetre plus courte qu'un autre, ce qui serait difficile a justifier.
--
-- Les heures demandees sont conservees separement des heures effectives :
-- accepter une demande ne doit pas effacer ce qui avait ete demande, sous
-- peine de rendre la decision incomprehensible a posteriori.
-- -----------------------------------------------------------------------------
CREATE TABLE demandes_rectification (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  presence_id            CHAR(36)     NOT NULL,
  motif                  VARCHAR(500) NOT NULL,
  heure_arrivee_demandee DATETIME     NULL,
  heure_depart_demandee  DATETIME     NULL,
  statut                 ENUM('en_attente', 'acceptee', 'refusee') NOT NULL DEFAULT 'en_attente',
  date_soumission        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_decision          DATETIME     NULL,
  decideur_id            CHAR(36)     NULL,
  motif_decision         VARCHAR(500) NULL,
  CONSTRAINT fk_demande_presence FOREIGN KEY (presence_id) REFERENCES presences(id),
  CONSTRAINT fk_demande_decideur FOREIGN KEY (decideur_id) REFERENCES utilisateurs(id),
  KEY idx_demande_presence (presence_id),
  KEY idx_demande_statut (statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- corrections
-- RF-17/RF-18 : journal immuable des corrections. auteur_id n'est PAS une FK :
-- l'ERD du chapitre 4.4 ne modelise pas les formateurs/secretariat comme des
-- entites persistees (gestion des comptes explicitement hors perimetre du
-- prototype, cf. 3.1.2 "Administration complete des comptes... simplification
-- assumee"). auteur_id stocke donc un identifiant libre (ex: email) et non une
-- reference contrainte.
-- -----------------------------------------------------------------------------
CREATE TABLE corrections (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  scan_id       CHAR(36)     NOT NULL,
  auteur_id     VARCHAR(255) NOT NULL,
  valeur_avant  VARCHAR(50)  NULL,
  valeur_apres  VARCHAR(50)  NOT NULL,
  motif         VARCHAR(255) NOT NULL,
  horodatage    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_correction_scan FOREIGN KEY (scan_id) REFERENCES scans(id),
  KEY idx_correction_scan (scan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- attestations (base db_attestations -- SEPARATION PHYSIQUE, pas seulement
-- logique)
--
-- Aucune contrainte FOREIGN KEY vers etudiants/uf de db_logs : MySQL ne
-- supporte de toute facon pas les FK inter-bases, mais c'est surtout un choix
-- architectural delibere (cf. 4.4) -- etudiant_id/uf_id sont stockes PAR
-- VALEUR. Consequence directe : la purge de db_logs en fin d'UF (RF-20) ne
-- peut structurellement jamais echouer ni casser l'integrite referentielle
-- des attestations deja emises, puisqu'aucun lien technique ne les relie.
-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- journal_modifications  (AUDIT TRAIL -- base db_attestations)
--
-- PLACE DANS db_attestations, ET NON db_logs. Decision de conformite, pas
-- technique : db_logs est purge en fin d'UF (RF-20), alors que la preuve
-- d'assiduite doit etre conservee 5 ans en Belgique. Un journal d'audit place
-- dans db_logs disparaitrait avec la purge, emportant avec lui la
-- justification des quotas d'heures -- exactement ce qu'une inspection
-- viendrait verifier.
--
-- INSERT SEULEMENT pour l'application (cf. 03-privileges.sh) : ni UPDATE ni
-- DELETE, jamais. Un journal que l'application peut reecrire ne prouve rien.
-- L'immuabilite est portee par les PRIVILEGES MySQL, pas par la discipline du
-- code -- meme demarche que pour la table scans.
--
-- valeur_avant / valeur_apres en TEXTE, sans cle etrangere ni type contraint.
-- La trace doit survivre a la purge de db_logs et rester lisible meme si la
-- ligne d'origine a disparu : une FK vers db_logs serait de toute facon
-- impossible (pas de cle etrangere inter-bases en MySQL) et surtout contraire
-- au but recherche. Meme raisonnement que pour corrections.auteur_id.
--
-- table_cible et ligne_id identifient la donnee modifiee par valeur, sans
-- lien technique : le journal reste autoportant.
-- -----------------------------------------------------------------------------
CREATE TABLE db_attestations.journal_modifications (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  table_cible   VARCHAR(64)   NOT NULL,
  ligne_id      CHAR(36)      NOT NULL,
  champ         VARCHAR(64)   NOT NULL,
  valeur_avant  TEXT          NULL,
  valeur_apres  TEXT          NULL,
  auteur_id     CHAR(36)      NOT NULL,
  auteur_email  VARCHAR(255)  NOT NULL,
  role_auteur   VARCHAR(32)   NOT NULL,
  motif         VARCHAR(500)  NOT NULL,
  origine       ENUM('formateur', 'rectification', 'systeme') NOT NULL,
  horodatage    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_journal_cible (table_cible, ligne_id),
  KEY idx_journal_horodatage (horodatage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE db_attestations.attestations (
  id                CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  etudiant_id       CHAR(36)  NOT NULL,
  uf_id             CHAR(36)  NOT NULL,
  empreinte_sha256  CHAR(64)  NOT NULL,
  signature_rs256   TEXT      NOT NULL,
  date_generation   DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_attestation_etudiant (etudiant_id),
  KEY idx_attestation_uf (uf_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
