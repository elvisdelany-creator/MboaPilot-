import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErreurAuthentification, resilierAbonnementRequete } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Props {
  numeroAbonnement: number | null;
  libelle: string;
  // CANAL+ : une commission en cours est annulée si la résiliation tombe pendant la période probatoire
  commissionEnCours: boolean;
  onFerme: () => void;
  onSucces: () => void;
}

// 4.3 : « ACTIF → RESILIE (action manuelle) — demande du client, litige, matériel non restitué ». État terminal : seul un nouvel
// abonnement (nouveau numéro) peut suivre, jamais un réabonnement.
export function ResilierAbonnementDialog({ numeroAbonnement, libelle, commissionEnCours, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [motif, setMotif] = useState("");
  const [enCours, setEnCours] = useState(false);
  useEffect(() => setMotif(""), [numeroAbonnement]);

  async function confirmer() {
    if (numeroAbonnement === null) return;
    setEnCours(true);
    try {
      const resultat = await resilierAbonnementRequete(token, numeroAbonnement, motif.trim());
      toast.success(`Abonnement n° ${numeroAbonnement} résilié${resultat.commissionAnnulee ? " — commission CANAL+ annulée" : ""}.`);
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la résiliation.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={numeroAbonnement !== null} onOpenChange={(v) => !v && !enCours && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Résilier cet abonnement</DialogTitle>
          <DialogDescription>
            {libelle}
            {numeroAbonnement !== null ? ` — n° ${numeroAbonnement}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="motif-resiliation">Motif de la résiliation</Label>
          <Input
            id="motif-resiliation"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            maxLength={200}
            placeholder="Demande du client, litige, matériel non restitué…"
            className="mt-1 h-11 text-base"
          />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-card-foreground">
            La résiliation est définitive : cet abonnement ne pourra plus être renouvelé, un nouvel abonnement devra être créé pour ce client.
            {commissionEnCours && " La commission CANAL+ en cours sera annulée si la période probatoire n'est pas terminée."} Le motif est conservé dans l'historique.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" disabled={enCours} onClick={onFerme}>
            Retour
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={enCours || motif.trim() === ""} onClick={confirmer}>
            {enCours ? "Résiliation…" : "Confirmer la résiliation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
