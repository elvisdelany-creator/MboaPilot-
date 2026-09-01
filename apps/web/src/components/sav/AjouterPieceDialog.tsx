import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { affecterPieceSavRequete, chargerProduits, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Produit } from "@/lib/types";

interface Props {
  ouvert: boolean;
  idDossierSav: number;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 5.10 : affectation d'une pièce de rechange au dossier (décrémente le stock)
export function AjouterPieceDialog({ ouvert, idDossierSav, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [produits, setProduits] = useState<Produit[]>([]);
  const [idProduit, setIdProduit] = useState("");
  const [quantite, setQuantite] = useState(1);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    chargerProduits(token, utilisateur.siteId)
      .then((data) => {
        setProduits(data);
        setIdProduit((v) => v || String(data[0]?.idProduit ?? ""));
      })
      .catch(() => toast.error("Impossible de charger le catalogue de pièces."));
  }, [ouvert, token, utilisateur.siteId]);

  async function valider() {
    if (!idProduit) return;
    setEnCours(true);
    try {
      await affecterPieceSavRequete(token, idDossierSav, { idProduit: Number(idProduit), quantite, userId: utilisateur.idUser });
      toast.success("Pièce affectée au dossier.");
      setQuantite(1);
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'affectation de la pièce.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une pièce</DialogTitle>
          <DialogDescription>La quantité affectée est décomptée du stock du site.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="piece-produit">Pièce</Label>
            <Select value={idProduit} onValueChange={setIdProduit}>
              <SelectTrigger id="piece-produit" className="mt-1 w-full">
                <SelectValue placeholder="Choisir une pièce" />
              </SelectTrigger>
              <SelectContent>
                {produits.map((p) => (
                  <SelectItem key={p.idProduit} value={String(p.idProduit)}>
                    {p.libelle} — {formateurFcfa.format(p.prixVente)} FCFA
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="piece-quantite">Quantité</Label>
            <Input
              id="piece-quantite"
              type="number"
              min={1}
              value={quantite}
              onChange={(e) => setQuantite(Number(e.target.value))}
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!idProduit || enCours} onClick={valider}>
            {enCours ? "Ajout…" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
