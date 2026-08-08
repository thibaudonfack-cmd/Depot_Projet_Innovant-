// src/pages/Connexion.jsx
// Ecran de connexion (/login).

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, accueilDuRole } from '../context/contexte-auth';
import { Bouton, Carte, Champ, Marque, Message, Selection } from '../components/ui';
import EcranChargement from '../components/EcranChargement';
import {
  FORMATEURS, ETUDIANTS, MOT_DE_PASSE_FORMATEUR, MOT_DE_PASSE_ETUDIANT,
} from '../components/comptesDemo';

/**
 * Le bloc d'acces rapide n'existe QUE hors production.
 *
 * import.meta.env.DEV vaut false dans un build de production : Rollup elimine
 * alors tout le bloc a la compilation, et les identifiants n'apparaissent
 * meme pas dans le bundle. VITE_MODE_DEMO permet de le reactiver
 * DELIBEREMENT sur un build, par exemple pour une soutenance servie
 * autrement que par le serveur de developpement.
 */
const MODE_DEMO = import.meta.env.DEV || import.meta.env.VITE_MODE_DEMO === '1';

function Connexion() {
  const { utilisateur, sessionVerifiee, connecter } = useAuth();
  const navigate = useNavigate();
  const emplacement = useLocation();

  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  // Compte de demonstration selectionne. Un SEUL etat pour les deux listes :
  // une identite chargee chasse l'autre, et laisser les deux listes afficher
  // un nom simultanement suggererait deux sessions ouvertes.
  const [compteDemo, setCompteDemo] = useState('');

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

  /**
   * Remplit le formulaire sans le soumettre.
   *
   * Choix delibere de NE PAS enchainer sur une connexion automatique : voir
   * l'identifiant s'inscrire dans le champ montre au jury quel compte est
   * utilise, ce qui est precisement l'interet d'une demonstration de
   * cloisonnement. Une connexion instantanee escamoterait l'information.
   */
  function preRemplir(adresse, motDePasseCompte) {
    setEmail(adresse);
    setMotDePasse(motDePasseCompte);
    setCompteDemo(adresse);
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

        {MODE_DEMO && (
          <section
            aria-labelledby="titre-acces-rapide"
            className="mt-6 rounded-2xl border border-dashed border-sable-400 bg-sable-50/70 p-5"
          >
            {/* Bordure en pointillés et fond légèrement teinté : le bloc doit
                se lire comme un dispositif temporaire, visuellement distinct
                de la carte de connexion qui, elle, est le produit. */}
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="titre-acces-rapide" className="text-sm font-medium text-sable-900">
                Accès rapide
              </h2>
              <span className="text-xs text-sable-600">Jeu de démonstration</span>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <Selection
                  id="demo-formateur"
                  libelle="Formateur"
                  aide="Choisissez Nadia Cherif pour observer le cloisonnement : elle n'encadre qu'une seule unité de formation."
                  value={FORMATEURS.some((f) => f.email === compteDemo) ? compteDemo : ''}
                  onChange={(e) => {
                    if (e.target.value) preRemplir(e.target.value, MOT_DE_PASSE_FORMATEUR);
                  }}
                >
                  <option value="">Sélectionner…</option>
                  {FORMATEURS.map((f) => (
                    <option key={f.email} value={f.email}>
                      {f.nom} · {f.perimetre}
                    </option>
                  ))}
                </Selection>
              </div>

              <div>
                <Selection
                  id="demo-etudiant"
                  libelle="Étudiant"
                  value={ETUDIANTS.some((etu) => etu.email === compteDemo) ? compteDemo : ''}
                  onChange={(e) => {
                    if (e.target.value) preRemplir(e.target.value, MOT_DE_PASSE_ETUDIANT);
                  }}
                >
                  <option value="">Sélectionner…</option>
                  {ETUDIANTS.map((etu) => (
                    <option key={etu.email} value={etu.email}>{etu.nom}</option>
                  ))}
                </Selection>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-sable-600">
              Le formulaire est rempli, pas soumis : vous gardez la main sur le
              moment de la connexion. Ce bloc est absent des versions de
              production.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

export default Connexion;
