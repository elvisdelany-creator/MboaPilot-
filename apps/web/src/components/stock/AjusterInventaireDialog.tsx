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
import { ajusterInventaireRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Produit } from "@/lib/types";

interface Props {
  produit: Produit | null;
  onFerme: () => void;
  onSucces: () => void;
}

// 5.2 : ajustement d'inventaire — écart constaté vs stock théorique,
// justification obligatoire, réservé à un rôle habilité (RBAC côté serveur).
export function AjusterInventaireDialog({ produit, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [quantiteComptee, setQuantiteComptee] = useState("");
  const [motif, setMotif] = useState("");
  const [enCours, setEnCours] = useState(false);

  function reinitialiser() {
    setQuantiteComptee("");
    setMotif("");
  }

  const ecart = produit && quantiteComptee !== "" ? Number(quantiteComptee) - produit.quantiteStock : null;

  async function valider() {
    if (!produit || quantiteComptee === "" || !motif.trim()) return;
    setEnCours(true);
    try {
      await ajusterInventaireRequete(token, {
        idProduit: produit.idProduit,
        siteId: utilisateur.siteId,
        quantiteComptee: Number(quantiteComptee),
        motif: motif.trim(),
        userId: utilisateur.idUser,
      });
      toast.success(`Inventaire ajusté — « ${produit.libelle} » à ${quantiteComptee} unité(s).`);
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'ajustement d'inventaire.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={produit !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajuster l'inventaire</DialogTitle>
          <DialogDescription>
            {produit?.libelle} — stock théorique actuel : {produit?.quantiteStock} unité(s).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="inventaire-quantite">Quantité comptée physiquement</Label>
            <Input
              id="inventaire-quantite"
              type="number"
              min={0}
              value={quantiteComptee}
              onChange={(e) => setQuantiteComptee(e.target.value)}
              className="mt-1"
            />
            {ecart !== null && ecart !== 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                Écart : {ecart > 0 ? `+${ecart}` : ecart} unité(s)
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="inventaire-motif">Justification</Label>
            <Input id="inventaire-motif" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. comptage mensuel du 1er du mois" className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={quantiteComptee === "" || !motif.trim() || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : "Valider l'ajustement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
