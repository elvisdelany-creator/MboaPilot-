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
import { modifierAbonneRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Abonne } from "@/lib/types";

interface Props {
  abonne: Abonne | null;
  onFerme: () => void;
  onSucces: () => void;
}

// 8.1 : modification de fiche abonné — l'apporteur d'affaires n'est jamais
// modifiable ici, permanent une fois renseigné à la création (6.3)
export function ModifierAbonneDialog({ abonne, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [numeroCni, setNumeroCni] = useState("");
  const [adresse, setAdresse] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!abonne) return;
    setNom(abonne.nom);
    setPrenom(abonne.prenom);
    setTelephone(abonne.telephone);
    setEmail(abonne.email ?? "");
    setNumeroCni(abonne.numeroCni ?? "");
    setAdresse(abonne.adresse ?? "");
  }, [abonne]);

  async function valider() {
    if (!abonne) return;
    setEnCours(true);
    try {
      await modifierAbonneRequete(token, abonne.idAbonne, {
        nom,
        prenom,
        telephone,
        email: email || undefined,
        numeroCni: numeroCni || undefined,
        adresse: adresse || undefined,
      });
      toast.success("Fiche abonné mise à jour.");
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la mise à jour de la fiche.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={abonne !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la fiche abonné</DialogTitle>
          <DialogDescription>Coordonnées de {abonne?.prenom} {abonne?.nom} — n° {abonne?.idAbonne}.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="modif-nom">Nom</Label>
            <Input id="modif-nom" value={nom} onChange={(e) => setNom(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="modif-prenom">Prénom</Label>
            <Input id="modif-prenom" value={prenom} onChange={(e) => setPrenom(e.target.value)} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label htmlFor="modif-telephone">Téléphone</Label>
            <Input id="modif-telephone" value={telephone} onChange={(e) => setTelephone(e.target.value)} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label htmlFor="modif-email">E-mail</Label>
            <Input id="modif-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="modif-cni">Numéro CNI</Label>
            <Input id="modif-cni" value={numeroCni} onChange={(e) => setNumeroCni(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="modif-adresse">Adresse</Label>
            <Input id="modif-adresse" value={adresse} onChange={(e) => setAdresse(e.target.value)} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!nom.trim() || !prenom.trim() || !telephone.trim() || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
