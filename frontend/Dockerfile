# Dockerfile - mode developpement
# Meme image de base que backend/Dockerfile (node:20-alpine) : coherence
# des environnements d'execution entre les deux services applicatifs.
#
# Ce Dockerfile ne construit PAS de build de production (pas de "vite build"
# ni de serveur statique nginx) : conformement a la mission de l'Etape 4, il
# lance uniquement le serveur de developpement Vite, avec rechargement a
# chaud (HMR). Le dossier ./frontend est monte en volume par
# docker-compose.yml par-dessus /app -- COPY . . ci-dessous ne sert donc
# qu'a fournir un contenu par defaut pour un `docker compose build` isole
# (sans le montage), pas au fonctionnement normal du service.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
