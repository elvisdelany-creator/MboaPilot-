import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { changerStatutSavRequete, ErreurAuthentification } from "@/lib/api";
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

  useEffect(() => {
    if (statutCible === "LIVRE") setMontantEncaisse(dossier.facture?.statut === "BROUILLON" ? dossier.facture.montantTotal : 0);
    if (statutCible !== "LIVRE") setMontantEncaisse(0);
    setDiagnostic("");
    setMotif("");
    setMontantMainOeuvre(0);
  }, [statutCible, dossier.facture]);

  if (!statutCible) return null;

  const motifRequis = statutCible === "IRREPARABLE" || statutCible === "ABANDONNE";
  const pretAValider = !motifRequis || motif.trim().length > 0;

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
                <p className="mt-1 text-sm text-muted-foreground">Dossier sous garantie — la facture sera générée à 0 FCFA.</p>
              )}
            </div>
          )}

          {statutCible === "LIVRE" && dossier.facture?.statut === "BROUILLON" && (
            <div>
              <Label htmlFor="statut-encaisse">Montant encaissé (comptant)</Label>
              <Input
                id="statut-encaisse"
                type="number"
                min={0}
                value={montantEncaisse}
                onChange={(e) => setMontantEncaisse(Number(e.target.value))}
                className="mt-1"
              />
            </div>
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
