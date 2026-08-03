// src/pages/TableauBordEtudiant.jsx
// Espace etudiant (/etudiant) : enrolement de l'appareil puis scan.
//
// Concu en priorite pour le telephone, puisque c'est l'appareil reellement
// utilise en cours : une seule colonne, cibles tactiles genereuses, actions
// principales atteignables au pouce. La mise en page s'elargit simplement
// sur ecran plus grand, sans reorganisation.

import { useCallback, useEffect, useState } from 'react';
import EnTeteApplication from '../components/EnTeteApplication';
import QRScanner from '../components/QRScanner';
import {
  Badge, Bouton, Carte, ChargementEnLigne, EtatVide, Message,
} from '../components/ui';
import { dateCourte, duree, heure } from '../components/format';
import { appelerApi } from '../services/api';
import {
  generateAndStoreKeyPair,
  exportPublicKey,
  possedeDejaUneCle,
  signData,
} from '../services/CryptoService';

/** Description sommaire de l'appareil, a titre indicatif pour le formateur. */
function decrireAppareil() {
  const ua = navigator.userAgent || '';
  const navigateur = ['Firefox', 'Edg', 'Chrome', 'Safari'].find((n) => ua.includes(n)) || 'Navigateur';
  return `${navigator.platform || 'Appareil'} · ${navigateur}`;
}

/** Puce d'etat : couleur ET texte, jamais la couleur seule. */
function PuceEtat({ actif, children }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ' +
        (actif ? 'bg-emerald-50 text-emerald-700' : 'bg-sable-200 text-sable-600')
      }
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${actif ? 'bg-emerald-500' : 'bg-sable-500'}`} />
      {children}
    </span>
  );
}

/**
 * Fenetre de signalement d'erreur.
 *
 * L'ouverture du bouton depend d'un drapeau calcule PAR LE SERVEUR
 * (rectification_ouverte), jamais d'une comparaison de dates cote client :
 * il suffirait de changer l'heure de sa machine pour rouvrir une fenetre
 * fermee depuis des semaines.
 */
function LigneHistorique({ presence }) {
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  const dejaDemande = Boolean(presence.demande_statut);
  const libelleDemande = {
    en_attente: 'Signalement en attente',
    acceptee: 'Signalement accepté',
    refusee: 'Signalement refusé',
  }[presence.demande_statut];

  return (
    <li className="py-4 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-sable-900">{presence.uf_intitule}</p>
          <p className="mt-0.5 text-xs text-sable-600">
            {dateCourte(presence.heure_arrivee)} · {presence.salle_nom} ·{' '}
            {heure(presence.heure_arrivee)} à {heure(presence.heure_depart)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge ton={presence.heure_depart ? 'neutre' : 'actif'}>
            {duree(presence.duree_minutes)}
          </Badge>

          {dejaDemande && <Badge ton={presence.demande_statut === 'refusee' ? 'attention' : 'info'}>{libelleDemande}</Badge>}

          {!dejaDemande && presence.rectification_ouverte && (
            <Bouton variante="secondaire" onClick={() => setFormulaireOuvert((v) => !v)}
                    aria-expanded={formulaireOuvert} className="w-auto px-3 py-2 text-xs">
              Signaler une erreur
            </Bouton>
          )}
        </div>
      </div>

      {/* La fenetre fermee est signalee explicitement plutot que par la simple
          absence du bouton : sans explication, un etudiant croirait a un
          defaut de l'application. */}
      {!dejaDemande && !presence.rectification_ouverte && (
        <p className="mt-2 text-xs text-sable-600">
          Le délai de signalement de 24 heures est écoulé pour cette séance.
        </p>
      )}

      {formulaireOuvert && (
        <div className="mt-4 rounded-xl border border-sable-300 bg-sable-100 p-4">
          <Message ton="info" titre="Bientôt disponible">
            Le formulaire de signalement sera activé avec le suivi du temps.
            Votre demande sera transmise au formateur, qui pourra l&apos;accepter
            ou la refuser, et chaque décision laissera une trace horodatée.
          </Message>
        </div>
      )}
    </li>
  );
}

/** Historique des seances suivies par l'etudiant connecte. */
function HistoriquePresences({ rafraichir }) {
  const [presences, setPresences] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let annule = false;
    appelerApi('/api/mes-presences')
      .then((r) => { if (!annule) setPresences(r.presences); })
      .catch((e) => { if (!annule) setErreur(e.message); });
    return () => { annule = true; };
    // rafraichir change apres un scan reussi, ce qui relance le chargement :
    // la presence qui vient d'etre validee doit apparaitre sans que
    // l'etudiant ait a recharger la page.
  }, [rafraichir]);

  return (
    <Carte>
      <h2 className="text-sm font-semibold text-sable-900">Mes présences</h2>
      <p className="mt-1 text-sm leading-relaxed text-sable-600">
        Historique des séances auxquelles vous avez assisté.
      </p>

      {erreur && <div className="mt-4"><Message ton="erreur">{erreur}</Message></div>}
      {!presences && !erreur && <ChargementEnLigne libelle="Chargement de votre historique" />}

      {presences && presences.length === 0 && (
        <div className="mt-5">
          <EtatVide titre="Aucune présence enregistrée">
            Vos séances apparaîtront ici dès votre premier scan.
          </EtatVide>
        </div>
      )}

      {presences && presences.length > 0 && (
        <ul className="mt-5 divide-y divide-sable-200">
          {presences.map((p) => <LigneHistorique key={p.id} presence={p} />)}
        </ul>
      )}
    </Carte>
  );
}

function TableauBordEtudiant() {
  const [appareilPret, setAppareilPret] = useState(null); // null tant qu'inconnu
  const [enrolementEnCours, setEnrolementEnCours] = useState(false);
  const [messageEnrolement, setMessageEnrolement] = useState(null);

  const [scannerOuvert, setScannerOuvert] = useState(false);
  const [scanEnCours, setScanEnCours] = useState(false);
  const [resultatScan, setResultatScan] = useState(null);

  // Presence d'une cle locale : determine si l'appareil a deja ete enrole
  // depuis ce navigateur. Ne lit jamais la cle privee, seulement son
  // existence (CryptoService, Etape 4).
  useEffect(() => {
    let annule = false;
    possedeDejaUneCle()
      .then((existe) => { if (!annule) setAppareilPret(existe); })
      .catch(() => { if (!annule) setAppareilPret(false); });
    return () => { annule = true; };
  }, []);

  async function handleEnrolement() {
    setEnrolementEnCours(true);
    setMessageEnrolement(null);
    try {
      await generateAndStoreKeyPair();
      const clePublique = await exportPublicKey();
      // Aucun etudiant_id transmis : le serveur le lit dans la session
      // (Etape 7c). Le cookie part grace a credentials: 'same-origin',
      // applique systematiquement par appelerApi.
      const reponse = await appelerApi('/api/enrolements', {
        methode: 'POST',
        corps: { public_key: clePublique, device_info: decrireAppareil() },
      });
      setAppareilPret(true);
      setMessageEnrolement({
        ton: 'succes',
        texte: reponse.appareil_precedent_revoque
          ? 'Cet appareil remplace le précédent, qui a été révoqué.'
          : 'Cet appareil est maintenant associé à votre compte.',
      });
    } catch (echec) {
      setMessageEnrolement({ ton: 'erreur', texte: echec.message });
    } finally {
      setEnrolementEnCours(false);
    }
  }

  const envoyerScan = useCallback(async (jeton) => {
    setScanEnCours(true);
    setResultatScan(null);
    try {
      const signature = await signData(jeton);
      // Ici non plus, aucun etudiant_id : uniquement le jeton scanne et la
      // signature produite par la cle privee de cet appareil.
      const reponse = await appelerApi('/api/scans', {
        methode: 'POST',
        corps: { jeton, signature_appareil: signature },
      });
      setResultatScan({ ton: 'succes', texte: 'Votre présence a bien été enregistrée.', details: reponse });
    } catch (echec) {
      setResultatScan({ ton: 'erreur', texte: echec.message });
    } finally {
      setScanEnCours(false);
    }
  }, []);

  // useCallback obligatoire : QRScanner a cette fonction en dependance de son
  // effet. Recreee a chaque rendu, elle relancerait l'effet, donc couperait
  // et redemanderait la camera en boucle (cf. ANALYSE_CODE.md, Etape 6).
  const handleQRDetecte = useCallback((contenu) => {
    setScannerOuvert(false);
    envoyerScan(contenu.trim());
  }, [envoyerScan]);

  const fermerScanner = useCallback(() => setScannerOuvert(false), []);

  return (
    <div className="min-h-svh">
      <EnTeteApplication sousTitre="Espace étudiant" />

      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        {/* Appareil */}
        <Carte>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-sable-900">Votre appareil</h2>
              <p className="mt-1 text-sm leading-relaxed text-sable-500">
                Une clé unique est créée sur ce téléphone et ne le quitte jamais.
                Elle sert à prouver que c&apos;est bien vous qui scannez.
              </p>
            </div>
            {appareilPret !== null && (
              <PuceEtat actif={appareilPret}>
                {appareilPret ? 'Associé' : 'À associer'}
              </PuceEtat>
            )}
          </div>

          <div className="mt-5">
            <Bouton
              variante={appareilPret ? 'secondaire' : 'principal'}
              onClick={handleEnrolement}
              chargement={enrolementEnCours}
              enfantsChargement="Association en cours"
            >
              {appareilPret ? 'Associer à nouveau cet appareil' : 'Associer cet appareil'}
            </Bouton>
          </div>

          <div aria-live="polite">
            {messageEnrolement && (
              <div className="mt-4">
                <Message ton={messageEnrolement.ton}>{messageEnrolement.texte}</Message>
              </div>
            )}
          </div>
        </Carte>

        {/* Scan */}
        <Carte>
          <h2 className="text-sm font-semibold text-sable-900">Valider ma présence</h2>
          <p className="mt-1 text-sm leading-relaxed text-sable-500">
            Scannez le QR code affiché par votre formateur. Il change toutes les
            vingt secondes, pensez à viser celui qui est à l&apos;écran.
          </p>

          <div className="mt-5">
            {scannerOuvert ? (
              <QRScanner onDetection={handleQRDetecte} onAnnuler={fermerScanner} />
            ) : (
              <Bouton
                onClick={() => { setScannerOuvert(true); setResultatScan(null); }}
                chargement={scanEnCours}
                enfantsChargement="Validation en cours"
                disabled={appareilPret === false}
              >
                Scanner le QR code
              </Bouton>
            )}
          </div>

          {appareilPret === false && !scannerOuvert && (
            <p className="mt-3 text-xs text-sable-500">
              Associez d&apos;abord cet appareil pour pouvoir scanner.
            </p>
          )}

          <div aria-live="polite">
            {resultatScan && (
              <div className="mt-4">
                <Message ton={resultatScan.ton} titre={resultatScan.ton === 'succes' ? 'Présence validée' : undefined}>
                  {resultatScan.texte}
                </Message>
              </div>
            )}
          </div>
        </Carte>

        <HistoriquePresences rafraichir={resultatScan?.ton === 'succes'} />
      </main>
    </div>
  );
}

export default TableauBordEtudiant;
