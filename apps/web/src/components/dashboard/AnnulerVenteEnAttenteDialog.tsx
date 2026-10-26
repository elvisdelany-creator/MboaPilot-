import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { annulerVenteEnAttenteRequete, ErreurAuthentification, type TypeVenteEnAttente, type VenteEnAttente } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Props {
  vente: VenteEnAttente | null;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// ce que l'annulation défait, selon la nature de la vente jamais encaissée
export const LIBELLE_ANNULATION: Record<TypeVenteEnAttente, { bouton: string; titre: string; effet: (v: VenteEnAttente) => string; resultat: (v: VenteEnAttente) => string }> = {
  PRODUITS: {
    bouton: "Annuler la vente",
    titre: "Annuler cette vente",
    effet: () => "Aucun encaissement n'a été enregistré sur cette vente. Elle sera supprimée et ses articles remis en stock.",
    resultat: (v) => `Vente annulée — facture n° ${v.idFacture}, stock restitué.`,
  },
  ABONNEMENT: {
    bouton: "Annuler le recrutement",
    titre: "Annuler ce recrutement",
    effet: (v) => `Aucun encaissement n'a été enregistré. La facture et l'abonnement n° ${v.numeroAbonnement} seront supprimés, la commission en attente aussi, et le matériel du kit remis en stock. Le client est conservé.`,
    resultat: (v) => `Recrutement annulé — facture n° ${v.idFacture}, abonnement n° ${v.numeroAbonnement} supprimé.`,
  },
  REABONNEMENT: {
    bouton: "Annuler le réabonnement",
    titre: "Annuler ce réabonnement",
    effet: (v) => `Aucun encaissement n'a été enregistré. La facture sera supprimée et l'abonnement n° ${v.numeroAbonnement} retrouvera sa date de fin et sa formule d'avant.`,
    resultat: (v) => `Réabonnement annulé — facture n° ${v.idFacture}, abonnement n° ${v.numeroAbonnement} rétabli.`,
  },
  CHANGEMENT_FORMULE: {
    bouton: "Annuler le changement",
    titre: "Annuler ce changement de formule",
    effet: (v) => `Aucun encaissement n'a été enregistré. La facture sera supprimée et l'abonnement n° ${v.numeroAbonnement} retrouvera sa formule d'avant.`,
    resultat: (v) => `Changement annulé — facture n° ${v.idFacture}, formule de l'abonnement n° ${v.numeroAbonnement} rétablie.`,
  },
  ECHANGE_MATERIEL: {
    bouton: "Annuler l'échange",
    titre: "Annuler cet échange de matériel",
    effet: (v) => `Aucun encaissement n'a été enregistré. La facture sera supprimée, l'ancien matériel de l'abonnement n° ${v.numeroAbonnement} redeviendra actif et le matériel de remplacement retournera en stock.`,
    resultat: (v) => `Échange annulé — facture n° ${v.idFacture}, ancien matériel rétabli.`,
  },
};

// 9.1, 11.5 : aucune suppression de vente sans confirmation ni traçabilité. L'annulation d'une vente jamais encaissée remet
// ses articles en stock ; une vente déjà encaissée se corrige par un avoir.
export function AnnulerVenteEnAttenteDialog({ vente, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const [enCours, setEnCours] = useState(false);

  async function confirmer() {
    if (!vente) return;
    setEnCours(true);
    try {
      await annulerVenteEnAttenteRequete(token, vente.idFacture);
      toast.success(LIBELLE_ANNULATION[vente.type].resultat(vente));
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'annulation de la vente.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={vente !== null} onOpenChange={(v) => !v && !enCours && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{vente ? LIBELLE_ANNULATION[vente.type].titre : "Annuler cette vente"}</DialogTitle>
          <DialogDescription>
            {vente && `Facture n° ${vente.idFacture} — ${formateurFcfa.format(vente.montantTotal)} FCFA — ${vente.client ?? "sans client"}`}
          </DialogDescription>
        </DialogHeader>

        {vente && (
          <ul className="space-y-1 text-sm text-card-foreground">
            {vente.lignes.map((l) => (
              <li key={l.libelle}>
                {l.quantite} × {l.libelle}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-card-foreground">
            {vente ? `${LIBELLE_ANNULATION[vente.type].effet(vente)} Cette action est journalisée et irréversible.` : ""}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" disabled={enCours} onClick={onFerme}>
            Retour
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={enCours} onClick={confirmer}>
            {enCours ? "Annulation…" : "Confirmer l'annulation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
