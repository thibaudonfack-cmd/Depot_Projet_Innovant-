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

  // Quelqu'un qui arrive sur /login alors qu'il est deja connecte est
  // renvoye vers son tableau de bord plutot que de voir un formulaire
  // inutile. Dans un useEffect et non pendant le rendu : modifier la
  // navigation en cours de rendu declenche un avertissement de React.
  useEffect(() => {
    if (sessionVerifiee && utilisateur) {
      navigate(accueilDuRole(utilisateur.role), { replace: true });
    }
  }, [sessionVerifiee, utilisateur, navigate]);

  if (!sessionVerifiee) return <EcranChargement />;

  async function handleSoumission(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnvoiEnCours(true);

    try {
      const connecteur = await connecter(email.trim(), motDePasse);
      // Retour a la page demandee avant la redirection vers /login, s'il y
      // en avait une ; sinon, tableau de bord correspondant au role.
      const destination = emplacement.state?.depuis ?? accueilDuRole(connecteur.role);
      navigate(destination, { replace: true });
    } catch (echec) {
      setErreur(echec.message || 'La connexion a échoué. Réessayez.');
      setMotDePasse('');
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
          <Marque />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Connexion
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
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
            <p className="mb-2 text-center text-xs text-slate-400">
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
