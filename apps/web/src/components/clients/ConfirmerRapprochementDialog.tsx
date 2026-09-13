import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { confirmerRapprochementRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Paiement } from "@/lib/types";

interface Props {
  paiement: Paiement | null;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 6.5 : "Virement bancaire — Différée (rapprochement)" — confirmation
// manuelle une fois le relevé de banque vérifié, distincte de l'annulation
// (9.1) qui corrige un encaissement mal saisi.
export function ConfirmerRapprochementDialog({ paiement, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [enCours, setEnCours] = useState(false);

  async function confirmer() {
    if (!paiement) return;
    setEnCours(true);
    try {
      await confirmerRapprochementRequete(token, paiement.idPaiement);
      toast.success("Virement rapproché.");
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la confirmation du rapprochement.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={paiement !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmer le rapprochement bancaire</DialogTitle>
          <DialogDescription>{paiement && `Virement — ${formateurFcfa.format(paiement.montant)} FCFA`}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-card-foreground">
          À confirmer une fois le versement effectivement retrouvé sur le relevé bancaire de l'entreprise.
        </p>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Retour
          </Button>
          <Button className="cursor-pointer" disabled={enCours} onClick={confirmer}>
            {enCours ? "Confirmation…" : "Confirmer le rapprochement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
