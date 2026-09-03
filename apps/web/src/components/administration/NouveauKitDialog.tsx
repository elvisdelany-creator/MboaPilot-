import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { creerKitRequete, modifierKitRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Formule, KitBrut } from "@/lib/types";

interface Props {
  ouvert: boolean;
  idFamille: number | null;
  formulesFamille: Formule[];
  kit: KitBrut | null; // non-null = édition, null = création
  onFerme: () => void;
  onSucces: () => void;
}

type ReglePrix = "PRIX_FIXE" | "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" | "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";

const LIBELLES_REGLE: Record<ReglePrix, string> = {
  PRIX_FIXE: "Prix fixe",
  PRIX_DECODEUR_VARIABLE_SELON_FORMULE: "Décodeur variable selon la formule",
  PRIX_KIT_FIXE_PAR_DIFFERENTIEL: "Fixe par différentiel de formule",
};

// 5.1.1, 8.8 : création/édition d'un kit — les champs pertinents dépendent de
// la règle de prix choisie ; la grille « prix décodeur par formule » (pour
// PRIX_DECODEUR_VARIABLE_SELON_FORMULE) s'édite séparément une fois le kit créé.
export function NouveauKitDialog({ ouvert, idFamille, formulesFamille, kit, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const edition = kit !== null;

  const [libelle, setLibelle] = useState("");
  const [reglePrix, setReglePrix] = useState<ReglePrix>("PRIX_FIXE");
  const [prixFixe, setPrixFixe] = useState("");
  const [prixParaboleAccessoires, setPrixParaboleAccessoires] = useState("0");
  const [idFormuleReference, setIdFormuleReference] = useState("");
  const [prixKitReference, setPrixKitReference] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setLibelle(kit?.libelle ?? "");
    setReglePrix(kit?.reglePrix ?? "PRIX_FIXE");
    setPrixFixe(kit?.prixFixe !== undefined && kit?.prixFixe !== null ? String(kit.prixFixe) : "");
    setPrixParaboleAccessoires(kit ? String(kit.prixParaboleAccessoires) : "0");
    setIdFormuleReference(kit?.idFormuleReference ? String(kit.idFormuleReference) : "");
    setPrixKitReference(kit?.prixKitReference !== undefined && kit?.prixKitReference !== null ? String(kit.prixKitReference) : "");
  }, [ouvert, kit]);

  const pretAValider =
    libelle.trim() &&
    (reglePrix === "PRIX_FIXE"
      ? prixFixe !== ""
      : reglePrix === "PRIX_KIT_FIXE_PAR_DIFFERENTIEL"
        ? idFormuleReference && prixKitReference !== ""
        : true);

  async function valider() {
    if (!pretAValider || (!edition && !idFamille)) return;
    setEnCours(true);
    try {
      const champs = {
        libelle: libelle.trim(),
        reglePrix,
        prixFixe: reglePrix === "PRIX_FIXE" ? Number(prixFixe) : undefined,
        prixParaboleAccessoires: reglePrix === "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" ? Number(prixParaboleAccessoires) : undefined,
        idFormuleReference: reglePrix === "PRIX_KIT_FIXE_PAR_DIFFERENTIEL" ? Number(idFormuleReference) : undefined,
        prixKitReference: reglePrix === "PRIX_KIT_FIXE_PAR_DIFFERENTIEL" ? Number(prixKitReference) : undefined,
      };
      if (edition && kit) {
        await modifierKitRequete(token, kit.idKit, champs);
        toast.success(`Kit « ${libelle.trim()} » modifié.`);
      } else {
        await creerKitRequete(token, { idFamille: idFamille!, ...champs });
        toast.success(`Kit « ${libelle.trim()} » créé.`);
      }
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'enregistrement du kit.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{edition ? "Modifier le kit" : "Nouveau kit"}</DialogTitle>
          <DialogDescription>Produit composé nécessaire au premier équipement (décodeur, parabole, accessoires — 5.1.1).</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="kit-libelle">Libellé</Label>
            <Input id="kit-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="KIT CANAL+ GLOBALZ" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="kit-regle">Règle de prix</Label>
            <Select value={reglePrix} onValueChange={(v) => setReglePrix(v as ReglePrix)} disabled={edition}>
              <SelectTrigger id="kit-regle" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LIBELLES_REGLE) as ReglePrix[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {LIBELLES_REGLE[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {reglePrix === "PRIX_FIXE" && (
            <div>
              <Label htmlFor="kit-prix-fixe">Prix fixe (FCFA)</Label>
              <Input id="kit-prix-fixe" type="number" min={0} value={prixFixe} onChange={(e) => setPrixFixe(e.target.value)} className="mt-1" />
            </div>
          )}

          {reglePrix === "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" && (
            <div>
              <Label htmlFor="kit-parabole">Partie fixe — parabole/accessoires (FCFA)</Label>
              <Input
                id="kit-parabole"
                type="number"
                min={0}
                value={prixParaboleAccessoires}
                onChange={(e) => setPrixParaboleAccessoires(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Le prix du décodeur, variable selon la formule choisie, s'édite ensuite depuis la fiche du kit.
              </p>
            </div>
          )}

          {reglePrix === "PRIX_KIT_FIXE_PAR_DIFFERENTIEL" && (
            <>
              <div>
                <Label htmlFor="kit-formule-reference">Formule de référence</Label>
                <Select value={idFormuleReference} onValueChange={setIdFormuleReference}>
                  <SelectTrigger id="kit-formule-reference" className="mt-1 w-full">
                    <SelectValue placeholder="Choisir une formule" />
                  </SelectTrigger>
                  <SelectContent>
                    {formulesFamille.map((f) => (
                      <SelectItem key={f.idFormule} value={String(f.idFormule)}>
                        {f.libelle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="kit-prix-reference">Prix du kit à cette formule (FCFA)</Label>
                <Input
                  id="kit-prix-reference"
                  type="number"
                  min={0}
                  value={prixKitReference}
                  onChange={(e) => setPrixKitReference(e.target.value)}
                  className="mt-1"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pretAValider || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : edition ? "Enregistrer" : "Créer le kit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
