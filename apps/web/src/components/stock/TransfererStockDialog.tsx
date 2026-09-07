import { useEffect, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chargerSites, transfererStockRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Produit, Site } from "@/lib/types";

interface Props {
  produit: Produit | null;
  onFerme: () => void;
  onSucces: () => void;
}

// 5.2, 8.2 : transfert inter-site — mouvement double, l'article est créé au
// site destination (même fiche : prix, coût, marge) s'il n'y existe pas encore.
export function TransfererStockDialog({ produit, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [sites, setSites] = useState<Site[]>([]);
  const [siteDestinationId, setSiteDestinationId] = useState<string>("");
  const [quantite, setQuantite] = useState("");
  const [motif, setMotif] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!produit) return;
    chargerSites(token)
      .then((data) => setSites(data.filter((s) => s.idSite !== utilisateur.siteId && s.actif === 1)))
      .catch(() => setSites([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produit, token]);

  function reinitialiser() {
    setSiteDestinationId("");
    setQuantite("");
    setMotif("");
  }

  async function valider() {
    if (!produit || !siteDestinationId || !quantite) return;
    setEnCours(true);
    try {
      const nomSiteDestination = sites.find((s) => s.idSite === Number(siteDestinationId))?.nom ?? "";
      await transfererStockRequete(token, {
        idProduitSource: produit.idProduit,
        siteDestinationId: Number(siteDestinationId),
        quantite: Number(quantite),
        motif: motif.trim() || undefined,
        userId: utilisateur.idUser,
      });
      toast.success(`${quantite} unité(s) de « ${produit.libelle} » transférée(s) vers ${nomSiteDestination}.`);
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec du transfert.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={produit !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transférer vers un autre site</DialogTitle>
          <DialogDescription>{produit?.libelle} — mouvement double, tracé sur les deux sites (5.2).</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="transfert-site">Site destination</Label>
            <Select value={siteDestinationId} onValueChange={setSiteDestinationId}>
              <SelectTrigger id="transfert-site" className="mt-1 w-full">
                <SelectValue placeholder="Choisir un site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.idSite} value={String(s.idSite)}>
                    {s.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sites.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Aucun autre site actif.</p>}
          </div>
          <div>
            <Label htmlFor="transfert-quantite">Quantité</Label>
            <Input id="transfert-quantite" type="number" min={1} value={quantite} onChange={(e) => setQuantite(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="transfert-motif">Motif (optionnel)</Label>
            <Input id="transfert-motif" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. réassort boutique" className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!siteDestinationId || !quantite || enCours} onClick={valider}>
            {enCours ? "Transfert…" : "Transférer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
