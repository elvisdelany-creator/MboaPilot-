import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { anonymiserAbonneRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Abonne } from "@/lib/types";

interface Props {
  abonne: Abonne | null;
  onFerme: () => void;
  onSucces: () => void;
}

// 11.3 : droit de suppression — efface l'identité et les coordonnées de la
// fiche (nom, prénom, téléphone, email, CNI, adresse), en conservant
// l'historique transactionnel (factures, abonnements) par obligation
// comptable/légale de conservation. Opération irréversible, journalisée
// (11.5), réservée à l'Administrateur.
//
// ⚠️ Outil technique uniquement : le cahier des charges précise lui-même que
// ce chapitre n'est pas un avis juridique. La conformité réelle (durée de
// conservation, base légale du traitement, portée exacte de l'effacement)
// doit être validée par un conseil juridique local avant tout usage en
// production.
export function AnonymiserAbonneDialog({ abonne, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [enCours, setEnCours] = useState(false);

  async function confirmer() {
    if (!abonne) return;
    setEnCours(true);
    try {
      await anonymiserAbonneRequete(token, abonne.idAbonne, utilisateur.idUser);
      toast.success(`Fiche « ${abonne.prenom} ${abonne.nom} » anonymisée.`);
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'anonymisation.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={abonne !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anonymiser cette fiche</DialogTitle>
          <DialogDescription>
            Droit de suppression (11.3) — efface l'identité et les coordonnées de « {abonne?.prenom} {abonne?.nom} ». L'historique des
            abonnements et factures est conservé.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-card-foreground">
              Le nom, prénom, téléphone, email, numéro de CNI et adresse seront <strong>définitivement remplacés</strong>. Les
              abonnements, factures et dossiers SAV restent rattachés à la fiche. Cette action est irréversible.
            </p>
          </div>
          <div className="flex items-start gap-2 border-t border-destructive/20 pt-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              Outil technique uniquement — ne constitue pas une garantie de conformité. La durée de conservation légale et la base
              juridique de ce traitement doivent être validées par un conseil juridique local avant tout usage réel (11.3).
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={enCours} onClick={confirmer}>
            {enCours ? "Anonymisation…" : "Confirmer l'anonymisation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
