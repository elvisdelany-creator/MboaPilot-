import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { annulerVenteEnAttenteRequete, ErreurAuthentification, type VenteEnAttente } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Props {
  vente: VenteEnAttente | null;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 9.1, 11.5 : aucune suppression de vente sans confirmation ni traçabilité. L'annulation d'une vente jamais encaissée remet
// ses articles en stock ; une vente déjà encaissée se corrige par un avoir.
export function AnnulerVenteEnAttenteDialog({ vente, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const [enCours, setEnCours] = useState(false);

  async function confirmer() {
    if (!vente) return;
    setEnCours(true);
    try {
      await annulerVenteEnAttenteRequete(token, vente.idFacture);
      toast.success(`Vente annulée — facture n° ${vente.idFacture}, stock restitué.`);
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'annulation de la vente.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={vente !== null} onOpenChange={(v) => !v && !enCours && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annuler cette vente</DialogTitle>
          <DialogDescription>
            {vente && `Facture n° ${vente.idFacture} — ${formateurFcfa.format(vente.montantTotal)} FCFA — ${vente.client ?? "sans client"}`}
          </DialogDescription>
        </DialogHeader>

        {vente && (
          <ul className="space-y-1 text-sm text-card-foreground">
            {vente.lignes.map((l) => (
              <li key={l.libelle}>
                {l.quantite} × {l.libelle}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-card-foreground">
            Aucun encaissement n'a été enregistré sur cette vente. Elle sera supprimée et ses articles remis en stock. Cette action
            est journalisée et irréversible.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" disabled={enCours} onClick={onFerme}>
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
