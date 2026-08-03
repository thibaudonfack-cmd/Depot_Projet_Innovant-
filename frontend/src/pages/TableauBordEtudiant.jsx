// src/pages/TableauBordEtudiant.jsx
// Espace etudiant : etat de l'appareil, scan, historique et signalement.
//
// Concu en priorite pour le telephone, appareil reellement utilise en cours :
// colonne unique, cibles tactiles genereuses, actions atteignables au pouce.

import { useCallback, useEffect, useState } from 'react';
import EnTeteApplication from '../components/EnTeteApplication';
import QRScanner from '../components/QRScanner';
import Modale from '../components/Modale';
import {
  Badge, Bouton, Carte, Champ, ChargementEnLigne, EtatVide, Message,
} from '../components/ui';
import { dateCourte, duree, heure } from '../components/format';
import { appelerApi } from '../services/api';
import {
  generateAndStoreKeyPair, exportPublicKey, possedeDejaUneCle,
  signData, memoriserIdAppareil, lireIdAppareil,
} from '../services/CryptoService';

function decrireAppareil() {
  const ua = navigator.userAgent || '';
  const navigateur = ['Firefox', 'Edg', 'Chrome', 'Safari'].find((n) => ua.includes(n)) || 'Navigateur';
  return `${navigator.platform || 'Appareil'} · ${navigateur}`;
}

/** Convertit un instant UTC en valeur pour <input type="datetime-local">. */
function versChampLocal(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Etat de l'appareil
// ---------------------------------------------------------------------------

/**
 * Trois etats possibles, et un seul autorise le scan :
 *   'aucun'    : rien d'enrole pour ce compte
 *   'revoque'  : un appareil est actif, mais ce n'est pas celui-ci
 *   'actif'    : cet appareil est bien l'appareil enrole
 *
 * La distinction repose sur la comparaison entre l'identifiant conserve
 * localement lors de l'enrolement et celui renvoye par le serveur. Elle
 * permet de prevenir l'etudiant AVANT qu'il ne tente de scanner devant la
 * classe, plutot que de le laisser decouvrir le probleme au pire moment.
 */
function useEtatAppareil() {
  const [etat, setEtat] = useState(null);
  const [appareilActif, setAppareilActif] = useState(null);

  const verifier = useCallback(async () => {
    try {
      const [reponse, idLocal, cleLocale] = await Promise.all([
        appelerApi('/api/mon-appareil'), lireIdAppareil(), possedeDejaUneCle(),
      ]);
      const actif = reponse.appareil;
      setAppareilActif(actif);

      if (!actif) setEtat('aucun');
      else if (!cleLocale || !idLocal) setEtat('autre');
      else setEtat(idLocal === actif.id ? 'actif' : 'revoque');
    } catch {
      setEtat('erreur');
    }
  }, []);

  useEffect(() => { verifier(); }, [verifier]);
  return { etat, appareilActif, verifier };
}

function CarteAppareil({ etat, appareilActif, onEnrole }) {
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState(null);

  async function enroler() {
    setEnCours(true);
    setMessage(null);
    try {
      await generateAndStoreKeyPair();
      const clePublique = await exportPublicKey();
      const reponse = await appelerApi('/api/enrolements', {
        methode: 'POST',
        corps: { public_key: clePublique, device_info: decrireAppareil() },
      });
      // L'identifiant serveur est memorise localement : c'est lui qui
      // permettra plus tard de detecter une dissociation.
      await memoriserIdAppareil(reponse.appareil_id);
      setMessage({
        ton: 'succes',
        texte: reponse.appareil_precedent_revoque
          ? 'Cet appareil remplace le précédent, qui a été dissocié.'
          : 'Cet appareil est maintenant associé à votre compte.',
      });
      onEnrole();
    } catch (echec) {
      setMessage({ ton: 'erreur', texte: echec.message });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Carte>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-sable-900">Votre appareil</h2>
          <p className="mt-1 text-sm leading-relaxed text-sable-600">
            Une clé unique est créée sur ce téléphone et ne le quitte jamais.
            Elle sert à prouver que c&apos;est bien vous qui scannez.
          </p>
        </div>
        {etat && etat !== 'erreur' && (
          <Badge ton={etat === 'actif' ? 'actif' : etat === 'revoque' ? 'attention' : 'neutre'}>
            {{ actif: 'Associé', revoque: 'Dissocié', aucun: 'À associer', autre: 'À associer' }[etat]}
          </Badge>
        )}
      </div>

      {/* Alerte de dissociation. Distincte visuellement d'une simple
          information : l'etudiant doit comprendre immediatement que scanner
          depuis cet appareil ne fonctionnera pas. */}
      {etat === 'revoque' && (
        <div className="mt-5 rounded-xl border-2 border-red-300 bg-red-50 p-4">
          <div className="flex gap-3">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-red-700"
                 fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-900">Cet appareil a été dissocié</p>
              <p className="mt-1 text-sm leading-relaxed text-red-900">
                Un autre appareil a été associé à votre compte
                {appareilActif?.info_appareil ? ` (${appareilActif.info_appareil})` : ''}.
                Utilisez celui-ci pour scanner, ou réassociez cet appareil, ce qui
                dissociera l&apos;autre à son tour.
              </p>
            </div>
          </div>
        </div>
      )}

      {etat === 'aucun' && (
        <div className="mt-5">
          <Message ton="info" titre="Aucun appareil associé">
            Associez cet appareil pour pouvoir valider votre présence en cours.
          </Message>
        </div>
      )}

      {etat === 'erreur' && (
        <div className="mt-5">
          <Message ton="erreur">
            Impossible de vérifier l&apos;état de votre appareil. Rechargez la page.
          </Message>
        </div>
      )}

      <div className="mt-5">
        <Bouton
          variante={etat === 'actif' ? 'secondaire' : 'principal'}
          onClick={enroler}
          chargement={enCours}
          enfantsChargement="Association en cours"
        >
          {etat === 'actif' ? 'Associer à nouveau cet appareil' : 'Associer cet appareil'}
        </Bouton>
      </div>

      <div aria-live="polite">
        {message && <div className="mt-4"><Message ton={message.ton}>{message.texte}</Message></div>}
      </div>
    </Carte>
  );
}

// ---------------------------------------------------------------------------
// Signalement d'une erreur
// ---------------------------------------------------------------------------

function ModaleSignalement({ presence, onFermer, onEnvoye }) {
  const [motif, setMotif] = useState('');
  const [arrivee, setArrivee] = useState(versChampLocal(presence?.heure_arrivee));
  const [depart, setDepart] = useState(versChampLocal(presence?.heure_depart));
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const bornesIncoherentes = Boolean(arrivee && depart && depart <= arrivee);

  async function envoyer(evenement) {
    evenement.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await appelerApi('/api/rectifications', {
        methode: 'POST',
        corps: {
          presence_id: presence.id,
          motif: motif.trim(),
          // Les valeurs saisies sont locales ; toISOString() les convertit en
          // UTC, seul format que le serveur accepte.
          heure_arrivee_demandee: arrivee ? new Date(arrivee).toISOString() : null,
          heure_depart_demandee: depart ? new Date(depart).toISOString() : null,
        },
      });
      onEnvoye();
    } catch (echec) {
      setErreur(echec.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte={Boolean(presence)}
      titre="Signaler une erreur"
      description="Votre formateur recevra cette demande et pourra l'accepter ou la refuser."
      onFermer={onFermer}
    >
      <form onSubmit={envoyer} className="space-y-5" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="motif" className="block text-sm font-medium text-sable-900">
            Que faut-il corriger ?
          </label>
          <p id="motif-aide" className="text-xs text-sable-500">
            Expliquez brièvement la situation. Ce texte sera lu par votre formateur.
          </p>
          <textarea
            id="motif" rows={3} required aria-describedby="motif-aide"
            value={motif} onChange={(e) => setMotif(e.target.value)}
            placeholder="Exemple : je suis parti à 11h pour un rendez-vous médical."
            className="w-full resize-y rounded-xl border border-sable-400 bg-white px-3.5 py-3 text-sm
                       text-sable-900 shadow-sm transition-colors placeholder:text-sable-500
                       focus-visible:border-accent-600 focus-visible:outline-none
                       focus-visible:ring-4 focus-visible:ring-accent-500/15"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Champ id="arrivee" libelle="Arrivée réelle" type="datetime-local"
                 value={arrivee} onChange={(e) => setArrivee(e.target.value)} />
          <Champ id="depart" libelle="Départ réel" type="datetime-local"
                 value={depart} onChange={(e) => setDepart(e.target.value)}
                 erreur={bornesIncoherentes} />
        </div>

        <div aria-live="polite" className="space-y-3">
          {bornesIncoherentes && <Message ton="erreur">Le départ doit être postérieur à l&apos;arrivée.</Message>}
          {erreur && <Message ton="erreur">{erreur}</Message>}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Bouton type="submit" chargement={envoi} enfantsChargement="Envoi en cours"
                  disabled={!motif.trim() || bornesIncoherentes}>
            Envoyer la demande
          </Bouton>
          <Bouton type="button" variante="secondaire" onClick={onFermer}>Annuler</Bouton>
        </div>
      </form>
    </Modale>
  );
}

function LigneHistorique({ presence, onSignaler }) {
  const dejaDemande = Boolean(presence.demande_statut);
  const libelle = {
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

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge ton={presence.heure_depart ? 'neutre' : 'actif'}>{duree(presence.duree_minutes)}</Badge>

          {dejaDemande && (
            <Badge ton={presence.demande_statut === 'refusee' ? 'attention' : 'info'}>{libelle}</Badge>
          )}

          {!dejaDemande && presence.rectification_ouverte && (
            <Bouton variante="secondaire" onClick={() => onSignaler(presence)}
                    className="w-auto px-3 py-2 text-xs">
              Signaler une erreur
            </Bouton>
          )}

          {!dejaDemande && !presence.rectification_ouverte && (
            // Badge discret plutot qu'absence de bouton : sans explication,
            // un etudiant conclurait a un defaut de l'application.
            <Badge ton="neutre">Délai de signalement expiré</Badge>
          )}
        </div>
      </div>
    </li>
  );
}

function HistoriquePresences({ rafraichir }) {
  const [presences, setPresences] = useState(null);
  const [erreur, setErreur] = useState('');
  const [presenceSignalee, setPresenceSignalee] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    appelerApi('/api/mes-presences')
      .then((r) => { if (!annule) setPresences(r.presences); })
      .catch((e) => { if (!annule) setErreur(e.message); });
    return () => { annule = true; };
  }, [rafraichir, version]);

  const fermer = useCallback(() => setPresenceSignalee(null), []);

  return (
    <Carte>
      <h2 className="text-sm font-semibold text-sable-900">Mes présences</h2>
      <p className="mt-1 text-sm leading-relaxed text-sable-600">
        Historique des séances auxquelles vous avez assisté. Vous disposez de
        24 heures après la fin d&apos;une séance pour signaler une erreur.
      </p>

      <div aria-live="polite">
        {confirmation && <div className="mt-4"><Message ton="succes">{confirmation}</Message></div>}
      </div>

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
          {presences.map((p) => (
            <LigneHistorique key={p.id} presence={p} onSignaler={setPresenceSignalee} />
          ))}
        </ul>
      )}

      {presenceSignalee && (
        <ModaleSignalement
          presence={presenceSignalee}
          onFermer={fermer}
          onEnvoye={() => {
            setPresenceSignalee(null);
            setConfirmation('Votre demande a été transmise au formateur.');
            setVersion((v) => v + 1);
          }}
        />
      )}
    </Carte>
  );
}

// ---------------------------------------------------------------------------

function TableauBordEtudiant() {
  const { etat, appareilActif, verifier } = useEtatAppareil();
  const [scannerOuvert, setScannerOuvert] = useState(false);
  const [scanEnCours, setScanEnCours] = useState(false);
  const [resultatScan, setResultatScan] = useState(null);

  const scanPossible = etat === 'actif';

  const envoyerScan = useCallback(async (jeton) => {
    setScanEnCours(true);
    setResultatScan(null);
    try {
      const signature = await signData(jeton);
      await appelerApi('/api/scans', {
        methode: 'POST',
        corps: { jeton, signature_appareil: signature },
      });
      setResultatScan({ ton: 'succes', texte: 'Votre présence a bien été enregistrée.' });
    } catch (echec) {
      setResultatScan({ ton: 'erreur', texte: echec.message });
      // Un rejet pour appareil revoque signifie que l'etat local est perime :
      // on le rafraichit pour que l'alerte rouge apparaisse aussitot.
      if (echec.code === 'APPAREIL_REVOQUE') verifier();
    } finally {
      setScanEnCours(false);
    }
  }, [verifier]);

  const handleQRDetecte = useCallback((contenu) => {
    setScannerOuvert(false);
    envoyerScan(contenu.trim());
  }, [envoyerScan]);

  const fermerScanner = useCallback(() => setScannerOuvert(false), []);

  return (
    <div className="min-h-svh">
      <EnTeteApplication sousTitre="Espace étudiant" />

      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <CarteAppareil etat={etat} appareilActif={appareilActif} onEnrole={verifier} />

        <Carte>
          <h2 className="text-sm font-semibold text-sable-900">Valider ma présence</h2>
          <p className="mt-1 text-sm leading-relaxed text-sable-600">
            Scannez le QR code affiché par votre formateur. Il change
            régulièrement, visez celui qui est à l&apos;écran.
          </p>

          <div className="mt-5">
            {scannerOuvert ? (
              <QRScanner onDetection={handleQRDetecte} onAnnuler={fermerScanner} />
            ) : (
              <Bouton
                onClick={() => { setScannerOuvert(true); setResultatScan(null); }}
                chargement={scanEnCours}
                enfantsChargement="Validation en cours"
                disabled={!scanPossible}
              >
                Scanner le QR code
              </Bouton>
            )}
          </div>

          {/* Le scanner est verrouille tant que l'appareil n'est pas le bon,
              et la raison est dite explicitement. Desactiver un bouton sans
              expliquer pourquoi est l'une des frustrations les plus courantes
              dans une interface. */}
          {!scanPossible && !scannerOuvert && etat && (
            <p className="mt-3 text-xs text-sable-600">
              {etat === 'revoque'
                ? 'Scan indisponible : cet appareil a été dissocié de votre compte.'
                : 'Associez d\'abord cet appareil pour pouvoir scanner.'}
            </p>
          )}

          <div aria-live="polite">
            {resultatScan && (
              <div className="mt-4">
                <Message ton={resultatScan.ton}
                         titre={resultatScan.ton === 'succes' ? 'Présence validée' : undefined}>
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
