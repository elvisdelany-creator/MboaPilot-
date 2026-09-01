import { useEffect, useState } from "react";
import { calculerPrixKit } from "@mboapilot/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { Abonne, CatalogueKit, Formule, NouvelAbonne } from "@/lib/types";

interface Props {
  abonneSelectionne: Abonne | NouvelAbonne | null;
  formuleSelectionnee: Formule | null;
  kitSelectionne: CatalogueKit | null;
  numeroAbonnementARenouveler: number | null;
  enCours: boolean;
  onValider: (montantEncaisse: number) => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 9.2 : ticket en cours — récapitulatif, total, encaissement, validation.
// Le mode (recrutement / réabonnement, 7.1/7.2) est détecté automatiquement
// par CaissePage, jamais choisi explicitement par le caissier.
export function TicketPanel({
  abonneSelectionne,
  formuleSelectionnee,
  kitSelectionne,
  numeroAbonnementARenouveler,
  enCours,
  onValider,
}: Props) {
  const prixKit =
    kitSelectionne && formuleSelectionnee
      ? calculerPrixKit(kitSelectionne, { idFormule: formuleSelectionnee.idFormule, prix: formuleSelectionnee.prix })
      : 0;
  const total = (formuleSelectionnee?.prix ?? 0) + prixKit;

  const [montant, setMontant] = useState(total);
  useEffect(() => setMontant(total), [total]);

  const pretAValider = Boolean(abonneSelectionne && formuleSelectionnee) && !enCours;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-border bg-card lg:w-80">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ticket en cours</h2>
          {formuleSelectionnee && (
            <Badge variant={numeroAbonnementARenouveler ? "default" : "secondary"}>
              {numeroAbonnementARenouveler ? `Réabonnement n° ${numeroAbonnementARenouveler}` : "Recrutement"}
            </Badge>
          )}
        </div>

        {!formuleSelectionnee && !kitSelectionne && (
          <p className="text-sm text-muted-foreground">Aucun article sélectionné.</p>
        )}

        <ul className="space-y-2">
          {formuleSelectionnee && (
            <li className="flex items-center justify-between text-sm">
              <span className="text-card-foreground">{formuleSelectionnee.libelle}</span>
              <span className="tabular-nums font-medium text-card-foreground">
                {formateurFcfa.format(formuleSelectionnee.prix)} FCFA
              </span>
            </li>
          )}
          {kitSelectionne && (
            <li className="flex items-center justify-between text-sm">
              <span className="text-card-foreground">{kitSelectionne.libelle}</span>
              <span className="tabular-nums font-medium text-card-foreground">{formateurFcfa.format(prixKit)} FCFA</span>
            </li>
          )}
        </ul>

        <Separator className="my-4" />

        <div className="flex items-center justify-between text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums text-primary">{formateurFcfa.format(total)} FCFA</span>
        </div>

        <div className="mt-4">
          <Label htmlFor="montant-encaisse">Montant encaissé (comptant)</Label>
          <Input
            id="montant-encaisse"
            type="number"
            min={0}
            value={montant}
            onChange={(e) => setMontant(Number(e.target.value))}
            className="mt-1 h-11 text-base tabular-nums"
          />
          {montant > 0 && montant < total && (
            <p className="mt-1 text-sm text-alert-j3-fg">
              Encaissement partiel — solde de {formateurFcfa.format(total - montant)} FCFA restant dû.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <Button
          type="button"
          size="lg"
          className="h-12 w-full cursor-pointer text-base"
          disabled={!pretAValider}
          onClick={() => onValider(montant)}
        >
          {enCours ? "Encaissement…" : "Valider et encaisser"}
        </Button>
      </div>
    </aside>
  );
}
