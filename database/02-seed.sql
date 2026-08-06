-- =============================================================================
-- 02-seed.sql
-- Jeu de donnees de demonstration pour le prototype (cf. 3.1.2 : "le prototype
-- utilise un jeu de donnees de demonstration provisionne au deploiement").
-- Identifiants UUID fixes (et non generes) volontairement : reproductibles
-- d'un deploiement a l'autre, faciles a referencer tels quels dans TESTING.md
-- et lors d'une demonstration devant jury.
-- =============================================================================

USE db_logs;

-- -----------------------------------------------------------------------------
-- 1 UF
-- -----------------------------------------------------------------------------
INSERT INTO uf (id, intitule, date_cloture) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Anglais - Niveau 2', NULL),
  ('11111111-1111-1111-1111-111111111112', 'Bureautique - Initiation', NULL),
  ('11111111-1111-1111-1111-111111111113', 'Comptabilite generale', NULL);

-- -----------------------------------------------------------------------------
-- 1 salle, avec un polygone GeoJSON reel (rectangle englobant un batiment
-- fictif pres de Namur, marge assumee autour du local -- cf. 4.8 "precision du
-- GPS en interieur"). Coordonnees au format GeoJSON standard [longitude, latitude].
-- -----------------------------------------------------------------------------
INSERT INTO salles (id, nom, polygone_geojson) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Local 12 - ESA Namur',
   JSON_OBJECT(
     'type', 'Polygon',
     'coordinates', JSON_ARRAY(JSON_ARRAY(
       JSON_ARRAY(4.8712, 50.4670),
       JSON_ARRAY(4.8724, 50.4670),
       JSON_ARRAY(4.8724, 50.4678),
       JSON_ARRAY(4.8712, 50.4678),
       JSON_ARRAY(4.8712, 50.4670)
     ))
   ));

-- Deux salles supplementaires, avec des polygones distincts. Necessaires des
-- maintenant : le formulaire d'ouverture de seance propose une liste, et une
-- liste a un seul element n'aurait aucun sens. Elles serviront aussi a
-- verifier le geofencing (RF-13) sur des lieux differents.
INSERT INTO salles (id, nom, polygone_geojson) VALUES
  ('22222222-2222-2222-2222-222222222223', 'Local 4 - Aile Sud',
   JSON_OBJECT('type', 'Polygon', 'coordinates', JSON_ARRAY(JSON_ARRAY(
     JSON_ARRAY(4.8700, 50.4662), JSON_ARRAY(4.8710, 50.4662),
     JSON_ARRAY(4.8710, 50.4668), JSON_ARRAY(4.8700, 50.4668),
     JSON_ARRAY(4.8700, 50.4662))))),
  ('22222222-2222-2222-2222-222222222224', 'Atelier informatique',
   JSON_OBJECT('type', 'Polygon', 'coordinates', JSON_ARRAY(JSON_ARRAY(
     JSON_ARRAY(4.8726, 50.4670), JSON_ARRAY(4.8736, 50.4670),
     JSON_ARRAY(4.8736, 50.4676), JSON_ARRAY(4.8726, 50.4676),
     JSON_ARRAY(4.8726, 50.4670)))));

-- -----------------------------------------------------------------------------
-- 4 etudiants fictifs
-- -----------------------------------------------------------------------------
INSERT INTO etudiants (id, nom, email) VALUES
  ('33333333-3333-3333-3333-333333333331', 'Amara Diallo',      'amara.diallo@example.org'),
  ('33333333-3333-3333-3333-333333333332', 'Bilal Ozturk',      'bilal.ozturk@example.org'),
  ('33333333-3333-3333-3333-333333333333', 'Chiara Rossi',      'chiara.rossi@example.org'),
  ('33333333-3333-3333-3333-333333333334', 'Driss El Amrani',   'driss.elamrani@example.org');

-- -----------------------------------------------------------------------------
-- Inscriptions
--
-- REVISION. Ce bloc n'inscrivait les 4 etudiants qu'a la SEULE UF
-- "Anglais - Niveau 2". Les deux autres UF du jeu de demonstration
-- ("Bureautique - Initiation", "Comptabilite generale") n'avaient donc aucun
-- inscrit -- alors que le formulaire de creation de seance les propose
-- toutes les trois.
--
-- Consequence observee en test de bout en bout : une seance creee sur
-- "Bureautique" produisait un rapport d'assiduite entierement vide
-- (Attendus 0, Presents 0, Absents 0) alors qu'un etudiant y avait
-- reellement scanne et figurait bien dans la table presences. Rien
-- n'echouait, aucune erreur n'etait levee : le rapport etait simplement
-- faux. Un jeu de donnees incoherent produit exactement ce genre de defaut,
-- qu'on impute d'abord au code.
--
-- Les trois UF ont desormais des inscrits, avec des effectifs DIFFERENTS --
-- une repartition uniforme masquerait une erreur d'aiguillage entre UF, tous
-- les rapports se ressemblant.
-- -----------------------------------------------------------------------------
INSERT INTO inscriptions (etudiant_id, uf_id) VALUES
  -- Anglais - Niveau 2 : les 4 etudiants.
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333334', '11111111-1111-1111-1111-111111111111'),
  -- Bureautique - Initiation : 3 etudiants. Driss n'y est PAS inscrit, ce qui
  -- permet de verifier a l'oeil que le rapport distingue bien les UF.
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111112'),
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111112'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111112'),
  -- Comptabilite generale : 2 etudiants seulement.
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111113'),
  ('33333333-3333-3333-3333-333333333334', '11111111-1111-1111-1111-111111111113');

-- -----------------------------------------------------------------------------
-- Comptes de connexion (Etape 7a)
--
-- Mots de passe EN CLAIR, uniquement pour ce jeu de demonstration :
--   - les 4 etudiants  : Etudiant123!
--   - le formateur     : Formateur123!
-- Ces identifiants sont volontairement documentes ici : ce fichier n'est
-- charge que par le seed de demonstration, jamais en production (cf. 3.1.2,
-- "jeu de donnees de demonstration provisionne au deploiement"). Les
-- documenter dans le depot vaut mieux que de les transmettre par un canal
-- parallele ou de les laisser deviner.
--
-- Les empreintes ci-dessous sont de VRAIS hachages scrypt, produits par
-- backend/src/services/passwordService.js -- et non des valeurs inventees a
-- la main. Chacune embarque son propre sel aleatoire : c'est pourquoi les
-- quatre etudiants, bien qu'ayant le MEME mot de passe, ont des empreintes
-- entierement differentes. C'est exactement la propriete recherchee, et elle
-- est directement observable dans ce fichier.
--
-- Sophie Lambert (formateur) n'a PAS de ligne dans la table etudiants :
-- son etudiant_id vaut NULL, comme l'impose la contrainte
-- chk_utilisateur_role_lien (01-schema.sql).
-- -----------------------------------------------------------------------------
INSERT INTO utilisateurs (id, email, mot_de_passe_hash, nom, role, etudiant_id) VALUES
  ('44444444-4444-4444-4444-444444444441', 'amara.diallo@example.org', 'scrypt$32768$8$1$NzNJUfWYW1Or+EhwdJo6Rw==$AHOmuTk1z/J/Bk/O8Oa4wpBIrSabEqnMbW1tfWU87YkfvsUbINAPkT1uJ4UTKLFXemFDqHAZshL45+Jod85wcg==', 'Amara Diallo', 'etudiant', '33333333-3333-3333-3333-333333333331'),
  ('44444444-4444-4444-4444-444444444442', 'bilal.ozturk@example.org', 'scrypt$32768$8$1$b8GXVA5oGdIDqPo71DSxTQ==$xJAi5E/nUA6+Wz0KRK9muuvf/rAH2dhClKUSz2jgVt56Ji0zxgyUVqthJ08ePdkhlMlS0nylbQbPIEaR9KJaeg==', 'Bilal Ozturk', 'etudiant', '33333333-3333-3333-3333-333333333332'),
  ('44444444-4444-4444-4444-444444444443', 'chiara.rossi@example.org', 'scrypt$32768$8$1$eQ20MqufQ7banr64v/9OGg==$VLaW7a3W4X5PSs2XepsFeg7BMUcug6KoA94tWSZOvTJvs0b4oQ0bGg+9KR/zh4ZryAUBRjA7HCk7edcEnDq3wQ==', 'Chiara Rossi', 'etudiant', '33333333-3333-3333-3333-333333333333'),
  ('44444444-4444-4444-4444-444444444444', 'driss.elamrani@example.org', 'scrypt$32768$8$1$/944Q3FanCbZIF0uvDJc8g==$BvfcsNu5N6j4gACmv6q+m/TUJuuwSmAAkTZILMfRPlk2eHIEto0TleJcgIOxaPoA4M0+J6BFsBd+Uyt4Rb7OJg==', 'Driss El Amrani', 'etudiant', '33333333-3333-3333-3333-333333333334'),
  ('44444444-4444-4444-4444-444444444445', 'formateur@example.org', 'scrypt$32768$8$1$vVeexzYpFK669hCgHe5y8A==$gQCubHfvu1h6DgbZEzQbC73AmYpZ8dT/QoESnkXwUwfbTlb5l2ealq3HMkKmeQIiBD2vzZAbdJ3A9x44bOZtLg==', 'Sophie Lambert', 'formateur', NULL);
