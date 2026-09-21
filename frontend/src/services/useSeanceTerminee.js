// src/services/useSeanceTerminee.js
// Bascule "en cours" -> "terminee" cote client, adossee a la verite serveur.
//
// LE SERVEUR RESTE LA SEULE AUTORITE. Il renvoie un drapeau `terminee`
// calcule contre sa propre horloge, et c'est lui qui refuse une demande de
// rectification hors delai. Ce hook ne fait qu'ANTICIPER l'affichage entre
// deux rafraichissements : sans lui, une seance se terminant a 12h00
// continuerait d'afficher "En cours" jusqu'au prochain appel reseau, ce qui
// est precisement le defaut constate.
//
// La regle de combinaison est deliberement asymetrique :
//   - si le SERVEUR dit "terminee", on le suit sans discuter ;
//   - sinon seulement, on regarde l'horloge locale.
// Ainsi une horloge locale en retard ne peut pas faire reapparaitre une
// seance terminee, alors qu'une horloge en avance ne fait qu'anticiper de
// quelques secondes un etat que le serveur confirmera. L'erreur possible est
// donc toujours du cote inoffensif.

import { useEffect, useState } from 'react';

/** Cadence de reevaluation. Une seance ne se termine qu'une fois. */
const PERIODE_MS = 10000;

/**
 * @param {boolean} termineeServeur - drapeau renvoye par l'API
 * @param {string|null} heureFinPrevue - instant ISO, ou null
 */
export function useSeanceTerminee(termineeServeur, heureFinPrevue) {
  const evaluer = () => {
    if (termineeServeur) return true;
    if (!heureFinPrevue) return false;
    return Date.now() > new Date(heureFinPrevue).getTime();
  };

  const [terminee, setTerminee] = useState(evaluer);

  useEffect(() => {
    setTerminee(evaluer());

    // Aucun minuteur si l'etat est deja definitif : une seance terminee ne
    // redevient jamais en cours, et faire tourner un intervalle pour rien
    // consomme inutilement.
    if (termineeServeur || !heureFinPrevue) return undefined;

    const minuteur = setInterval(() => {
      if (Date.now() > new Date(heureFinPrevue).getTime()) {
        setTerminee(true);
        clearInterval(minuteur);
      }
    }, PERIODE_MS);

    return () => clearInterval(minuteur);
    // evaluer depend des deux valeurs ci-dessous ; l'inclure dans les
    // dependances relancerait l'effet a chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termineeServeur, heureFinPrevue]);

  return terminee;
}
