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
INSERT INTO uf (id, intitule, date_cloture, volume_horaire_minutes) VALUES
  -- Volumes horaires realistes de promotion sociale : 40 a 80 periodes de
  -- 50 min, arrondies ici en minutes pleines pour rester lisibles.
  ('11111111-1111-1111-1111-111111111111', 'Architecture Logicielle', NULL, 1200),
  ('11111111-1111-1111-1111-111111111112', 'Developpement Web',       NULL, 1800),
  ('11111111-1111-1111-1111-111111111113', 'Cybersecurite',           NULL,  900),
  ('11111111-1111-1111-1111-111111111114', 'DevOps et Conteneurisation', NULL, 1500);

-- -----------------------------------------------------------------------------
-- Salles nommees selon la convention academique usuelle (batiment, etage,
-- numero). Polygones GeoJSON reels : rectangles englobant un batiment fictif
-- pres de Namur, avec une marge assumee autour du local -- cf. 4.8 "precision
-- du GPS en interieur". Coordonnees au format standard [longitude, latitude].
-- -----------------------------------------------------------------------------
INSERT INTO salles (id, nom, polygone_geojson) VALUES
  ('22222222-2222-2222-2222-222222222222', 'A301',
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
  ('22222222-2222-2222-2222-222222222223', 'B101',
   JSON_OBJECT('type', 'Polygon', 'coordinates', JSON_ARRAY(JSON_ARRAY(
     JSON_ARRAY(4.8700, 50.4662), JSON_ARRAY(4.8710, 50.4662),
     JSON_ARRAY(4.8710, 50.4668), JSON_ARRAY(4.8700, 50.4668),
     JSON_ARRAY(4.8700, 50.4662))))),
  ('22222222-2222-2222-2222-222222222224', 'Amphi Turing',
   JSON_OBJECT('type', 'Polygon', 'coordinates', JSON_ARRAY(JSON_ARRAY(
     JSON_ARRAY(4.8726, 50.4670), JSON_ARRAY(4.8736, 50.4670),
     JSON_ARRAY(4.8736, 50.4676), JSON_ARRAY(4.8726, 50.4676),
     JSON_ARRAY(4.8726, 50.4670)))));

-- -----------------------------------------------------------------------------
-- 8 etudiants fictifs
--
-- Effectif porte a huit : sur quatre lignes, un taux de 75 % et un taux de
-- 80 % se confondent visuellement, et une jauge de progression perd son
-- interet. Huit permet aussi des repartitions inegales entre UF, qui font
-- apparaitre les erreurs d'aiguillage.
-- -----------------------------------------------------------------------------
INSERT INTO etudiants (id, nom, email) VALUES
  ('33333333-3333-3333-3333-333333333331', 'Amara Diallo',      'amara.diallo@example.org'),
  ('33333333-3333-3333-3333-333333333332', 'Bilal Ozturk',      'bilal.ozturk@example.org'),
  ('33333333-3333-3333-3333-333333333333', 'Chiara Rossi',      'chiara.rossi@example.org'),
  ('33333333-3333-3333-3333-333333333334', 'Driss El Amrani',   'driss.elamrani@example.org'),
  ('33333333-3333-3333-3333-333333333335', 'Elena Petrova',     'elena.petrova@example.org'),
  ('33333333-3333-3333-3333-333333333336', 'Farid Benali',      'farid.benali@example.org'),
  ('33333333-3333-3333-3333-333333333337', 'Gwendoline Moreau', 'gwendoline.moreau@example.org'),
  ('33333333-3333-3333-3333-333333333338', 'Hugo Vandenberghe', 'hugo.vandenberghe@example.org');

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
  -- Architecture Logicielle : 5 inscrits.
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333334', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333335', '11111111-1111-1111-1111-111111111111'),
  -- Developpement Web : 7 inscrits.
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111112'),
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111112'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111112'),
  ('33333333-3333-3333-3333-333333333335', '11111111-1111-1111-1111-111111111112'),
  ('33333333-3333-3333-3333-333333333336', '11111111-1111-1111-1111-111111111112'),
  ('33333333-3333-3333-3333-333333333337', '11111111-1111-1111-1111-111111111112'),
  ('33333333-3333-3333-3333-333333333338', '11111111-1111-1111-1111-111111111112'),
  -- Cybersecurite : 3 inscrits.
  ('33333333-3333-3333-3333-333333333334', '11111111-1111-1111-1111-111111111113'),
  ('33333333-3333-3333-3333-333333333336', '11111111-1111-1111-1111-111111111113'),
  ('33333333-3333-3333-3333-333333333338', '11111111-1111-1111-1111-111111111113'),
  -- DevOps et Conteneurisation : 4 inscrits.
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111114'),
  ('33333333-3333-3333-3333-333333333335', '11111111-1111-1111-1111-111111111114'),
  ('33333333-3333-3333-3333-333333333337', '11111111-1111-1111-1111-111111111114'),
  ('33333333-3333-3333-3333-333333333338', '11111111-1111-1111-1111-111111111114');

-- -----------------------------------------------------------------------------
-- Comptes de connexion (Etape 7a)
--
-- Mots de passe EN CLAIR, uniquement pour ce jeu de demonstration :
--   - les 8 etudiants  : Etudiant123!
--   - les 3 formateurs : Formateur123!
--
-- Comptes formateurs et UF couvertes :
--   sophie.lambert@example.org  Architecture Logicielle, Developpement Web
--   marc.dupont@example.org     Developpement Web, Cybersecurite
--   nadia.cherif@example.org    DevOps et Conteneurisation
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
  ('44444444-4444-4444-4444-444444444445', 'sophie.lambert@example.org', 'scrypt$32768$8$1$vVeexzYpFK669hCgHe5y8A==$gQCubHfvu1h6DgbZEzQbC73AmYpZ8dT/QoESnkXwUwfbTlb5l2ealq3HMkKmeQIiBD2vzZAbdJ3A9x44bOZtLg==', 'Sophie Lambert', 'formateur', NULL),
  ('44444444-4444-4444-4444-444444444446', 'elena.petrova@example.org', 'scrypt$32768$8$1$vcy4/XmEHhKktv3ay6hklw==$y4G2xj/82iNA48kVLTWxj22en5hcqRWNNeBC/1X2Ad2sch5StNUr1jX2HjRKyvmZQckIXCDKVEbCyjojeBR2BQ==', 'Elena Petrova', 'etudiant', '33333333-3333-3333-3333-333333333335'),
  ('44444444-4444-4444-4444-444444444447', 'farid.benali@example.org', 'scrypt$32768$8$1$+GhauMWp2zLLHTzQgjw44A==$rCOJPXxovB43V2E5aibhCjoxCLC/fHSPAOzAqlSesyRKelrvMcDF1+EfAtuLfmZH8g4G5WVzaZ4N7AUHaPDG1w==', 'Farid Benali', 'etudiant', '33333333-3333-3333-3333-333333333336'),
  ('44444444-4444-4444-4444-444444444448', 'gwendoline.moreau@example.org', 'scrypt$32768$8$1$G7EEFWvV58i0S2XDhRWE0w==$08ngYEkCECAV1o1Z3B0damL4tosJpr1BnsATUxi9xkLKPiK2wG0xAFiO2sjdxN2YeUB3FOrB+svKDxGvVskURA==', 'Gwendoline Moreau', 'etudiant', '33333333-3333-3333-3333-333333333337'),
  ('44444444-4444-4444-4444-444444444449', 'hugo.vandenberghe@example.org', 'scrypt$32768$8$1$eKdYP6QDPbzjxb7FUpG2bQ==$TKjuoSbYwsUHHNOcqJV/Y9XiYFdAsmLMofO7VkNu8Wf3K/lNI7nGTkI1yoPcn1TcIe5NEWimUzsEVbv1iQsZ6w==', 'Hugo Vandenberghe', 'etudiant', '33333333-3333-3333-3333-333333333338'),
  ('4444444a-4444-4444-4444-44444444444a', 'marc.dupont@example.org', 'scrypt$32768$8$1$X3luXujlHa6TWfVzRrmPAw==$enTtojcBPqT4g+WjuwxLly34VbYIecB8x3IShoj1VrrzPvEJ0TaIiPDQ9Nj7tQ8LFQ4MD6iamhf55XxYNz+tbw==', 'Marc Dupont', 'formateur', NULL),
  ('4444444b-4444-4444-4444-44444444444b', 'nadia.cherif@example.org', 'scrypt$32768$8$1$keigjDycNWlLfEPb0PTVjA==$qsph/zOB1cNrKWGRtk3rzn2xUhae7IF6eqZn3REmI6Uw3fntTuDFhFW9x1zxNPlOShau4ccg7/32g1mIWbt2PA==', 'Nadia Cherif', 'formateur', NULL);

-- -----------------------------------------------------------------------------
-- Affectations formateur -> UF (Etape 10 : cloisonnement)
--
-- LE POINT A OBSERVER EN DEMONSTRATION : les trois formateurs se partagent
-- les quatre UF, et "Developpement Web" est CO-ENCADREE par deux d'entre eux.
-- Ce dernier cas est celui qu'un modele "un createur = un proprietaire"
-- n'aurait pas su representer, et c'est aussi celui qui prouve que le
-- cloisonnement filtre bien sur le mandat pedagogique et non sur l'auteur
-- d'un clic.
--
-- Aucune UF n'est laissee sans titulaire : une UF orpheline serait invisible
-- de tous et ses etudiants n'auraient aucun recours.
-- -----------------------------------------------------------------------------
INSERT INTO formateur_uf (formateur_id, uf_id) VALUES
  -- Sophie Lambert : Architecture Logicielle + Developpement Web.
  ('44444444-4444-4444-4444-444444444445', '11111111-1111-1111-1111-111111111111'),
  ('44444444-4444-4444-4444-444444444445', '11111111-1111-1111-1111-111111111112'),
  -- Marc Dupont : Developpement Web (co-encadrement) + Cybersecurite.
  ('4444444a-4444-4444-4444-44444444444a', '11111111-1111-1111-1111-111111111112'),
  ('4444444a-4444-4444-4444-44444444444a', '11111111-1111-1111-1111-111111111113'),
  -- Nadia Cherif : DevOps uniquement. C'est le compte a utiliser pour
  -- demontrer le cloisonnement : elle ne doit voir NI les seances, NI les
  -- bilans des trois autres UF.
  ('4444444b-4444-4444-4444-44444444444b', '11111111-1111-1111-1111-111111111114');
