import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { annulerPaiementRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Paiement } from "@/lib/types";

interface Props {
  paiement: Paiement | null;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const LIBELLE_MODE: Record<Paiement["mode"], string> = { CASH: "Comptant", CHEQUE: "Chèque", VIREMENT: "Virement", MOBILE_MONEY: "Mobile Money" };

// 9.1, 11.5 : "Aucune opération destructrice (suppression de vente,
// annulation de paiement) sans confirmation et sans traçabilité" — corrige
// un encaissement mal saisi (mauvais mode, mauvais montant), distinct de
// l'avoir (6.4) qui corrige les lignes d'une facture déjà vendue.
export function AnnulerPaiementDialog({ paiement, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [enCours, setEnCours] = useState(false);

  async function confirmer() {
    if (!paiement) return;
    setEnCours(true);
    try {
      await annulerPaiementRequete(token, paiement.idPaiement, utilisateur.idUser);
      toast.success("Paiement annulé.");
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'annulation du paiement.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={paiement !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annuler ce paiement</DialogTitle>
          <DialogDescription>
            {paiement && `${LIBELLE_MODE[paiement.mode]} — ${formateurFcfa.format(paiement.montant)} FCFA`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-card-foreground">
            Ce paiement sera définitivement retiré (encaissement mal saisi : mauvais mode ou mauvais montant). Si c'était le seul
            encaissement de la facture, elle repassera en attente. Cette action est journalisée et irréversible.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Retour
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={enCours} onClick={confirmer}>
            {enCours ? "Annulation…" : "Confirmer l'annulation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
