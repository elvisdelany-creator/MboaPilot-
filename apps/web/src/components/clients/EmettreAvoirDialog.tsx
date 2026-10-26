import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ReceiptText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chargerLignesFacture, emettreAvoirRequete, ErreurAuthentification, type LigneFacture } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Facture } from "@/lib/types";

interface Props {
  facture: Facture | null;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

type ModeRemboursement = "AUCUN" | "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
const LIBELLES_REMBOURSEMENT: Record<ModeRemboursement, string> = {
  AUCUN: "Pas de remboursement maintenant",
  CASH: "Rembourser en espèces",
  MOBILE_MONEY: "Rembourser par Mobile Money",
  CHEQUE: "Rembourser par chèque",
  VIREMENT: "Rembourser par virement",
};

// 6.4, 💡 Conseil d'architecte : une facture VALIDEE ne se corrige jamais
// directement — l'avoir crédite tout ou partie de ses lignes (facture de
// montant négatif, tracée). La restitution au stock est optionnelle : une
// simple correction tarifaire ne doit pas réintégrer un article détérioré ou
// déjà revendu.
export function EmettreAvoirDialog({ facture, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [lignes, setLignes] = useState<LigneFacture[]>([]);
  const [selection, setSelection] = useState<Record<number, number>>({}); // idLigne -> quantité à créditer
  const [restituerStock, setRestituerStock] = useState(false);
  const [remboursement, setRemboursement] = useState<ModeRemboursement>("AUCUN");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!facture) {
      setLignes([]);
      setSelection({});
      setRestituerStock(false);
      setRemboursement("AUCUN");
      return;
    }
    chargerLignesFacture(token, facture.idFacture)
      .then(setLignes)
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Impossible de charger les lignes de la facture.");
        setLignes([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facture, token]);

  function basculerLigne(ligne: LigneFacture, coche: boolean) {
    setSelection((s) => {
      const copie = { ...s };
      if (coche) copie[ligne.idLigne] = ligne.quantiteDisponible;
      else delete copie[ligne.idLigne];
      return copie;
    });
  }

  const lignesSelectionnees = Object.entries(selection).filter(([, q]) => q > 0);
  const total = lignesSelectionnees.reduce((somme, [idLigne, quantite]) => {
    const ligne = lignes.find((l) => l.idLigne === Number(idLigne));
    if (!ligne) return somme;
    const prixUnitaire = ligne.prixApplique / ligne.quantite;
    return somme + prixUnitaire * quantite;
  }, 0);

  async function confirmer() {
    if (!facture || lignesSelectionnees.length === 0) return;
    setEnCours(true);
    try {
      const resultat = await emettreAvoirRequete(token, facture.idFacture, {
        lignes: lignesSelectionnees.map(([idLigneOrigine, quantite]) => ({ idLigneOrigine: Number(idLigneOrigine), quantite })),
        restituerStock,
        userId: utilisateur.idUser,
        ...(remboursement !== "AUCUN" && { remboursement: { mode: remboursement } }),
      });
      toast.success(
        resultat.montantRembourse > 0
          ? `Avoir émis : ${formateurFcfa.format(resultat.montantTotal)} FCFA, dont ${formateurFcfa.format(resultat.montantRembourse)} FCFA remboursés.`
          : `Avoir émis : ${formateurFcfa.format(resultat.montantTotal)} FCFA.`
      );
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'émission de l'avoir.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={facture !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Émettre un avoir</DialogTitle>
          <DialogDescription>
            Facture n° {facture?.idFacture} — sélectionnez les lignes et quantités à créditer (6.4). Cette action est irréversible.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3">
          {lignes.map((ligne) => {
            const coche = ligne.idLigne in selection;
            return (
              <li key={ligne.idLigne} className="flex items-center gap-3">
                <Checkbox
                  id={`avoir-ligne-${ligne.idLigne}`}
                  checked={coche}
                  disabled={ligne.quantiteDisponible <= 0}
                  onCheckedChange={(v) => basculerLigne(ligne, v === true)}
                />
                <Label htmlFor={`avoir-ligne-${ligne.idLigne}`} className="flex-1 font-normal text-card-foreground">
                  {ligne.libelleProduit ?? ligne.libelleKit ?? "Abonnement"}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({ligne.quantite} × {formateurFcfa.format(Math.round(ligne.prixApplique / ligne.quantite))} FCFA)
                  </span>
                  {ligne.quantiteDisponible < ligne.quantite && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      — {ligne.quantiteDisponible > 0 ? `${ligne.quantiteDisponible} encore à créditer` : "déjà intégralement crédité"}
                    </span>
                  )}
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={ligne.quantiteDisponible}
                  aria-label={`Quantité à créditer — ${ligne.libelleProduit ?? ligne.libelleKit ?? "Abonnement"}`}
                  disabled={!coche}
                  value={selection[ligne.idLigne] ?? ligne.quantiteDisponible}
                  onChange={(e) =>
                    setSelection((s) => ({ ...s, [ligne.idLigne]: Math.max(1, Math.min(Number(e.target.value), ligne.quantiteDisponible)) }))
                  }
                  className="h-9 w-20 tabular-nums"
                />
              </li>
            );
          })}
          {lignes.length === 0 && <p className="text-sm text-muted-foreground">Chargement des lignes…</p>}
        </ul>

        <div className="flex items-center gap-2">
          <Checkbox id="avoir-restituer-stock" checked={restituerStock} onCheckedChange={(v) => setRestituerStock(v === true)} />
          <Label htmlFor="avoir-restituer-stock" className="font-normal text-card-foreground">
            Restituer les articles au stock
          </Label>
        </div>

        <div>
          <Label htmlFor="avoir-remboursement">Remboursement du client</Label>
          <Select value={remboursement} onValueChange={(v) => setRemboursement(v as ModeRemboursement)}>
            <SelectTrigger id="avoir-remboursement" className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LIBELLES_REMBOURSEMENT) as ModeRemboursement[]).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {LIBELLES_REMBOURSEMENT[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            Un remboursement s'enregistre avec l'avoir et se déduit de la caisse du jour. Sans remboursement, la facture reste à rembourser.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3 text-sm font-semibold">
          <span>Montant de l'avoir</span>
          <span className="tabular-nums text-destructive">-{formateurFcfa.format(total)} FCFA</span>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button variant="destructive" className="cursor-pointer gap-2" disabled={enCours || lignesSelectionnees.length === 0} onClick={confirmer}>
            <ReceiptText className="size-4" />
            {enCours ? "Émission…" : "Émettre l'avoir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
