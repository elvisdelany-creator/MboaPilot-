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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chargerProduits, echangerMaterielRequete, ErreurAuthentification, type ModePaiementEncaissement } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Produit } from "@/lib/types";

interface Props {
  numeroAbonnement: number | null;
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 7.3 : remplacement du matériel d'un abonné (panne/vol), facturation
// distinguant garantie (gratuit) et hors garantie (tarif plein).
export function EchangeMaterielDialog({ numeroAbonnement, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [produits, setProduits] = useState<Produit[]>([]);
  const [idProduit, setIdProduit] = useState<string>("");
  const [numeroSerie, setNumeroSerie] = useState("");
  const [motif, setMotif] = useState<"panne" | "vol">("panne");
  const [sousGarantie, setSousGarantie] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const ouvert = numeroAbonnement !== null;

  useEffect(() => {
    if (!ouvert) return;
    chargerProduits(token, utilisateur.siteId)
      .then((data) => {
        setProduits(data);
        setIdProduit((v) => v || String(data[0]?.idProduit ?? ""));
      })
      .catch(() => toast.error("Impossible de charger le catalogue de matériel."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, token, utilisateur.siteId]);

  const produitSelectionne = produits.find((p) => p.idProduit === Number(idProduit));
  const montantFacture = sousGarantie ? 0 : (produitSelectionne?.prixVente ?? 0);

  const [montantEncaisse, setMontantEncaisse] = useState(montantFacture);
  useEffect(() => setMontantEncaisse(montantFacture), [montantFacture]);

  // 6.5 : moyen de paiement de l'encaissement
  const [modePaiement, setModePaiement] = useState<ModePaiementEncaissement>("CASH");
  const [banque, setBanque] = useState("");
  const [numeroCheque, setNumeroCheque] = useState("");
  const [titulaireCheque, setTitulaireCheque] = useState("");
  const [dateCheque, setDateCheque] = useState("");
  const [referenceVirement, setReferenceVirement] = useState("");

  function reinitialiser() {
    setIdProduit("");
    setNumeroSerie("");
    setMotif("panne");
    setSousGarantie(false);
    setModePaiement("CASH");
    setBanque("");
    setNumeroCheque("");
    setTitulaireCheque("");
    setDateCheque("");
    setReferenceVirement("");
  }

  async function valider() {
    if (!numeroAbonnement || !idProduit) return;
    setEnCours(true);
    try {
      const resultat = await echangerMaterielRequete(token, numeroAbonnement, {
        siteId: utilisateur.siteId,
        userId: utilisateur.idUser,
        idProduit: Number(idProduit),
        typeMateriel: "DECODEUR",
        numeroSerie: numeroSerie || undefined,
        sousGarantie,
        motif,
        montantEncaisse,
        modePaiement,
        banque: modePaiement === "CHEQUE" || modePaiement === "VIREMENT" ? banque : undefined,
        numeroCheque: modePaiement === "CHEQUE" ? numeroCheque : undefined,
        titulaireCheque: modePaiement === "CHEQUE" ? titulaireCheque : undefined,
        dateCheque: modePaiement === "CHEQUE" ? dateCheque : undefined,
        referenceVirement: modePaiement === "VIREMENT" ? referenceVirement : undefined,
      });
      toast.success(
        resultat.statutFacture === "VALIDEE"
          ? `Matériel échangé — ${formateurFcfa.format(resultat.montantFacture)} FCFA facturés.`
          : `Matériel échangé — facture en attente d'encaissement.`
      );
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'échange de matériel.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Échanger le matériel</DialogTitle>
          <DialogDescription>Panne ou vol constaté — sélectionnez le matériel de remplacement.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="produit-remplacement">Matériel de remplacement</Label>
            <Select value={idProduit} onValueChange={setIdProduit}>
              <SelectTrigger id="produit-remplacement" className="mt-1 w-full">
                <SelectValue placeholder="Choisir un matériel" />
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
            <Label htmlFor="numero-serie">Numéro de série (optionnel)</Label>
            <Input id="numero-serie" value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label htmlFor="motif-echange">Motif</Label>
            <Select value={motif} onValueChange={(v) => setMotif(v as "panne" | "vol")}>
              <SelectTrigger id="motif-echange" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="panne">Panne</SelectItem>
                <SelectItem value="vol">Vol</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={sousGarantie} onCheckedChange={(v) => setSousGarantie(v === true)} />
            Sous garantie (remplacement gratuit)
          </label>

          <div className="flex items-center justify-between text-sm font-medium">
            <span>Montant à facturer</span>
            <span className="tabular-nums text-primary">{formateurFcfa.format(montantFacture)} FCFA</span>
          </div>

          {montantFacture > 0 && (
            <div>
              <Label htmlFor="mode-paiement-echange">Mode de paiement</Label>
              <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as ModePaiementEncaissement)}>
                <SelectTrigger id="mode-paiement-echange" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Comptant (cash)</SelectItem>
                  <SelectItem value="CHEQUE">Chèque</SelectItem>
                  <SelectItem value="VIREMENT">Virement bancaire</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="montant-encaisse-echange">Montant encaissé</Label>
            <Input
              id="montant-encaisse-echange"
              type="number"
              min={0}
              disabled={montantFacture === 0}
              value={montantEncaisse}
              onChange={(e) => setMontantEncaisse(Number(e.target.value))}
              className="mt-1 h-11 text-base tabular-nums"
            />
            {montantFacture === 0 && <p className="mt-1 text-sm text-muted-foreground">Rien à encaisser sous garantie.</p>}
            {montantFacture > 0 && montantEncaisse > 0 && montantEncaisse < montantFacture && (
              <p className="mt-1 text-sm text-alert-j3-fg">
                Encaissement partiel — solde de {formateurFcfa.format(montantFacture - montantEncaisse)} FCFA restant dû.
              </p>
            )}
          </div>

          {/* 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date" */}
          {montantFacture > 0 && modePaiement === "CHEQUE" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="cheque-banque-echange">Banque</Label>
                <Input id="cheque-banque-echange" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="cheque-numero-echange">Numéro de chèque</Label>
                <Input id="cheque-numero-echange" value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="cheque-titulaire-echange">Titulaire</Label>
                <Input id="cheque-titulaire-echange" value={titulaireCheque} onChange={(e) => setTitulaireCheque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="cheque-date-echange">Date</Label>
                <Input id="cheque-date-echange" type="date" value={dateCheque} onChange={(e) => setDateCheque(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}

          {/* 6.5 : "Virement bancaire — Banque émettrice, référence de virement" */}
          {montantFacture > 0 && modePaiement === "VIREMENT" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="virement-banque-echange">Banque émettrice</Label>
                <Input id="virement-banque-echange" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="virement-reference-echange">Référence de virement</Label>
                <Input
                  id="virement-reference-echange"
                  value={referenceVirement}
                  onChange={(e) => setReferenceVirement(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button
            className="cursor-pointer"
            disabled={
              !idProduit ||
              enCours ||
              (montantFacture > 0 &&
                ((modePaiement === "CHEQUE" && !(banque.trim() && numeroCheque.trim() && titulaireCheque.trim() && dateCheque)) ||
                  (modePaiement === "VIREMENT" && !(banque.trim() && referenceVirement.trim()))))
            }
            onClick={valider}
          >
            {enCours ? "Échange…" : "Confirmer l'échange"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
