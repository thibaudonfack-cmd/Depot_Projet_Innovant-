// src/context/AuthContext.jsx
// Etat d'authentification partage par toute l'application.
//
// Le cookie de session etant httpOnly, le frontend ne peut PAS savoir par
// lui-meme s'il est connecte : il lui est impossible de lire le cookie. La
// seule facon de le determiner est de demander au serveur, via
// GET /api/auth/moi. C'est ce que fait ce contexte au premier montage.
//
// Consequence importante pour l'interface : il existe un troisieme etat,
// entre "connecte" et "anonyme", pendant lequel la reponse du serveur n'est
// pas encore arrivee. Le confondre avec "anonyme" ferait clignoter la page de
// connexion a chaque rafraichissement, y compris pour une session
// parfaitement valide. D'ou l'etat pretAVerifier explicite ci-dessous.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appelerApi, enregistrerGestionnaireSessionPerdue } from '../services/api';
import { ContexteAuth } from './contexte-auth';

export function FournisseurAuth({ children }) {
  const [utilisateur, setUtilisateur] = useState(null);
  const [sessionVerifiee, setSessionVerifiee] = useState(false);

  // ------------------------------------------------------------------------
  // GARDE DE FRAICHEUR (Etape 11) -- corrige une course reelle, revelee par
  // les tests derriere un tunnel.
  //
  // Le defaut : la verification initiale (GET /api/auth/moi) part au montage.
  // En local elle repond en quelques millisecondes, avant toute action. A
  // travers un tunnel, elle peut encore etre EN VOL quand l'utilisateur
  // valide le formulaire de connexion. La connexion reussit, `utilisateur`
  // est renseigne... puis la verification initiale se termine en 401 (elle
  // avait ete emise AVANT la connexion, sans cookie) et son `.catch()`
  // remet `utilisateur` a null.
  //
  // Resultat observe : la page reste sur /login sans aucun message, alors
  // que la session est bel et bien ouverte cote serveur. Un F5 la debloque,
  // puisqu'une nouvelle verification part cette fois avec le cookie.
  //
  // Le compteur ci-dessous rend l'etat MONOTONE : toute action explicite
  // (connexion, deconnexion) l'incremente, et une reponse asynchrone plus
  // ancienne que l'action en cours est simplement ignoree. Une reponse
  // perimee ne peut plus ecraser un etat plus recent.
  //
  // Un booleen "dejaConnecte" ne suffirait pas : il faudrait le remettre a
  // zero a la deconnexion, et la meme course se reproduirait en sens
  // inverse. Un compteur qui ne fait que croitre n'a pas ce defaut.
  // ------------------------------------------------------------------------
  const generation = useRef(0);

  // Enregistre AVANT la premiere requete : si la session a expire pendant
  // que l'onglet etait ouvert, tout appel ulterieur remettra l'utilisateur a
  // l'etat deconnecte, et les routes protegees redirigeront d'elles-memes.
  useEffect(() => {
    enregistrerGestionnaireSessionPerdue(() => {
      // Meme raisonnement : un 401 tardif, emis par une requete partie avant
      // la connexion, ne doit pas deconnecter une session fraiche.
      generation.current += 1;
      setUtilisateur(null);
    });
  }, []);

  useEffect(() => {
    let annule = false;
    const generationAuDepart = generation.current;
    // Vrai si aucune action explicite n'est survenue depuis l'envoi de cette
    // requete. Dans le cas contraire, la reponse est perimee.
    const encoreValable = () => !annule && generation.current === generationAuDepart;

    appelerApi('/api/auth/moi', { silencieuxSi401: true })
      .then((donnees) => { if (encoreValable()) setUtilisateur(donnees.utilisateur); })
      .catch(() => { if (encoreValable()) setUtilisateur(null); })
      // sessionVerifiee passe a true dans TOUS les cas, meme perime : la
      // question "a-t-on interroge le serveur ?" a bien recu sa reponse, et
      // laisser l'ecran de chargement indefiniment serait pire que tout.
      .finally(() => { if (!annule) setSessionVerifiee(true); });

    // Meme precaution que dans QRScanner (Etape 6) : si le composant est
    // demonte avant la reponse, ne pas appeler setState sur un composant
    // demonte.
    return () => { annule = true; };
  }, []);

  const connecter = useCallback(async (email, motDePasse) => {
    const donnees = await appelerApi('/api/auth/login', {
      methode: 'POST',
      corps: { email, mot_de_passe: motDePasse },
    });

    // Une connexion reussie EST une verification de session : la marquer ici
    // evite que l'ecran de chargement reapparaisse si la verification
    // initiale n'a pas encore repondu.
    generation.current += 1;
    setUtilisateur(donnees.utilisateur);
    setSessionVerifiee(true);

    // L'utilisateur est RENVOYE pour que l'appelant puisse naviguer
    // immediatement, sans attendre que l'etat du contexte se propage.
    return donnees.utilisateur;
  }, []);

  const deconnecter = useCallback(async () => {
    try {
      await appelerApi('/api/auth/logout', { methode: 'POST' });
    } finally {
      // Etat local remis a zero meme si l'appel echoue : l'utilisateur a
      // demande a se deconnecter, l'interface doit le refleter. La session
      // serveur sera de toute facon invalidee a son expiration.
      generation.current += 1;
      setUtilisateur(null);
    }
  }, []);

  const valeur = useMemo(
    () => ({ utilisateur, sessionVerifiee, connecter, deconnecter }),
    [utilisateur, sessionVerifiee, connecter, deconnecter]
  );

  return <ContexteAuth.Provider value={valeur}>{children}</ContexteAuth.Provider>;
}
