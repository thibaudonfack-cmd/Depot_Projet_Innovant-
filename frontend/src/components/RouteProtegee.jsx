// src/components/RouteProtegee.jsx
// Garde de navigation : exige une session, et eventuellement un role.
//
// Rappel de perimetre : ce composant protege l'AFFICHAGE, pas les donnees.
// La securite reelle est entierement portee par le backend (Etape 7c), qui
// refuse toute requete sans session valide. Contourner cette garde cote
// navigateur ne donnerait acces a aucune donnee : les ecrans seraient vides
// et chaque appel repondrait 401. C'est l'ordre de travail retenu
// deliberement, 7a puis 7c puis 7b, pour ne jamais avoir une interface qui
// parait protegee au-dessus d'une API qui ne l'est pas.

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, accueilDuRole } from '../context/contexte-auth';
import EcranChargement from './EcranChargement';

function RouteProtegee({ role, children }) {
  const { utilisateur, sessionVerifiee } = useAuth();
  const emplacement = useLocation();

  // Tant que le serveur n'a pas repondu, ne rien decider. Rediriger ici
  // renverrait vers /login tout utilisateur rafraichissant sa page, meme
  // avec une session valide.
  if (!sessionVerifiee) return <EcranChargement />;

  if (!utilisateur) {
    // L'emplacement demande est memorise pour y revenir apres connexion :
    // quelqu'un qui ouvre un lien direct vers /etudiant doit y arriver une
    // fois connecte, et non atterrir sur un accueil generique.
    return <Navigate to="/login" state={{ depuis: emplacement.pathname }} replace />;
  }

  if (role && utilisateur.role !== role) {
    // Mauvais role : renvoyer vers SON tableau de bord plutot qu'afficher une
    // erreur. Un formateur qui ouvre /etudiant s'est trompe de lien, il n'a
    // pas besoin d'un message d'echec.
    return <Navigate to={accueilDuRole(utilisateur.role)} replace />;
  }

  return children;
}

export default RouteProtegee;
