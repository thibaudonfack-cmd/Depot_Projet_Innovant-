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
-- DEUX contraintes UNIQUE, DEUX vecteurs distincts fermes au niveau base de
-- donnees (jamais en pre-verification applicative -- cf. ANALYSE_CODE.md,
-- section Etape 3, pour la justification complete de ce choix dans les deux
-- cas : un SELECT prealable ouvrirait une fenetre de course, seul le moteur
-- InnoDB peut garantir l'atomicite de la verification au moment de l'ecriture) :
--
--   - uq_scan_nonce (jti, etudiant_id) : fermeture du vecteur V4 (REJEU
--     cryptographique). Protege le JETON : un meme jeton (meme jti), deja
--     consomme par cet etudiant, ne peut plus l'etre une seconde fois.
--
--   - uq_scan_presence (seance_id, etudiant_id) : regle METIER de presence
--     (pas un vecteur d'attaque a proprement parler). Protege le FAIT
--     enregistre : un etudiant ne peut avoir qu'UNE seule ligne de presence
--     par seance, meme s'il scanne successivement PLUSIEURS jetons tous
--     individuellement valides et jamais rejoues (jti differents a chaque
--     rotation, cf. tokenService.js) -- ce que uq_scan_nonce seule ne peut
--     pas empecher, puisqu'elle ne compare jamais deux jti differents entre eux.
--
-- Les deux constantes sont deliberement conservees ensemble (pas seulement
-- la seconde a la place de la premiere) : elles repondent a deux questions
-- differentes ("ce jeton precis a-t-il deja servi ?" vs "cet etudiant a-t-il
-- deja une presence pour cette seance, quel que soit le jeton ?"), utiles
-- independamment l'une de l'autre si la logique metier venait a evoluer.
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
  UNIQUE KEY uq_scan_presence (seance_id, etudiant_id),
  KEY idx_scan_seance (seance_id),
  KEY idx_scan_etudiant (etudiant_id)
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
