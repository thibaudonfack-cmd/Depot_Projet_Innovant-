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
-- -----------------------------------------------------------------------------
CREATE TABLE appareils_enroles (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  etudiant_id      CHAR(36)     NOT NULL,
  cle_publique     TEXT         NOT NULL,
  statut           ENUM('actif', 'revoque') NOT NULL DEFAULT 'actif',
  date_enrolement  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_revocation  DATETIME     NULL,
  actif_key        CHAR(36) GENERATED ALWAYS AS (IF(statut = 'actif', etudiant_id, NULL)) STORED,
  CONSTRAINT fk_appareil_etudiant FOREIGN KEY (etudiant_id) REFERENCES etudiants(id),
  UNIQUE KEY uq_appareil_actif (actif_key),
  KEY idx_appareil_etudiant (etudiant_id)
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
CREATE TABLE seances (
  id              CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  uf_id           CHAR(36)  NOT NULL,
  salle_id        CHAR(36)  NOT NULL,
  date_ouverture  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_cloture    DATETIME  NULL,
  statut          ENUM('ouverte', 'cloturee') NOT NULL DEFAULT 'ouverte',
  CONSTRAINT fk_seance_uf FOREIGN KEY (uf_id) REFERENCES uf(id),
  CONSTRAINT fk_seance_salle FOREIGN KEY (salle_id) REFERENCES salles(id),
  KEY idx_seance_uf (uf_id),
  KEY idx_seance_salle (salle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- scans
--
-- La contrainte UNIQUE(jti, etudiant_id) est LA fermeture du vecteur V4
-- (rejeu) au niveau base de donnees : une resoumission de la meme paire
-- (jeton, etudiant) est rejetee par le moteur InnoDB lui-meme, avant meme
-- toute logique applicative -- cf. 4.4, note "fermeture du vecteur V4".
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
