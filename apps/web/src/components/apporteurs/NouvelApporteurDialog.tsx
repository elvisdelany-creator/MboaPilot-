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
import { creerApporteurRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Props {
  ouvert: boolean;
  onFerme: () => void;
  onSucces: () => void;
}

// 6.3 : création d'un apporteur d'affaires, taux de commission par défaut
// optionnel (sinon le taux global de la configuration s'applique).
export function NouvelApporteurDialog({ ouvert, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [tauxCommission, setTauxCommission] = useState("");
  const [enCours, setEnCours] = useState(false);

  function reinitialiser() {
    setNom("");
    setTelephone("");
    setTauxCommission("");
  }

  async function valider() {
    if (!nom.trim()) return;
    setEnCours(true);
    try {
      await creerApporteurRequete(token, {
        nom: nom.trim(),
        telephone: telephone.trim() || undefined,
        tauxCommissionDefaut: tauxCommission ? Number(tauxCommission) : undefined,
      });
      toast.success(`Apporteur « ${nom.trim()} » créé.`);
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la création de l'apporteur.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel apporteur d'affaires</DialogTitle>
          <DialogDescription>Le lien avec les abonnés qu'il recrute est permanent et non modifiable.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="apporteur-nom">Nom</Label>
            <Input id="apporteur-nom" value={nom} onChange={(e) => setNom(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="apporteur-telephone">Téléphone</Label>
            <Input id="apporteur-telephone" value={telephone} onChange={(e) => setTelephone(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="apporteur-taux">Taux de commission par défaut (‰, optionnel)</Label>
            <Input
              id="apporteur-taux"
              type="number"
              min={0}
              value={tauxCommission}
              onChange={(e) => setTauxCommission(e.target.value)}
              placeholder="Taux global de la configuration si vide"
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!nom.trim() || enCours} onClick={valider}>
            {enCours ? "Création…" : "Créer l'apporteur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
