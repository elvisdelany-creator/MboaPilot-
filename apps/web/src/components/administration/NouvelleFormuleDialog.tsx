import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { creerFormuleRequete, modifierFormuleRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Famille, Formule } from "@/lib/types";

interface Props {
  ouvert: boolean;
  familles: Famille[];
  formule: Formule | null; // non-null = édition, null = création
  idFamilleInitiale: number | null;
  onFerme: () => void;
  onSucces: () => void;
}

const LIBELLES_MODE_DUREE: Record<"STRICT_30J" | "MOIS_CIVIL", string> = {
  STRICT_30J: "30 jours stricts",
  MOIS_CIVIL: "Mois civil",
};

// 8.8, 4.1 : création/édition d'une formule — libellé, prix, rang (hiérarchie
// pour la migration, 7.4), mode de calcul de validité et durée en cycles.
export function NouvelleFormuleDialog({ ouvert, familles, formule, idFamilleInitiale, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const edition = formule !== null;

  const [idFamille, setIdFamille] = useState<string>("");
  const [libelle, setLibelle] = useState("");
  const [prix, setPrix] = useState("");
  const [rang, setRang] = useState("");
  const [modeDuree, setModeDuree] = useState<"STRICT_30J" | "MOIS_CIVIL">("STRICT_30J");
  const [dureeCycles, setDureeCycles] = useState("1");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    if (formule) {
      setIdFamille(String(formule.idFamille));
      setLibelle(formule.libelle);
      setPrix(String(formule.prix));
      setRang(String(formule.rang));
      setModeDuree(formule.modeDuree);
      setDureeCycles(String(formule.dureeCycles));
    } else {
      setIdFamille(idFamilleInitiale ? String(idFamilleInitiale) : "");
      setLibelle("");
      setPrix("");
      setRang("");
      setModeDuree("STRICT_30J");
      setDureeCycles("1");
    }
  }, [ouvert, formule, idFamilleInitiale]);

  const pretAValider = idFamille && libelle.trim() && prix !== "" && rang !== "";

  async function valider() {
    if (!pretAValider) return;
    setEnCours(true);
    try {
      if (edition && formule) {
        await modifierFormuleRequete(token, formule.idFormule, {
          libelle: libelle.trim(),
          prix: Number(prix),
          rang: Number(rang),
          modeDuree,
          dureeCycles: Number(dureeCycles),
        });
        toast.success(`Formule « ${libelle.trim()} » modifiée.`);
      } else {
        await creerFormuleRequete(token, {
          idFamille: Number(idFamille),
          libelle: libelle.trim(),
          prix: Number(prix),
          rang: Number(rang),
          modeDuree,
          dureeCycles: Number(dureeCycles),
        });
        toast.success(`Formule « ${libelle.trim()} » créée.`);
      }
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'enregistrement de la formule.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{edition ? "Modifier la formule" : "Nouvelle formule"}</DialogTitle>
          <DialogDescription>Le rang détermine la hiérarchie pour le changement de formule (7.4).</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="formule-famille">Famille</Label>
            <Select value={idFamille} onValueChange={setIdFamille} disabled={edition}>
              <SelectTrigger id="formule-famille" className="mt-1 w-full">
                <SelectValue placeholder="Choisir une famille" />
              </SelectTrigger>
              <SelectContent>
                {familles.map((f) => (
                  <SelectItem key={f.idFamille} value={String(f.idFamille)}>
                    {f.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="formule-libelle">Libellé</Label>
            <Input id="formule-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="formule-prix">Prix (FCFA)</Label>
              <Input id="formule-prix" type="number" min={0} value={prix} onChange={(e) => setPrix(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="formule-rang">Rang</Label>
              <Input id="formule-rang" type="number" min={1} value={rang} onChange={(e) => setRang(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="formule-mode-duree">Mode de calcul de validité</Label>
              <Select value={modeDuree} onValueChange={(v) => setModeDuree(v as "STRICT_30J" | "MOIS_CIVIL")}>
                <SelectTrigger id="formule-mode-duree" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STRICT_30J">{LIBELLES_MODE_DUREE.STRICT_30J}</SelectItem>
                  <SelectItem value="MOIS_CIVIL">{LIBELLES_MODE_DUREE.MOIS_CIVIL}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="formule-duree-cycles">Durée (cycles)</Label>
              <Input id="formule-duree-cycles" type="number" min={1} value={dureeCycles} onChange={(e) => setDureeCycles(e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pretAValider || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : edition ? "Enregistrer" : "Créer la formule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
