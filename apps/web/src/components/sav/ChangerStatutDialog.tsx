import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chargerInfosEntreprise, changerStatutSavRequete, ErreurAuthentification, type ModePaiementEncaissement } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DossierSavDetaille, StatutSav } from "@/lib/types";

interface Props {
  dossier: DossierSavDetaille;
  statutCible: StatutSav | null;
  onFerme: () => void;
  onSucces: () => void;
}

const LIBELLES_STATUT: Record<StatutSav, string> = {
  RECU: "Reçu",
  DIAGNOSTIC: "En diagnostic",
  DEVIS_ATTENTE: "Devis en attente",
  REPARATION: "En réparation",
  PRET: "Prêt",
  LIVRE: "Livré",
  IRREPARABLE: "Irréparable",
  ABANDONNE: "Abandonné",
};

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 5.10 : formulaire contextuel — les champs demandés dépendent du statut ciblé
export function ChangerStatutDialog({ dossier, statutCible, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [diagnostic, setDiagnostic] = useState("");
  const [motif, setMotif] = useState("");
  const [montantMainOeuvre, setMontantMainOeuvre] = useState(0);
  const [montantEncaisse, setMontantEncaisse] = useState(0);
  const [enCours, setEnCours] = useState(false);

  // 6.5 : moyen de paiement de l'encaissement, au passage en LIVRE
  const [modePaiement, setModePaiement] = useState<ModePaiementEncaissement>("CASH");
  const [banque, setBanque] = useState("");
  const [numeroCheque, setNumeroCheque] = useState("");
  const [titulaireCheque, setTitulaireCheque] = useState("");
  const [dateCheque, setDateCheque] = useState("");
  const [referenceVirement, setReferenceVirement] = useState("");
  // 5.10, 7.3, 8.8 : "sous garantie (gratuit ou tarif réduit selon la politique)"
  const [tauxGarantie, setTauxGarantie] = useState(0);

  useEffect(() => {
    chargerInfosEntreprise(token)
      .then((infos) => setTauxGarantie(infos.entreprise.tauxGarantiePourcent))
      .catch(() => setTauxGarantie(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (statutCible === "LIVRE") setMontantEncaisse(dossier.facture?.statut === "BROUILLON" ? dossier.facture.montantTotal : 0);
    if (statutCible !== "LIVRE") setMontantEncaisse(0);
    setDiagnostic("");
    setMotif("");
    setMontantMainOeuvre(0);
    setModePaiement("CASH");
    setBanque("");
    setNumeroCheque("");
    setTitulaireCheque("");
    setDateCheque("");
    setReferenceVirement("");
  }, [statutCible, dossier.facture]);

  if (!statutCible) return null;

  const motifRequis = statutCible === "IRREPARABLE" || statutCible === "ABANDONNE";
  const encaissementEnCours = statutCible === "LIVRE" && dossier.facture?.statut === "BROUILLON";
  const pretAValider =
    (!motifRequis || motif.trim().length > 0) &&
    (!encaissementEnCours ||
      modePaiement === "CASH" ||
      (modePaiement === "CHEQUE" && banque.trim() && numeroCheque.trim() && titulaireCheque.trim() && dateCheque) ||
      (modePaiement === "VIREMENT" && banque.trim() && referenceVirement.trim()));

  async function valider() {
    if (!statutCible) return;
    setEnCours(true);
    try {
      const resultat = await changerStatutSavRequete(token, dossier.idDossierSav, {
        nouveauStatut: statutCible,
        userId: utilisateur.idUser,
        diagnostic: diagnostic || undefined,
        motif: motif || undefined,
        montantMainOeuvre: statutCible === "PRET" ? montantMainOeuvre : undefined,
        montantEncaisse: statutCible === "LIVRE" ? montantEncaisse : undefined,
        modePaiement: encaissementEnCours ? modePaiement : undefined,
        banque: encaissementEnCours && (modePaiement === "CHEQUE" || modePaiement === "VIREMENT") ? banque : undefined,
        numeroCheque: encaissementEnCours && modePaiement === "CHEQUE" ? numeroCheque : undefined,
        titulaireCheque: encaissementEnCours && modePaiement === "CHEQUE" ? titulaireCheque : undefined,
        dateCheque: encaissementEnCours && modePaiement === "CHEQUE" ? dateCheque : undefined,
        referenceVirement: encaissementEnCours && modePaiement === "VIREMENT" ? referenceVirement : undefined,
      });
      toast.success(
        statutCible === "PRET"
          ? `Dossier prêt — ${formateurFcfa.format(resultat.montantFacture ?? 0)} FCFA à facturer.`
          : `Dossier passé au statut « ${LIBELLES_STATUT[statutCible]} ».`
      );
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec du changement de statut.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={statutCible !== null} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{LIBELLES_STATUT[statutCible]}</DialogTitle>
          <DialogDescription>Dossier n° {dossier.idDossierSav} — {dossier.descriptionPanne}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {statutCible === "DIAGNOSTIC" && (
            <div>
              <Label htmlFor="statut-diagnostic">Diagnostic</Label>
              <Input id="statut-diagnostic" value={diagnostic} onChange={(e) => setDiagnostic(e.target.value)} className="mt-1" />
            </div>
          )}

          {motifRequis && (
            <div>
              <Label htmlFor="statut-motif">Motif (obligatoire)</Label>
              <Input id="statut-motif" value={motif} onChange={(e) => setMotif(e.target.value)} className="mt-1" required />
            </div>
          )}

          {statutCible === "PRET" && (
            <div>
              <Label htmlFor="statut-main-oeuvre">Main d'œuvre (FCFA)</Label>
              <Input
                id="statut-main-oeuvre"
                type="number"
                min={0}
                value={montantMainOeuvre}
                onChange={(e) => setMontantMainOeuvre(Number(e.target.value))}
                className="mt-1"
              />
              {dossier.sousGarantie === 1 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {tauxGarantie === 0
                    ? "Dossier sous garantie — la facture sera générée à 0 FCFA."
                    : `Dossier sous garantie — tarif réduit à ${tauxGarantie} % du montant plein.`}
                </p>
              )}
            </div>
          )}

          {encaissementEnCours && (
            <>
              <div>
                <Label htmlFor="statut-mode-paiement">Mode de paiement</Label>
                <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as ModePaiementEncaissement)}>
                  <SelectTrigger id="statut-mode-paiement" className="mt-1 w-full">
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
                <Label htmlFor="statut-encaisse">Montant encaissé</Label>
                <Input
                  id="statut-encaisse"
                  type="number"
                  min={0}
                  value={montantEncaisse}
                  onChange={(e) => setMontantEncaisse(Number(e.target.value))}
                  className="mt-1"
                />
                {dossier.facture && montantEncaisse > 0 && montantEncaisse < dossier.facture.montantTotal && (
                  <p className="mt-1 text-sm text-alert-j3-fg">
                    Encaissement partiel — solde de {formateurFcfa.format(dossier.facture.montantTotal - montantEncaisse)} FCFA restant dû.
                  </p>
                )}
                {/* 8.5, 9.2 : "calcul automatique des totaux et de la monnaie rendue" */}
                {modePaiement === "CASH" && dossier.facture && montantEncaisse > dossier.facture.montantTotal && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Monnaie à rendre :{" "}
                    <span className="font-medium text-card-foreground">
                      {formateurFcfa.format(montantEncaisse - dossier.facture.montantTotal)} FCFA
                    </span>
                  </p>
                )}
              </div>

              {/* 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date" */}
              {modePaiement === "CHEQUE" && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="statut-cheque-banque">Banque</Label>
                    <Input id="statut-cheque-banque" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="statut-cheque-numero">Numéro de chèque</Label>
                    <Input id="statut-cheque-numero" value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="statut-cheque-titulaire">Titulaire</Label>
                    <Input
                      id="statut-cheque-titulaire"
                      value={titulaireCheque}
                      onChange={(e) => setTitulaireCheque(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="statut-cheque-date">Date</Label>
                    <Input id="statut-cheque-date" type="date" value={dateCheque} onChange={(e) => setDateCheque(e.target.value)} className="mt-1" />
                  </div>
                </div>
              )}

              {/* 6.5 : "Virement bancaire — Banque émettrice, référence de virement" */}
              {modePaiement === "VIREMENT" && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="statut-virement-banque">Banque émettrice</Label>
                    <Input id="statut-virement-banque" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="statut-virement-reference">Référence de virement</Label>
                    <Input
                      id="statut-virement-reference"
                      value={referenceVirement}
                      onChange={(e) => setReferenceVirement(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
            </>
          )}
          {statutCible === "LIVRE" && dossier.facture?.statut === "VALIDEE" && (
            <p className="text-sm text-muted-foreground">Facture déjà encaissée.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pretAValider || enCours} onClick={valider}>
            {enCours ? "En cours…" : "Confirmer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
