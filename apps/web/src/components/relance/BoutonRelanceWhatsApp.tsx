import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Relance d'un client par WhatsApp : ouvre la conversation avec le message déjà écrit (la personne de la boutique appuie sur « envoyer » depuis son
// propre WhatsApp). Grisé quand le numéro du client ne permet pas de savoir à quel pays l'écrire.
// Même bouton sur le tableau de bord (liste de relances) et dans la fiche du client (une ligne par abonnement) : `compact` suit la taille des
// boutons d'action de la fiche.
export function BoutonRelanceWhatsApp({ lien, nomClient, onOuvert, compact = false }: { lien: string | null; nomClient: string; onOuvert: () => void; compact?: boolean }) {
  const taille = compact ? "gap-1" : "min-h-11 shrink-0 gap-2 sm:min-h-9";
  const icone = compact ? "size-3.5" : "size-4";
  if (!lien) {
    return (
      <Button
        variant="outline"
        size={compact ? "sm" : "default"}
        disabled
        className={taille}
        title="Le numéro de ce client n'est pas utilisable pour WhatsApp : 9 chiffres (Cameroun) ou un indicatif commençant par + ou 00."
      >
        <MessageCircle className={icone} aria-hidden="true" />
        Relancer sur WhatsApp
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size={compact ? "sm" : "default"} className={cn("cursor-pointer", taille)}>
      <a href={lien} target="_blank" rel="noopener noreferrer" onClick={onOuvert} aria-label={`Relancer ${nomClient} sur WhatsApp (ouvre WhatsApp dans un nouvel onglet)`}>
        <MessageCircle className={icone} aria-hidden="true" />
        Relancer sur WhatsApp
      </a>
    </Button>
  );
}
