import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
//
// Configuration adaptee a l'execution dans un conteneur Docker, derriere le
// proxy HTTPS Caddy (cf. docker-compose.yml, Caddyfile, ANALYSE_CODE.md
// section Etape 4).
export default defineConfig({
  // tailwindcss() : plugin officiel Vite de Tailwind v4. Remplace l'ancienne
  // chaine PostCSS (postcss.config.js + autoprefixer) qui etait necessaire
  // en v3 -- voir ANALYSE_CODE.md, section "Standard UI/UX", pour la raison
  // pour laquelle il n'existe PAS de tailwind.config.js dans ce projet.
  plugins: [react(), tailwindcss()],
  server: {
    // host: true (equivalent a '0.0.0.0') : par defaut, le serveur de
    // developpement Vite n'ecoute que sur 127.0.0.1 A L'INTERIEUR du
    // conteneur -- injoignable depuis un autre conteneur du meme reseau
    // Docker (ici, Caddy). Sans ce reglage, le reverse_proxy de Caddy vers
    // frontend:5173 echouerait systematiquement (connexion refusee), meme
    // si le conteneur frontend demarre correctement.
    host: true,
    port: 5173,
    // strictPort : echoue explicitement si 5173 est deja pris plutot que de
    // glisser silencieusement vers un autre port -- Caddy est configure pour
    // joindre precisement frontend:5173 (Caddyfile), un port different
    // casserait le routage sans message d'erreur evident.
    strictPort: true,
    hmr: {
      // Le serveur HMR (Hot Module Replacement) ecoute reellement sur le
      // port 5173 A L'INTERIEUR du reseau Docker (jamais publie vers
      // l'hote, cf. docker-compose.yml -- meme principe que backend/mysql).
      // Mais le script HMR injecte dans la page tourne dans le NAVIGATEUR,
      // qui ne connait que l'origine publique https://localhost (port 443,
      // via Caddy). Sans cette precision, le client HMR tenterait d'ouvrir
      // une connexion WebSocket vers le port 5173 directement depuis le
      // navigateur -- port jamais expose a l'hote, donc injoignable : la
      // page se chargerait normalement, mais le rechargement a chaud (HMR)
      // resterait silencieusement casse. clientPort: 443 indique au script
      // HMR d'ouvrir sa connexion vers le meme port que la page elle-meme
      // (443, TLS Caddy) ; Caddy relaie ensuite cette connexion WebSocket
      // vers frontend:5173 exactement comme il le fait deja pour le
      // WebSocket applicatif du backend (qrBroadcaster.js, Etape 2) --
      // aucune configuration Caddy supplementaire n'est necessaire, le
      // meme mecanisme de reverse_proxy generique s'applique.
      clientPort: 443,
    },
  },
})
