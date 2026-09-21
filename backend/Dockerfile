# Dockerfile - mode developpement
# Image legere (alpine) suffisante pour un backend Express sans dependance native.
FROM node:20-alpine

WORKDIR /app

# Copie isolee du manifeste de dependances avant le reste du code : le cache Docker
# ne reinstalle les paquets npm que si package.json/package-lock.json changent,
# pas a chaque modification de server.js.
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
