// src/pages/Connexion.jsx
// Ecran de connexion (/login).

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, accueilDuRole } from '../context/contexte-auth';
import { Bouton, Carte, Champ, Marque, Message } from '../components/ui';
import EcranChargement from '../components/EcranChargement';

// Comptes du jeu de donnees de demonstration (database/02-seed.sql).
// Uniquement pour les boutons de pre-remplissage, absents de la version de
// production (voir plus bas).
const COMPTES_DEMO = {
  etudiant: { email: 'amara.diallo@example.org', motDePasse: 'Etudiant123!' },
  formateur: { email: 'formateur@example.org', motDePasse: 'Formateur123!' },
};

function Connexion() {
  const { utilisateur, sessionVerifiee, connecter } = useAuth();
  const navigate = useNavigate();
  const emplacement = useLocation();

  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  // SOURCE UNIQUE DE REDIRECTION.
  //
  // Cet effet gere TOUS les cas : arrivee sur /login alors qu'on est deja
  // connecte, et redirection juste apres une connexion reussie. La version
  // precedente naviguait a DEUX endroits, ici et a la fin de la soumission,
  // ce qui produisait deux navigations concurrentes pour un meme evenement.
  //
  // Le defaut etait aggrave par le fait que envoiEnCours n'etait jamais
  // remis a false en cas de succes : on comptait sur le demontage du
  // composant. Si la navigation ne prenait pas effet, le bouton restait fige
  // sur "Connexion en cours" SANS message d'erreur, et seul un
  // rafraichissement manuel debloquait la situation.
  //
  // Faire dependre la navigation du seul etat `utilisateur` supprime la
  // course : il n'y a plus qu'un chemin possible, et il se declenche
  // exactement quand l'etat est pret.
  useEffect(() => {
    if (!sessionVerifiee || !utilisateur) return;

    // La destination memorisee avant la redirection vers /login n'est
    // honoree que si le role y donne acces. Sans ce controle, un etudiant
    // ayant tente d'ouvrir /formateur serait envoye vers /formateur apres
    // connexion, puis renvoye par RouteProtegee vers /etudiant : deux
    // navigations visibles la ou une suffit.
    const parDefaut = accueilDuRole(utilisateur.role);
    const demandee = emplacement.state?.depuis;
    const destination = demandee && demandee === parDefaut ? demandee : parDefaut;

    navigate(destination, { replace: true });
  }, [sessionVerifiee, utilisateur, emplacement.state, navigate]);

  if (!sessionVerifiee) return <EcranChargement />;

  async function handleSoumission(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnvoiEnCours(true);

    try {
      // La redirection n'est PAS declenchee ici : mettre a jour l'etat suffit,
      // l'effet ci-dessus s'en charge des que `utilisateur` est disponible.
      await connecter(email.trim(), motDePasse);
    } catch (echec) {
      setErreur(echec.message || 'La connexion a échoué. Réessayez.');
      setMotDePasse('');
    } finally {
      // Remis a false dans TOUS les cas, y compris en cas de succes. En cas
      // de succes le composant est normalement demonte aussitot, mais s'en
      // remettre a cela laissait le bouton bloque des que la navigation
      // tardait ou echouait, sans aucun retour visible pour l'utilisateur.
      setEnvoiEnCours(false);
    }
  }

  function preRemplir(cle) {
    const compte = COMPTES_DEMO[cle];
    setEmail(compte.email);
    setMotDePasse(compte.motDePasse);
    setErreur('');
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm motion-safe:animate-[apparition_300ms_ease-out]">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Marque taille="grande" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-sable-900">
              Connexion
            </h1>
            <p className="mt-1.5 text-sm text-sable-500">
              Accédez à votre espace de présence
            </p>
          </div>
        </div>

        <Carte>
          <form onSubmit={handleSoumission} className="space-y-5" noValidate>
            <Champ
              id="email"
              libelle="Adresse e-mail"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="prenom.nom@exemple.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              erreur={Boolean(erreur)}
              required
            />

            <Champ
              id="mot-de-passe"
              libelle="Mot de passe"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              erreur={Boolean(erreur)}
              required
            />

            {/* aria-live : le message d'erreur apparait apres une action
                asynchrone. Sans annonce, une personne utilisant un lecteur
                d'ecran ne saurait pas que la tentative a echoue. */}
            <div aria-live="polite">
              {erreur && <Message ton="erreur">{erreur}</Message>}
            </div>

            <Bouton
              type="submit"
              chargement={envoiEnCours}
              enfantsChargement="Connexion en cours"
              disabled={!email.trim() || !motDePasse}
            >
              Se connecter
            </Bouton>
          </form>
        </Carte>

        {/* Raccourcis de developpement. import.meta.env.DEV vaut false dans
            un build de production : ce bloc n'est alors meme pas inclus dans
            le bundle, ce qui evite d'y exposer des identifiants. */}
        {import.meta.env.DEV && (
          <div className="mt-6">
            <p className="mb-2 text-center text-xs text-sable-500">
              Raccourcis de développement
            </p>
            <div className="flex gap-2">
              <Bouton variante="secondaire" onClick={() => preRemplir('etudiant')} className="py-2 text-xs">
                Pré-remplir étudiant
              </Bouton>
              <Bouton variante="secondaire" onClick={() => preRemplir('formateur')} className="py-2 text-xs">
                Pré-remplir formateur
              </Bouton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default Connexion;
