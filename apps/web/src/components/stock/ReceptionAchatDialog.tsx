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
import { receptionnerAchatRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Produit } from "@/lib/types";

interface Props {
  produit: Produit | null;
  onFerme: () => void;
  onSucces: () => void;
}

// 5.2 : réception d'achat — incrémente le stock, recalcule le coût de
// revient en coût moyen pondéré côté serveur.
export function ReceptionAchatDialog({ produit, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [quantite, setQuantite] = useState("");
  const [coutUnitaire, setCoutUnitaire] = useState("");
  const [enCours, setEnCours] = useState(false);

  function reinitialiser() {
    setQuantite("");
    setCoutUnitaire("");
  }

  async function valider() {
    if (!produit || !quantite || !coutUnitaire) return;
    setEnCours(true);
    try {
      await receptionnerAchatRequete(token, {
        idProduit: produit.idProduit,
        siteId: utilisateur.siteId,
        quantite: Number(quantite),
        coutUnitaire: Number(coutUnitaire),
        userId: utilisateur.idUser,
      });
      toast.success(`Réception enregistrée — ${quantite} unité(s) de « ${produit.libelle} ».`);
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la réception d'achat.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={produit !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Réceptionner un achat</DialogTitle>
          <DialogDescription>{produit?.libelle} — le coût de revient est recalculé en moyenne pondérée.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="achat-quantite">Quantité reçue</Label>
            <Input id="achat-quantite" type="number" min={1} value={quantite} onChange={(e) => setQuantite(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="achat-cout">Coût d'achat unitaire (FCFA)</Label>
            <Input id="achat-cout" type="number" min={0} value={coutUnitaire} onChange={(e) => setCoutUnitaire(e.target.value)} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!quantite || !coutUnitaire || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : "Enregistrer la réception"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
