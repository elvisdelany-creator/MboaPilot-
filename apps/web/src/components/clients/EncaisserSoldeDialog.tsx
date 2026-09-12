import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { encaisserSoldeFactureRequete, ErreurAuthentification, type ModePaiementEncaissement } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Facture } from "@/lib/types";

interface Props {
  facture: Facture | null;
  solde: number;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 6.4 point 5, 9.4 : "un solde restant dû... peut faire l'objet
// d'encaissements complémentaires ultérieurs" — même geste d'encaissement
// que pour une vente, mais sur une facture déjà créée.
export function EncaisserSoldeDialog({ facture, solde, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [montant, setMontant] = useState(solde);
  const [modePaiement, setModePaiement] = useState<ModePaiementEncaissement>("CASH");
  const [banque, setBanque] = useState("");
  const [numeroCheque, setNumeroCheque] = useState("");
  const [titulaireCheque, setTitulaireCheque] = useState("");
  const [dateCheque, setDateCheque] = useState("");
  const [referenceVirement, setReferenceVirement] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    setMontant(solde);
    setModePaiement("CASH");
    setBanque("");
    setNumeroCheque("");
    setTitulaireCheque("");
    setDateCheque("");
    setReferenceVirement("");
  }, [facture, solde]);

  async function valider() {
    if (!facture || montant <= 0) return;
    setEnCours(true);
    try {
      const resultat = await encaisserSoldeFactureRequete(token, facture.idFacture, {
        userId: utilisateur.idUser,
        montant,
        modePaiement,
        banque: modePaiement === "CHEQUE" || modePaiement === "VIREMENT" ? banque : undefined,
        numeroCheque: modePaiement === "CHEQUE" ? numeroCheque : undefined,
        titulaireCheque: modePaiement === "CHEQUE" ? titulaireCheque : undefined,
        dateCheque: modePaiement === "CHEQUE" ? dateCheque : undefined,
        referenceVirement: modePaiement === "VIREMENT" ? referenceVirement : undefined,
      });
      toast.success(
        resultat.soldeRestant > 0
          ? `${formateurFcfa.format(resultat.montantEncaisse)} FCFA encaissés — solde restant de ${formateurFcfa.format(resultat.soldeRestant)} FCFA.`
          : `${formateurFcfa.format(resultat.montantEncaisse)} FCFA encaissés — facture soldée.`
      );
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'encaissement.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={facture !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encaisser le solde</DialogTitle>
          <DialogDescription>
            Facture n° {facture?.idFacture} — solde dû : {formateurFcfa.format(solde)} FCFA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="solde-mode-paiement">Mode de paiement</Label>
            <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as ModePaiementEncaissement)}>
              <SelectTrigger id="solde-mode-paiement" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Comptant (cash)</SelectItem>
                <SelectItem value="CHEQUE">Chèque</SelectItem>
                <SelectItem value="VIREMENT">Virement bancaire</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="solde-montant">Montant encaissé</Label>
            <Input
              id="solde-montant"
              type="number"
              min={0}
              value={montant}
              onChange={(e) => setMontant(Number(e.target.value))}
              className="mt-1 h-11 text-base tabular-nums"
            />
            {montant > 0 && montant < solde && (
              <p className="mt-1 text-sm text-alert-j3-fg">
                Encaissement partiel — solde de {formateurFcfa.format(solde - montant)} FCFA restant dû après cette opération.
              </p>
            )}
            {/* 8.5, 9.2 : "calcul automatique des totaux et de la monnaie rendue" */}
            {modePaiement === "CASH" && montant > solde && (
              <p className="mt-1 text-sm text-muted-foreground">
                Monnaie à rendre : <span className="font-medium text-card-foreground">{formateurFcfa.format(montant - solde)} FCFA</span>
              </p>
            )}
          </div>

          {/* 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date" */}
          {modePaiement === "CHEQUE" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="solde-cheque-banque">Banque</Label>
                <Input id="solde-cheque-banque" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="solde-cheque-numero">Numéro de chèque</Label>
                <Input id="solde-cheque-numero" value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="solde-cheque-titulaire">Titulaire</Label>
                <Input id="solde-cheque-titulaire" value={titulaireCheque} onChange={(e) => setTitulaireCheque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="solde-cheque-date">Date</Label>
                <Input id="solde-cheque-date" type="date" value={dateCheque} onChange={(e) => setDateCheque(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}

          {/* 6.5 : "Virement bancaire — Banque émettrice, référence de virement" */}
          {modePaiement === "VIREMENT" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="solde-virement-banque">Banque émettrice</Label>
                <Input id="solde-virement-banque" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="solde-virement-reference">Référence de virement</Label>
                <Input id="solde-virement-reference" value={referenceVirement} onChange={(e) => setReferenceVirement(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button
            className="cursor-pointer gap-2"
            disabled={
              enCours ||
              montant <= 0 ||
              (modePaiement === "CHEQUE" && !(banque.trim() && numeroCheque.trim() && titulaireCheque.trim() && dateCheque)) ||
              (modePaiement === "VIREMENT" && !(banque.trim() && referenceVirement.trim()))
            }
            onClick={valider}
          >
            <Wallet className="size-4" />
            {enCours ? "Encaissement…" : "Encaisser"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
