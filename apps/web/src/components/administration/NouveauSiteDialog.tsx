import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { creerSiteRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Props {
  ouvert: boolean;
  onFerme: () => void;
  onSucces: () => void;
}

// 8.7 : création d'un site rattaché à l'entreprise (2.5.2, multi-site
// centralisé — un seul fichier SQLite, chaque enregistrement porte un site_id).
export function NouveauSiteDialog({ ouvert, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");
  const [enCours, setEnCours] = useState(false);

  function reinitialiser() {
    setNom("");
    setAdresse("");
  }

  async function valider() {
    if (!nom.trim()) return;
    setEnCours(true);
    try {
      await creerSiteRequete(token, { nom: nom.trim(), adresse: adresse.trim() || undefined });
      toast.success(`Site « ${nom.trim()} » créé.`);
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la création du site.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau site</DialogTitle>
          <DialogDescription>Rattaché à votre entreprise.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="site-nom">Nom</Label>
            <Input id="site-nom" value={nom} onChange={(e) => setNom(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="site-adresse">Adresse</Label>
            <Input id="site-adresse" value={adresse} onChange={(e) => setAdresse(e.target.value)} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!nom.trim() || enCours} onClick={valider}>
            {enCours ? "Création…" : "Créer le site"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
