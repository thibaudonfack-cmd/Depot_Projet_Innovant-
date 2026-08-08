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

  /**
   * Destination apres connexion, pour un utilisateur donne.
   *
   * Extraite en fonction pure : la redirection a desormais DEUX declencheurs
   * (l'arrivee sur /login en etant deja connecte, et la soumission du
   * formulaire), et c'est precisement parce qu'ils partagent ce calcul qu'ils
   * ne peuvent pas diverger. Le defaut corrige a l'Etape 7b venait de deux
   * navigations qui calculaient CHACUNE leur destination.
   *
   * La destination memorisee avant la redirection vers /login n'est honoree
   * que si le role y donne acces. Sans ce controle, un etudiant ayant tente
   * d'ouvrir /formateur y serait envoye apres connexion, puis renvoye par
   * RouteProtegee vers /etudiant : deux navigations visibles la ou une suffit.
   */
  function destinationPour(compte) {
    const parDefaut = accueilDuRole(compte.role);
    const demandee = emplacement.state?.depuis;
    return demandee && demandee === parDefaut ? demandee : parDefaut;
  }

  // Cet effet ne traite plus QU'UN seul cas : arriver sur /login alors qu'une
  // session est deja ouverte (retour arriere du navigateur, favori, second
  // onglet). La redirection APRES connexion, elle, est imperative dans la
  // soumission.
  //
  // Pourquoi ce changement : faire dependre la redirection d'un effet
  // signifiait attendre que l'etat du contexte se propage jusqu'ici. En
  // local c'est imperceptible ; derriere un tunnel, cela ajoutait un temps
  // mort visible ou la page paraissait ne rien faire. Naviguer avec la
  // valeur RENVOYEE par connecter() supprime cette attente : on n'a pas
  // besoin de l'etat pour savoir ou aller, on a deja l'utilisateur en main.
  //
  // Les deux chemins ne se concurrencent pas : ils ne s'appliquent jamais au
  // meme evenement, et calculent la meme destination par la meme fonction.
  useEffect(() => {
    if (!sessionVerifiee || !utilisateur) return;
    navigate(destinationPour(utilisateur), { replace: true });
    // destinationPour depend de emplacement.state, deja dans les
    // dependances ; l'inclure relancerait l'effet a chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVerifiee, utilisateur, emplacement.state, navigate]);

  if (!sessionVerifiee) return <EcranChargement />;

  async function handleSoumission(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnvoiEnCours(true);

    try {
      // REDIRECTION IMPERATIVE, avec la valeur renvoyee par connecter().
      //
      // On ne lit PAS l'etat `utilisateur` du contexte : au moment ou cette
      // ligne s'execute, le rendu qui le contiendra n'a pas encore eu lieu.
      // L'objet retourne, lui, est disponible immediatement -- la navigation
      // part donc dans le meme tour de boucle que la reponse du serveur,
      // sans le temps mort qui se voyait derriere un tunnel.
      const compte = await connecter(email.trim(), motDePasse);
      navigate(destinationPour(compte), { replace: true });
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
              <span className="text-xs text-sable-600">Mode démo</span>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <Selection
                  id="demo-formateur"
                  libelle="Formateur"
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
          </section>
        )}
      </div>
    </main>
  );
}

export default Connexion;
