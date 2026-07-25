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
  ('11111111-1111-1111-1111-111111111111', 'Anglais - Niveau 2', NULL);

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

-- -----------------------------------------------------------------------------
-- 4 etudiants fictifs
-- -----------------------------------------------------------------------------
INSERT INTO etudiants (id, nom, email) VALUES
  ('33333333-3333-3333-3333-333333333331', 'Amara Diallo',      'amara.diallo@example.org'),
  ('33333333-3333-3333-3333-333333333332', 'Bilal Ozturk',      'bilal.ozturk@example.org'),
  ('33333333-3333-3333-3333-333333333333', 'Chiara Rossi',      'chiara.rossi@example.org'),
  ('33333333-3333-3333-3333-333333333334', 'Driss El Amrani',   'driss.elamrani@example.org');

-- -----------------------------------------------------------------------------
-- Inscriptions : les 4 etudiants suivent l'UF de demonstration
-- -----------------------------------------------------------------------------
INSERT INTO inscriptions (etudiant_id, uf_id) VALUES
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333334', '11111111-1111-1111-1111-111111111111');
