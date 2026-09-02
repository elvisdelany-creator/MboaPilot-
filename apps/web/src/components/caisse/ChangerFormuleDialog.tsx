import { useEffect, useState } from "react";
import { toast } from "sonner";
import { validerMigrationFormule } from "@mboapilot/shared";
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
import { changerFormuleRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Formule } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  numeroAbonnement: number | null;
  formuleActuelle: Formule | null;
  formulesFamille: Formule[];
  onFerme: () => void;
  onSucces: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 7.4 : changement de formule (migration) — uniquement vers une formule de
// rang strictement supérieur de la même famille, sur un abonnement ACTIF.
// La facturation porte sur le différentiel de prix, la période en cours
// n'est jamais recalculée (contrairement à un réabonnement, 7.2).
export function ChangerFormuleDialog({ numeroAbonnement, formuleActuelle, formulesFamille, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [idFormuleChoisie, setIdFormuleChoisie] = useState<number | null>(null);
  const [montantEncaisse, setMontantEncaisse] = useState(0);
  const [enCours, setEnCours] = useState(false);

  const ouvert = numeroAbonnement !== null;

  const candidats = formuleActuelle
    ? formulesFamille
        .map((formule) => ({ formule, validation: validerMigrationFormule(formuleActuelle, formule) }))
        .filter((c): c is { formule: Formule; validation: { autorise: true; montantDifferentiel: number } } => c.validation.autorise)
    : [];

  const choix = candidats.find((c) => c.formule.idFormule === idFormuleChoisie) ?? null;

  useEffect(() => {
    if (!ouvert) {
      setIdFormuleChoisie(null);
      setMontantEncaisse(0);
    }
  }, [ouvert]);

  useEffect(() => {
    setMontantEncaisse(choix?.validation.montantDifferentiel ?? 0);
  }, [choix]);

  async function valider() {
    if (!numeroAbonnement || !choix) return;
    setEnCours(true);
    try {
      const resultat = await changerFormuleRequete(token, numeroAbonnement, {
        siteId: utilisateur.siteId,
        userId: utilisateur.idUser,
        idNouvelleFormule: choix.formule.idFormule,
        montantEncaisse,
      });
      toast.success(
        resultat.statutFacture === "VALIDEE"
          ? `Migration vers « ${choix.formule.libelle} » — ${formateurFcfa.format(resultat.montantDifferentiel)} FCFA encaissés.`
          : `Migration vers « ${choix.formule.libelle} » — facture en attente d'encaissement.`
      );
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec du changement de formule.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Changer de formule (migration)</DialogTitle>
          <DialogDescription>
            {formuleActuelle
              ? `Formule actuelle : ${formuleActuelle.libelle} — seule une formule supérieure peut être sélectionnée.`
              : "Sélectionnez la nouvelle formule."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {candidats.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucune formule supérieure disponible dans cette famille.</p>
          )}

          <div className="space-y-2">
            {candidats.map(({ formule, validation }) => (
              <button
                key={formule.idFormule}
                type="button"
                onClick={() => setIdFormuleChoisie(formule.idFormule)}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between rounded-lg border-2 p-3 text-left transition-colors",
                  formule.idFormule === idFormuleChoisie ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                )}
              >
                <span className="font-medium text-card-foreground">{formule.libelle}</span>
                <span className="tabular-nums text-primary">+{formateurFcfa.format(validation.montantDifferentiel)} FCFA</span>
              </button>
            ))}
          </div>

          {choix && (
            <div>
              <Label htmlFor="migration-encaisse">Montant encaissé (comptant)</Label>
              <Input
                id="migration-encaisse"
                type="number"
                min={0}
                value={montantEncaisse}
                onChange={(e) => setMontantEncaisse(Number(e.target.value))}
                className="mt-1 h-11 text-base tabular-nums"
              />
              {montantEncaisse > 0 && montantEncaisse < choix.validation.montantDifferentiel && (
                <p className="mt-1 text-sm text-alert-j3-fg">
                  Encaissement partiel — solde de {formateurFcfa.format(choix.validation.montantDifferentiel - montantEncaisse)} FCFA restant dû.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!choix || enCours} onClick={valider}>
            {enCours ? "Migration…" : "Confirmer la migration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
