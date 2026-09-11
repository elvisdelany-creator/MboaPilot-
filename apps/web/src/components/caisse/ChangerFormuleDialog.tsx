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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { changerFormuleRequete, chargerOptions, ErreurAuthentification, type ModePaiementEncaissement } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Formule, OptionCatalogue } from "@/lib/types";
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
  // 3.2.2, 5.4.2, 7.4 : "ajuster ses options" lors de la migration
  const [options, setOptions] = useState<OptionCatalogue[]>([]);
  const [idsOptionsSelectionnees, setIdsOptionsSelectionnees] = useState<number[]>([]);

  // 6.5 : moyen de paiement de l'encaissement
  const [modePaiement, setModePaiement] = useState<ModePaiementEncaissement>("CASH");
  const [banque, setBanque] = useState("");
  const [numeroCheque, setNumeroCheque] = useState("");
  const [titulaireCheque, setTitulaireCheque] = useState("");
  const [dateCheque, setDateCheque] = useState("");
  const [referenceVirement, setReferenceVirement] = useState("");

  const ouvert = numeroAbonnement !== null;

  const candidats = formuleActuelle
    ? formulesFamille
        .map((formule) => ({ formule, validation: validerMigrationFormule(formuleActuelle, formule) }))
        .filter((c): c is { formule: Formule; validation: { autorise: true; montantDifferentiel: number } } => c.validation.autorise)
    : [];

  const choix = candidats.find((c) => c.formule.idFormule === idFormuleChoisie) ?? null;

  // 3.2.2, 5.4.2 : options compatibles avec la formule cible, avec leur tarif différencié éventuel
  const optionsCompatibles = choix
    ? options
        .map((o) => ({ option: o, compat: o.formulesCompatibles.find((c) => c.idFormule === choix.formule.idFormule) }))
        .filter((o): o is { option: OptionCatalogue; compat: { idFormule: number; prixSurcharge: number | null } } => o.compat !== undefined)
        .map(({ option, compat }) => ({ ...option, prixApplique: compat.prixSurcharge ?? option.prix }))
    : [];
  const optionsSelectionnees = optionsCompatibles.filter((o) => idsOptionsSelectionnees.includes(o.idOption));
  const prixOptions = optionsSelectionnees.reduce((total, o) => total + o.prixApplique, 0);
  const montantDu = (choix?.validation.montantDifferentiel ?? 0) + prixOptions;

  useEffect(() => {
    if (!ouvert) {
      setIdFormuleChoisie(null);
      setMontantEncaisse(0);
      setIdsOptionsSelectionnees([]);
      setModePaiement("CASH");
      setBanque("");
      setNumeroCheque("");
      setTitulaireCheque("");
      setDateCheque("");
      setReferenceVirement("");
      return;
    }
    chargerOptions(token)
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [ouvert, token]);

  useEffect(() => {
    setIdsOptionsSelectionnees([]);
  }, [idFormuleChoisie]);

  useEffect(() => {
    setMontantEncaisse(montantDu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choix, idsOptionsSelectionnees]);

  async function valider() {
    if (!numeroAbonnement || !choix) return;
    setEnCours(true);
    try {
      const resultat = await changerFormuleRequete(token, numeroAbonnement, {
        siteId: utilisateur.siteId,
        userId: utilisateur.idUser,
        idNouvelleFormule: choix.formule.idFormule,
        idsOptions: idsOptionsSelectionnees.length > 0 ? idsOptionsSelectionnees : undefined,
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
          ? `Migration vers « ${choix.formule.libelle} » — ${formateurFcfa.format(montantDu)} FCFA encaissés.`
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

          {/* 3.2.2, 5.4.2, 7.4 : "ajuster ses options" lors de la migration */}
          {choix && optionsCompatibles.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-normal text-muted-foreground">Options</p>
              {optionsCompatibles.map((o) => (
                <label key={o.idOption} className="flex items-center justify-between gap-2 text-sm text-foreground">
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={idsOptionsSelectionnees.includes(o.idOption)}
                      onCheckedChange={() =>
                        setIdsOptionsSelectionnees((ids) =>
                          ids.includes(o.idOption) ? ids.filter((id) => id !== o.idOption) : [...ids, o.idOption]
                        )
                      }
                    />
                    {o.libelle}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{formateurFcfa.format(o.prixApplique)} FCFA</span>
                </label>
              ))}
            </div>
          )}

          {choix && (
            <div>
              <Label htmlFor="mode-paiement-migration">Mode de paiement</Label>
              <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as ModePaiementEncaissement)}>
                <SelectTrigger id="mode-paiement-migration" className="mt-1 w-full">
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

          {choix && (
            <div>
              <Label htmlFor="migration-encaisse">Montant encaissé</Label>
              <Input
                id="migration-encaisse"
                type="number"
                min={0}
                value={montantEncaisse}
                onChange={(e) => setMontantEncaisse(Number(e.target.value))}
                className="mt-1 h-11 text-base tabular-nums"
              />
              {montantEncaisse > 0 && montantEncaisse < montantDu && (
                <p className="mt-1 text-sm text-alert-j3-fg">
                  Encaissement partiel — solde de {formateurFcfa.format(montantDu - montantEncaisse)} FCFA restant dû.
                </p>
              )}
              {/* 8.5, 9.2 : "calcul automatique des totaux et de la monnaie rendue" */}
              {modePaiement === "CASH" && montantEncaisse > montantDu && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Monnaie à rendre : <span className="font-medium text-card-foreground">{formateurFcfa.format(montantEncaisse - montantDu)} FCFA</span>
                </p>
              )}
            </div>
          )}

          {/* 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date" */}
          {choix && modePaiement === "CHEQUE" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="cheque-banque-migration">Banque</Label>
                <Input id="cheque-banque-migration" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="cheque-numero-migration">Numéro de chèque</Label>
                <Input id="cheque-numero-migration" value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="cheque-titulaire-migration">Titulaire</Label>
                <Input
                  id="cheque-titulaire-migration"
                  value={titulaireCheque}
                  onChange={(e) => setTitulaireCheque(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="cheque-date-migration">Date</Label>
                <Input id="cheque-date-migration" type="date" value={dateCheque} onChange={(e) => setDateCheque(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}

          {/* 6.5 : "Virement bancaire — Banque émettrice, référence de virement" */}
          {choix && modePaiement === "VIREMENT" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="virement-banque-migration">Banque émettrice</Label>
                <Input id="virement-banque-migration" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="virement-reference-migration">Référence de virement</Label>
                <Input
                  id="virement-reference-migration"
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
              !choix ||
              enCours ||
              (modePaiement === "CHEQUE" && !(banque.trim() && numeroCheque.trim() && titulaireCheque.trim() && dateCheque)) ||
              (modePaiement === "VIREMENT" && !(banque.trim() && referenceVirement.trim()))
            }
            onClick={valider}
          >
            {enCours ? "Migration…" : "Confirmer la migration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
