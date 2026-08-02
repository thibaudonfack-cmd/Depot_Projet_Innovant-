// src/components/ui.jsx
// Petits composants d'interface partages par les trois ecrans.
//
// Regroupes ici plutot que dupliques : un bouton doit avoir le meme rayon,
// la meme hauteur et la meme transition partout, sinon l'ensemble donne
// rapidement l'impression d'avoir ete assemble par morceaux. Ce fichier tient
// lieu de petite bibliotheque interne, sans dependance ni abstraction
// inutile.

/** Bouton d'action. Trois variantes suffisent aux besoins actuels. */
export function Bouton({
  variante = 'principal',
  chargement = false,
  enfantsChargement,
  className = '',
  children,
  disabled,
  ...props
}) {
  const base =
    'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ' +
    'transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed';

  const variantes = {
    principal:
      'bg-accent-600 text-white shadow-[var(--shadow-douce)] hover:bg-accent-700 ' +
      'hover:shadow-[var(--shadow-elevee)] active:scale-[0.99] disabled:bg-sable-400 disabled:shadow-none',
    secondaire:
      'border border-sable-400 bg-white text-sable-700 shadow-[var(--shadow-douce)] ' +
      'hover:border-sable-500 hover:bg-sable-100 active:scale-[0.99] disabled:text-sable-500',
    discret:
      'text-sable-500 hover:bg-sable-200 hover:text-sable-900 disabled:text-sable-400',
  };

  return (
    <button
      className={`${base} ${variantes[variante]} ${className}`}
      disabled={disabled || chargement}
      {...props}
    >
      {chargement && (
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-full border-2 border-white/40 border-t-white motion-safe:animate-spin"
        />
      )}
      {chargement && enfantsChargement ? enfantsChargement : children}
    </button>
  );
}

/** Champ de saisie avec libelle, aide facultative et etat d'erreur. */
export function Champ({ id, libelle, aide, erreur = false, className = '', ...props }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-sable-700">
        {libelle}
      </label>
      {aide && (
        <p id={`${id}-aide`} className="text-xs text-sable-500">
          {aide}
        </p>
      )}
      <input
        id={id}
        aria-describedby={aide ? `${id}-aide` : undefined}
        aria-invalid={erreur || undefined}
        className={
          'w-full rounded-xl border bg-white px-3.5 py-3 text-sm text-sable-900 shadow-sm ' +
          'transition-colors duration-200 placeholder:text-sable-500 ' +
          'focus-visible:outline-none focus-visible:ring-4 ' +
          (erreur
            ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-500/10 '
            : 'border-sable-400 focus-visible:border-accent-600 focus-visible:ring-accent-500/15 ') +
          className
        }
        {...props}
      />
    </div>
  );
}

/** Carte de contenu. */
export function Carte({ className = '', children }) {
  return (
    <section
      className={
        'rounded-2xl border border-sable-300 bg-white p-6 shadow-[var(--shadow-douce)] ' + className
      }
    >
      {children}
    </section>
  );
}

/**
 * Message d'etat. Le ton porte la couleur ET une icone : une information
 * transmise par la seule couleur serait invisible pour une personne
 * daltonienne (WCAG 1.4.1).
 */
export function Message({ ton = 'info', titre, children }) {
  const tons = {
    succes: { boite: 'border-emerald-200 bg-emerald-50 text-emerald-900', icone: 'M20 6 9 17l-5-5' },
    erreur: { boite: 'border-red-200 bg-red-50 text-red-900', icone: 'M12 8v5M12 16.5v.01' },
    info: { boite: 'border-sable-300 bg-sable-100 text-sable-700', icone: 'M12 16v-5M12 8.5v.01' },
  };
  const { boite, icone } = tons[ton];

  return (
    <div
      className={`flex gap-3 rounded-xl border p-4 text-sm motion-safe:animate-[apparition_200ms_ease-out] ${boite}`}
    >
      <svg
        viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 size-4 shrink-0"
        fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      >
        {ton !== 'succes' && <circle cx="12" cy="12" r="9" />}
        <path d={icone} />
      </svg>
      <div className="min-w-0">
        {titre && <p className="font-semibold">{titre}</p>}
        <div className={titre ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Marque de l'application.
 * @param {'compacte'|'normale'|'grande'} taille
 */
export function Marque({ taille = 'normale' }) {
  const dimensions = {
    compacte: { pastille: 'size-10', icone: 'size-6', texte: 'text-base' },
    normale: { pastille: 'size-11', icone: 'size-7', texte: 'text-lg' },
    grande: { pastille: 'size-14', icone: 'size-8', texte: 'text-2xl' },
  }[taille];

  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex ${dimensions.pastille} shrink-0 items-center justify-center rounded-2xl bg-accent-600 shadow-[var(--shadow-douce)]`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className={`${dimensions.icone} text-white`} fill="currentColor">
          <path d="M4 4h6v6H4V4zm2 2v2h2V6H6zM14 4h6v6h-6V4zm2 2v2h2V6h-2zM4 14h6v6H4v-6zm2 2v2h2v-2H6zM14 14h2v2h-2v-2zM18 14h2v2h-2v-2zM16 16h2v2h-2v-2zM14 18h2v2h-2v-2zM18 18h2v2h-2v-2z" />
        </svg>
      </span>
      <span className={`${dimensions.texte} font-semibold tracking-tight text-sable-900`}>
        Prise de présence
      </span>
    </div>
  );
}
