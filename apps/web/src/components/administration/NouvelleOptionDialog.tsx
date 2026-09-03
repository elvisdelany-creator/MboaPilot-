import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { creerOptionRequete, modifierOptionRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { OptionCatalogue } from "@/lib/types";

interface Props {
  ouvert: boolean;
  option: OptionCatalogue | null; // non-null = édition, null = création
  onFerme: () => void;
  onSucces: () => void;
}

// 8.8 : création/édition d'une option/complément — le rattachement à une ou
// plusieurs formules (avec éventuel prix de surcharge) se fait séparément,
// depuis la liste des options.
export function NouvelleOptionDialog({ ouvert, option, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const edition = option !== null;

  const [libelle, setLibelle] = useState("");
  const [prix, setPrix] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setLibelle(option?.libelle ?? "");
    setPrix(option ? String(option.prix) : "");
  }, [ouvert, option]);

  const pretAValider = libelle.trim() && prix !== "";

  async function valider() {
    if (!pretAValider) return;
    setEnCours(true);
    try {
      if (edition && option) {
        await modifierOptionRequete(token, option.idOption, { libelle: libelle.trim(), prix: Number(prix) });
        toast.success(`Option « ${libelle.trim()} » modifiée.`);
      } else {
        await creerOptionRequete(token, { libelle: libelle.trim(), prix: Number(prix) });
        toast.success(`Option « ${libelle.trim()} » créée.`);
      }
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'enregistrement de l'option.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{edition ? "Modifier l'option" : "Nouvelle option"}</DialogTitle>
          <DialogDescription>Additionnel payant rattachable à une ou plusieurs formules.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="option-libelle">Libellé</Label>
            <Input id="option-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="option-prix">Prix par défaut (FCFA)</Label>
            <Input id="option-prix" type="number" min={0} value={prix} onChange={(e) => setPrix(e.target.value)} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pretAValider || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : edition ? "Enregistrer" : "Créer l'option"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
