import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  montant: number;
  total: number;
  enCours?: boolean;
  onConfirmer: () => void;
  onAnnuler: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 8.5, 9.2 : le rendu de monnaie n'est jamais rejeté (voir excedentEncaissementSuspect,
// packages/shared) — mais un écart de cette ampleur ressemble bien plus à un
// chiffre en trop sur le clavier numérique qu'à une remise en espèces réelle ;
// une confirmation explicite évite qu'un tel encaissement passe inaperçu
// jusqu'à la clôture de caisse.
export function ConfirmationSurpaiementDialog({ open, montant, total, enCours, onConfirmer, onAnnuler }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onAnnuler()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Montant encaissé inhabituel</DialogTitle>
          <DialogDescription>
            Total dû : {formateurFcfa.format(total)} FCFA — montant saisi : {formateurFcfa.format(montant)} FCFA
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-card-foreground">
            La monnaie à rendre serait de {formateurFcfa.format(montant - total)} FCFA. Vérifiez qu'il ne s'agit pas d'une erreur de
            saisie avant de continuer.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onAnnuler}>
            Corriger le montant
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={enCours} onClick={onConfirmer}>
            {enCours ? "Encaissement…" : "Confirmer ce montant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
