# Prototype de presence numerique — EA/FWB

Prototype de prise de presence par QR dynamique, enrolement cryptographique
d'appareil et verification geographique. Voir `ANALYSE_CODE.md` pour le detail
architectural de chaque brique, et `TESTING.md` pour le protocole de validation.

## Prerequis

- Docker Desktop (avec Docker Compose v2 integre) — demarre.
- Git.
- Un navigateur recent (Chrome, Firefox ou Edge).

Aucune installation de Node.js, MySQL ou autre outil n'est necessaire sur la
machine hote : tout tourne dans des conteneurs (conforme a RNF-15 —
deploiement reproductible sans competence d'administration avancee).

## Demarrage

```bash
git clone git@github.com:thibaudonfack-cmd/Depot_Projet_Innovant-.git
cd Depot_Projet_Innovant-
git checkout dev

cp .env.example .env
./generate_keys.sh

docker compose up -d
```

C'est la commande unique attendue par RNF-15. Verifier que tout est demarre :

```bash
docker compose ps
```

Les quatre services (`mysql`, `backend`, `frontend`, `proxy`) doivent
apparaitre avec un statut `running` (et `healthy` pour `mysql` apres
~20-30 secondes).

## Acceder a l'application

```
https://localhost/
```
Interface d'enrolement d'appareil (Etape 4). L'API backend reste accessible
sous `https://localhost/api/*`, par exemple :
```
https://localhost/api/health
```

**Avertissement de securite attendu au premier acces** : le navigateur affichera
une alerte de type "connexion non privee" / "certificat non fiable". C'est
normal — Caddy genere sa propre autorite de certification locale a l'interieur
du conteneur, que ton navigateur ne connait pas encore. Le protocole complet
(y compris comment faire confiance a cette autorite si tu veux un cadenas vert
propre) est detaille dans `TESTING.md`.

## Arret

```bash
docker compose down
```

Les donnees MySQL et le certificat local de Caddy sont conserves entre deux
demarrages (volumes nommes). Pour tout reinitialiser, y compris les donnees :

```bash
docker compose down -v
```

## Etat du projet

Etape 4 livree (enrolement cryptographique des appareils, ECDSA P-256 +
WebCrypto + IndexedDB cote client, RF-07/RF-09 cote backend). Voir
`ANALYSE_CODE.md` pour le detail de chaque partie livree et la prochaine
etape prevue.
