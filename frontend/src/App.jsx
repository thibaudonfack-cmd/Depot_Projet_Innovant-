// src/App.jsx
// Routage de l'application (Etape 7b).
//
// L'ancienne page unique qui reunissait enrolement, affichage formateur et
// scan a disparu : elle etait explicitement designee comme un outil de test
// (cf. ANALYSE_CODE.md, Etape 4, "Role de l'interface temporaire"). Chaque
// role dispose maintenant de son propre espace, comme dans le produit final.

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { FournisseurAuth } from './context/AuthContext';
import { useAuth, accueilDuRole } from './context/contexte-auth';
import RouteProtegee from './components/RouteProtegee';
import EcranChargement from './components/EcranChargement';
import Connexion from './pages/Connexion';
import TableauBordEtudiant from './pages/TableauBordEtudiant';
import TableauBordFormateur from './pages/TableauBordFormateur';

/** Aiguillage de la racine vers le bon espace, ou vers la connexion. */
function Racine() {
  const { utilisateur, sessionVerifiee } = useAuth();
  if (!sessionVerifiee) return <EcranChargement />;
  return <Navigate to={utilisateur ? accueilDuRole(utilisateur.role) : '/login'} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <FournisseurAuth>
        <Routes>
          <Route path="/" element={<Racine />} />
          <Route path="/login" element={<Connexion />} />

          <Route
            path="/etudiant"
            element={
              <RouteProtegee role="etudiant">
                <TableauBordEtudiant />
              </RouteProtegee>
            }
          />

          <Route
            path="/formateur"
            element={
              <RouteProtegee role="formateur">
                <TableauBordFormateur />
              </RouteProtegee>
            }
          />

          {/* Toute autre adresse renvoie a la racine, qui aiguille ensuite
              selon la session. Evite une page blanche sur une URL erronee. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </FournisseurAuth>
    </BrowserRouter>
  );
}

export default App;
