import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Configuration de test du frontend (Etape 6).
//
// Portee VOLONTAIREMENT etroite : ce projet n'a pas vocation a couvrir
// l'interface entiere par des tests unitaires. Un seul comportement est
// teste, parce qu'il est a la fois critique et impossible a verifier a
// l'oeil : la liberation du flux camera (voir QRScanner.test.jsx). Une
// fuite ici laisse la camera du telephone ALLUMEE, sans aucun signe a
// l'ecran -- l'utilisateur ne s'en apercoit qu'a la batterie qui se vide.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
  },
});
