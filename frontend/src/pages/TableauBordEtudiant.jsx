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
import { Bouton, Carte, Message } from '../components/ui';
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
      </main>
    </div>
  );
}

export default TableauBordEtudiant;
