import { useEffect, useState } from "react";
import { ArrowUpCircle, FileText, Wrench } from "lucide-react";
import { calculerPrixKit } from "@mboapilot/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Abonne, CatalogueKit, Formule, NouvelAbonne, ParcoursPaiementMobile } from "@/lib/types";

export type PaiementSaisi =
  | { mode: "CASH"; montant: number }
  | { mode: "MOBILE_MONEY"; montant: number; numeroTelephone: string; parcours: ParcoursPaiementMobile };

interface Props {
  abonneSelectionne: Abonne | NouvelAbonne | null;
  formuleSelectionnee: Formule | null;
  kitSelectionne: CatalogueKit | null;
  numeroAbonnementARenouveler: number | null;
  // 7.4 : le changement de formule (migration) ne s'applique qu'à un
  // abonnement ACTIF, jamais à un abonnement déjà EXPIRE
  peutMigrerFormule: boolean;
  enCours: boolean;
  onValider: (paiement: PaiementSaisi) => void;
  onEchangerMateriel: () => void;
  onChangerFormule: () => void;
  onImprimerProForma: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 9.2, 6.5, 6.6 : ticket en cours — récapitulatif, total, choix du mode de
// paiement (comptant ou Mobile Money). Le mode recrutement/réabonnement
// (7.1/7.2) est détecté automatiquement par CaissePage, jamais choisi ici.
export function TicketPanel({
  abonneSelectionne,
  formuleSelectionnee,
  kitSelectionne,
  numeroAbonnementARenouveler,
  peutMigrerFormule,
  enCours,
  onValider,
  onEchangerMateriel,
  onChangerFormule,
  onImprimerProForma,
}: Props) {
  const prixKit =
    kitSelectionne && formuleSelectionnee
      ? calculerPrixKit(kitSelectionne, { idFormule: formuleSelectionnee.idFormule, prix: formuleSelectionnee.prix })
      : 0;
  const total = (formuleSelectionnee?.prix ?? 0) + prixKit;

  const [modePaiement, setModePaiement] = useState<"CASH" | "MOBILE_MONEY">("CASH");
  const [montant, setMontant] = useState(total);
  const [numeroTelephone, setNumeroTelephone] = useState("");
  const [parcours, setParcours] = useState<ParcoursPaiementMobile>("USSD_CLIENT");
  useEffect(() => setMontant(total), [total]);

  const pretAValider =
    Boolean(abonneSelectionne && formuleSelectionnee) &&
    !enCours &&
    (modePaiement === "CASH" || numeroTelephone.trim().length > 0);

  function valider() {
    if (modePaiement === "CASH") onValider({ mode: "CASH", montant });
    else onValider({ mode: "MOBILE_MONEY", montant: total, numeroTelephone: numeroTelephone.trim(), parcours });
  }

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

        {numeroAbonnementARenouveler && (
          <Button
            variant="outline"
            size="sm"
            className="mb-3 w-full cursor-pointer gap-2"
            onClick={onEchangerMateriel}
          >
            <Wrench className="size-4" />
            Échanger le matériel (panne/vol)
          </Button>
        )}

        {peutMigrerFormule && (
          <Button
            variant="outline"
            size="sm"
            className="mb-3 w-full cursor-pointer gap-2"
            onClick={onChangerFormule}
          >
            <ArrowUpCircle className="size-4" />
            Changer de formule (migration)
          </Button>
        )}

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
          <Label htmlFor="mode-paiement">Mode de paiement</Label>
          <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as "CASH" | "MOBILE_MONEY")}>
            <SelectTrigger id="mode-paiement" className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">Comptant (cash)</SelectItem>
              <SelectItem value="MOBILE_MONEY">Mobile Money (Orange Money)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {modePaiement === "CASH" && (
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
        )}

        {modePaiement === "MOBILE_MONEY" && (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="mobile-money-telephone">Numéro de téléphone</Label>
              <Input
                id="mobile-money-telephone"
                type="tel"
                value={numeroTelephone}
                onChange={(e) => setNumeroTelephone(e.target.value)}
                placeholder="690000000"
                className="mt-1 h-11 text-base"
              />
            </div>
            <div>
              <Label htmlFor="mobile-money-parcours">Parcours</Label>
              <Select value={parcours} onValueChange={(v) => setParcours(v as ParcoursPaiementMobile)}>
                <SelectTrigger id="mobile-money-parcours" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USSD_CLIENT">USSD (le client génère l'OTP)</SelectItem>
                  <SelectItem value="PUSH_MARCHAND">Push (notification envoyée au client)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border p-4">
        {/* 6.7 : estimation imprimable avant encaissement — distincte de la facture BROUILLON */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full cursor-pointer gap-2"
          disabled={!abonneSelectionne || !formuleSelectionnee}
          onClick={onImprimerProForma}
        >
          <FileText className="size-4" />
          Facture pro-forma
        </Button>
        <Button
          type="button"
          size="lg"
          className="h-12 w-full cursor-pointer text-base"
          disabled={!pretAValider}
          onClick={valider}
        >
          {enCours ? "Encaissement…" : modePaiement === "CASH" ? "Valider et encaisser" : "Initier le paiement Mobile Money"}
        </Button>
      </div>
    </aside>
  );
}
