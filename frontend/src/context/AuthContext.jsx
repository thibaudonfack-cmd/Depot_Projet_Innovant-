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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { appelerApi, enregistrerGestionnaireSessionPerdue } from '../services/api';
import { ContexteAuth } from './contexte-auth';

export function FournisseurAuth({ children }) {
  const [utilisateur, setUtilisateur] = useState(null);
  const [sessionVerifiee, setSessionVerifiee] = useState(false);

  // Enregistre AVANT la premiere requete : si la session a expire pendant
  // que l'onglet etait ouvert, tout appel ulterieur remettra l'utilisateur a
  // l'etat deconnecte, et les routes protegees redirigeront d'elles-memes.
  useEffect(() => {
    enregistrerGestionnaireSessionPerdue(() => setUtilisateur(null));
  }, []);

  useEffect(() => {
    let annule = false;

    appelerApi('/api/auth/moi', { silencieuxSi401: true })
      .then((donnees) => { if (!annule) setUtilisateur(donnees.utilisateur); })
      .catch(() => { if (!annule) setUtilisateur(null); })
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
    setUtilisateur(donnees.utilisateur);
    return donnees.utilisateur;
  }, []);

  const deconnecter = useCallback(async () => {
    try {
      await appelerApi('/api/auth/logout', { methode: 'POST' });
    } finally {
      // Etat local remis a zero meme si l'appel echoue : l'utilisateur a
      // demande a se deconnecter, l'interface doit le refleter. La session
      // serveur sera de toute facon invalidee a son expiration.
      setUtilisateur(null);
    }
  }, []);

  const valeur = useMemo(
    () => ({ utilisateur, sessionVerifiee, connecter, deconnecter }),
    [utilisateur, sessionVerifiee, connecter, deconnecter]
  );

  return <ContexteAuth.Provider value={valeur}>{children}</ContexteAuth.Provider>;
}
