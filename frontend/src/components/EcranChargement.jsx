// src/components/EcranChargement.jsx
// Ecran affiche pendant la verification de session au chargement.
//
// Volontairement sobre et sans texte alarmant : cette attente dure quelques
// dizaines de millisecondes dans le cas normal. Un message du type
// "Verification de vos droits" inquieterait sans raison.

function EcranChargement() {
  return (
    <div className="flex min-h-svh items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="size-7 rounded-full border-2 border-sable-300 border-t-accent-600 motion-safe:animate-spin"
        />
        <p className="text-sm text-sable-500">Chargement</p>
      </div>
    </div>
  );
}

export default EcranChargement;
