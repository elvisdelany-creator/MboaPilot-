import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { enregistrerCasseRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Produit } from "@/lib/types";

interface Props {
  produit: Produit | null;
  onFerme: () => void;
  onSucces: () => void;
}

// 5.2 : casse / perte / retour fournisseur — décrémente le stock, motif obligatoire
export function CasseDialog({ produit, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [quantite, setQuantite] = useState("");
  const [motif, setMotif] = useState("");
  const [enCours, setEnCours] = useState(false);

  function reinitialiser() {
    setQuantite("");
    setMotif("");
  }

  async function valider() {
    if (!produit || !quantite || !motif.trim()) return;
    setEnCours(true);
    try {
      await enregistrerCasseRequete(token, {
        idProduit: produit.idProduit,
        siteId: utilisateur.siteId,
        quantite: Number(quantite),
        motif: motif.trim(),
        userId: utilisateur.idUser,
      });
      toast.success(`Casse enregistrée — ${quantite} unité(s) de « ${produit.libelle} ».`);
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'enregistrement de la casse.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={produit !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Casse / perte</DialogTitle>
          <DialogDescription>{produit?.libelle} — sortie de stock non rattachée à une vente.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="casse-quantite">Quantité</Label>
            <Input id="casse-quantite" type="number" min={1} value={quantite} onChange={(e) => setQuantite(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="casse-motif">Motif</Label>
            <Input id="casse-motif" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. chute pendant transport, vol…" className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={!quantite || !motif.trim() || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : "Enregistrer la casse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
