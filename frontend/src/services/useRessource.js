// src/services/useRessource.js
// Chargement de donnees avec rafraichissement silencieux et interrogation
// periodique optionnelle.
//
// Ecrit a la main plutot qu'en ajoutant SWR ou React Query : le besoin tient
// en une soixantaine de lignes, et ces bibliotheques apporteraient un cache
// global, une invalidation par cles et une gestion de mutations dont ce
// projet n'a aucun usage. Une dependance supplementaire est aussi une
// surface de plus a maintenir et a justifier devant un jury.
//
// Trois comportements en font tout l'interet :
//
// 1. RAFRAICHISSEMENT SILENCIEUX. Le drapeau `chargement` ne passe a vrai
//    qu'au TOUT PREMIER chargement. Les suivants remplacent les donnees sans
//    jamais afficher d'indicateur, donc sans faire clignoter la liste ni la
//    faire disparaitre sous le curseur. Un rechargement visible toutes les
//    cinq secondes serait pire que pas de rafraichissement du tout.
//
// 2. PAUSE QUAND L'ONGLET EST MASQUE. Interroger le serveur toutes les cinq
//    secondes pendant qu'un formateur consulte un autre onglet consomme du
//    reseau, de la batterie et du temps serveur pour rien. L'evenement
//    visibilitychange suspend la boucle, et un rafraichissement immediat est
//    declenche au retour pour que l'ecran soit a jour sans attendre.
//
// 3. SUSPENSION EXPLICITE. Le parent peut interrompre l'interrogation, par
//    exemple pendant qu'une modale est ouverte : voir la liste se reordonner
//    sous une boite de dialogue en cours de saisie est desagreable, et le
//    formulaire pourrait porter sur une ligne qui vient de changer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { appelerApi } from './api';

/**
 * @param {string|null} chemin - URL de l'API, ou null pour ne rien charger
 * @param {{ intervalleMs?: number, suspendu?: boolean }} [options]
 */
export function useRessource(chemin, options = {}) {
  const { intervalleMs = 0, suspendu = false } = options;

  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(Boolean(chemin));

  // Refs et non state : lues dans des rappels dont l'identite doit rester
  // stable, sinon l'effet se relancerait a chaque rendu et redemarrerait
  // l'intervalle en boucle.
  const dejaCharge = useRef(false);
  const montesRef = useRef(true);

  const recharger = useCallback(async () => {
    if (!chemin) return;
    try {
      const reponse = await appelerApi(chemin);
      if (!montesRef.current) return;
      setDonnees(reponse);
      setErreur('');
    } catch (echec) {
      if (!montesRef.current) return;
      // Une erreur survenue pendant un rafraichissement de fond n'efface PAS
      // les donnees deja affichees : une coupure reseau passagere ne doit pas
      // vider l'ecran d'un formateur en plein cours.
      if (!dejaCharge.current) setErreur(echec.message);
    } finally {
      if (montesRef.current) {
        dejaCharge.current = true;
        setChargement(false);
      }
    }
  }, [chemin]);

  useEffect(() => {
    montesRef.current = true;
    dejaCharge.current = false;
    setChargement(Boolean(chemin));
    recharger();
    return () => { montesRef.current = false; };
  }, [chemin, recharger]);

  useEffect(() => {
    if (!chemin || !intervalleMs || suspendu) return undefined;

    let minuteur = null;

    const demarrer = () => {
      arreter();
      minuteur = setInterval(recharger, intervalleMs);
    };
    const arreter = () => {
      if (minuteur !== null) { clearInterval(minuteur); minuteur = null; }
    };

    const surVisibilite = () => {
      if (document.hidden) {
        arreter();
      } else {
        // Rafraichissement immediat au retour : attendre le prochain tour
        // laisserait l'ecran perime plusieurs secondes juste au moment ou
        // l'utilisateur le regarde.
        recharger();
        demarrer();
      }
    };

    if (!document.hidden) demarrer();
    document.addEventListener('visibilitychange', surVisibilite);

    return () => {
      arreter();
      document.removeEventListener('visibilitychange', surVisibilite);
    };
  }, [chemin, intervalleMs, suspendu, recharger]);

  return { donnees, erreur, chargement, recharger };
}
