import { useEffect, useState } from "react";
import { ArrowUpCircle, FileText, Wrench } from "lucide-react";
import { calculerPrixKit } from "@mboapilot/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { Abonne, CatalogueKit, ComptePartage, Formule, NouvelAbonne, ParcoursPaiementMobile } from "@/lib/types";

// 3.2.2, 5.4.2 : option complémentaire compatible avec la formule
// sélectionnée, déjà résolue au tarif différencié applicable
export interface OptionCompatible {
  idOption: number;
  libelle: string;
  prixApplique: number;
}

export type PaiementSaisi =
  | { mode: "CASH"; montant: number }
  | { mode: "CHEQUE"; montant: number; banque: string; numeroCheque: string; titulaireCheque: string; dateCheque: string }
  | { mode: "VIREMENT"; montant: number; banque: string; referenceVirement: string }
  | { mode: "MOBILE_MONEY"; montant: number; numeroTelephone: string; parcours: ParcoursPaiementMobile };

interface Props {
  abonneSelectionne: Abonne | NouvelAbonne | null;
  formuleSelectionnee: Formule | null;
  kitSelectionne: CatalogueKit | null;
  // 3.2.2, 5.4.2 : options complémentaires compatibles avec la formule
  // sélectionnée (déjà filtrées par CaissePage)
  optionsCompatibles: OptionCompatible[];
  idsOptionsSelectionnees: number[];
  onChangerOptionsSelectionnees: (ids: number[]) => void;
  numeroAbonnementARenouveler: number | null;
  // 7.4 : le changement de formule (migration) ne s'applique qu'à un
  // abonnement ACTIF, jamais à un abonnement déjà EXPIRE
  peutMigrerFormule: boolean;
  // 5.9 : comptes partagés actifs de la famille sélectionnée (Netflix, IPTV…) —
  // vide pour les familles satellite classiques, qui n'ont pas ce concept
  comptesPartagesDisponibles: ComptePartage[];
  comptePartageSelectionne: number | null;
  onSelectionnerComptePartage: (idComptePartage: number | null) => void;
  // 6.4, 7.1 : "remise ponctuelle" sur le prix de la formule — remontée à
  // CaissePage pour que le pro-forma imprimable la reflète aussi
  remise: number;
  onChangerRemise: (remise: number) => void;
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
  optionsCompatibles,
  idsOptionsSelectionnees,
  onChangerOptionsSelectionnees,
  numeroAbonnementARenouveler,
  peutMigrerFormule,
  comptesPartagesDisponibles,
  comptePartageSelectionne,
  onSelectionnerComptePartage,
  remise,
  onChangerRemise,
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
  const optionsSelectionnees = optionsCompatibles.filter((o) => idsOptionsSelectionnees.includes(o.idOption));
  const prixOptions = optionsSelectionnees.reduce((somme, o) => somme + o.prixApplique, 0);
  const total = (formuleSelectionnee?.prix ?? 0) - remise + prixKit + prixOptions;

  function basculerOption(idOption: number) {
    onChangerOptionsSelectionnees(
      idsOptionsSelectionnees.includes(idOption)
        ? idsOptionsSelectionnees.filter((id) => id !== idOption)
        : [...idsOptionsSelectionnees, idOption]
    );
  }

  const [modePaiement, setModePaiement] = useState<"CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY">("CASH");
  const [montant, setMontant] = useState(total);
  const [numeroTelephone, setNumeroTelephone] = useState("");
  const [parcours, setParcours] = useState<ParcoursPaiementMobile>("USSD_CLIENT");
  // 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date"
  const [banque, setBanque] = useState("");
  const [numeroCheque, setNumeroCheque] = useState("");
  const [titulaireCheque, setTitulaireCheque] = useState("");
  const [dateCheque, setDateCheque] = useState("");
  // 6.5 : "Virement bancaire — Banque émettrice, référence de virement"
  const [referenceVirement, setReferenceVirement] = useState("");
  useEffect(() => setMontant(total), [total]);

  const pretAValider =
    Boolean(abonneSelectionne && formuleSelectionnee) &&
    !enCours &&
    (modePaiement === "CASH" ||
      (modePaiement === "CHEQUE" && banque.trim() && numeroCheque.trim() && titulaireCheque.trim() && dateCheque) ||
      (modePaiement === "VIREMENT" && banque.trim() && referenceVirement.trim()) ||
      (modePaiement === "MOBILE_MONEY" && numeroTelephone.trim().length > 0));

  function valider() {
    if (modePaiement === "CASH") onValider({ mode: "CASH", montant });
    else if (modePaiement === "CHEQUE")
      onValider({
        mode: "CHEQUE",
        montant: total,
        banque: banque.trim(),
        numeroCheque: numeroCheque.trim(),
        titulaireCheque: titulaireCheque.trim(),
        dateCheque,
      });
    else if (modePaiement === "VIREMENT")
      onValider({ mode: "VIREMENT", montant: total, banque: banque.trim(), referenceVirement: referenceVirement.trim() });
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
          {optionsSelectionnees.map((o) => (
            <li key={o.idOption} className="flex items-center justify-between text-sm">
              <span className="text-card-foreground">{o.libelle}</span>
              <span className="tabular-nums font-medium text-card-foreground">{formateurFcfa.format(o.prixApplique)} FCFA</span>
            </li>
          ))}
        </ul>

        {/* 3.2.2, 5.4.2 : options complémentaires compatibles avec la formule (ex. Option English Plus) */}
        {optionsCompatibles.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-sm font-normal text-muted-foreground">Options</p>
            {optionsCompatibles.map((o) => (
              <label key={o.idOption} className="flex items-center justify-between gap-2 text-sm text-foreground">
                <span className="flex items-center gap-2">
                  <Checkbox checked={idsOptionsSelectionnees.includes(o.idOption)} onCheckedChange={() => basculerOption(o.idOption)} />
                  {o.libelle}
                </span>
                <span className="tabular-nums text-muted-foreground">{formateurFcfa.format(o.prixApplique)} FCFA</span>
              </label>
            ))}
          </div>
        )}

        {/* 6.4 : "remise ponctuelle" ou "tarif préférentiel apporteur" — montant en FCFA déduit du prix de la formule */}
        {formuleSelectionnee && (
          <div className="mt-3 flex items-center gap-2">
            <Label htmlFor="ticket-remise" className="text-sm font-normal text-muted-foreground">
              Remise
            </Label>
            <Input
              id="ticket-remise"
              type="number"
              min={0}
              max={formuleSelectionnee.prix}
              value={remise || ""}
              placeholder="0"
              onChange={(e) => onChangerRemise(Math.max(0, Math.min(Number(e.target.value), formuleSelectionnee.prix)))}
              className="h-9 flex-1 tabular-nums"
            />
            <span className="text-sm text-muted-foreground">FCFA</span>
          </div>
        )}

        {/* 5.9 : affectation à un écran d'un compte streaming mutualisé — uniquement
            au recrutement (un réabonnement reconduit l'écran déjà occupé) */}
        {!numeroAbonnementARenouveler && formuleSelectionnee && comptesPartagesDisponibles.length > 0 && (
          <div className="mt-4">
            <Label htmlFor="compte-partage">Compte partagé (optionnel)</Label>
            <Select
              value={comptePartageSelectionne !== null ? String(comptePartageSelectionne) : "aucun"}
              onValueChange={(v) => onSelectionnerComptePartage(v === "aucun" ? null : Number(v))}
            >
              <SelectTrigger id="compte-partage" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aucun">Aucun (compte individuel)</SelectItem>
                {comptesPartagesDisponibles.map((c) => (
                  <SelectItem key={c.idComptePartage} value={String(c.idComptePartage)} disabled={c.ecransOccupes >= c.nombreEcransMax}>
                    {c.libelle} ({c.ecransOccupes}/{c.nombreEcransMax} écrans)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Separator className="my-4" />

        <div className="flex items-center justify-between text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums text-primary">{formateurFcfa.format(total)} FCFA</span>
        </div>

        <div className="mt-4">
          <Label htmlFor="mode-paiement">Mode de paiement</Label>
          <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY")}>
            <SelectTrigger id="mode-paiement" className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">Comptant (cash)</SelectItem>
              <SelectItem value="CHEQUE">Chèque</SelectItem>
              <SelectItem value="VIREMENT">Virement bancaire</SelectItem>
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

        {/* 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date" — validation immédiate, montant total */}
        {modePaiement === "CHEQUE" && (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="cheque-banque">Banque</Label>
              <Input id="cheque-banque" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1 h-11 text-base" />
            </div>
            <div>
              <Label htmlFor="cheque-numero">Numéro de chèque</Label>
              <Input id="cheque-numero" value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)} className="mt-1 h-11 text-base" />
            </div>
            <div>
              <Label htmlFor="cheque-titulaire">Titulaire</Label>
              <Input
                id="cheque-titulaire"
                value={titulaireCheque}
                onChange={(e) => setTitulaireCheque(e.target.value)}
                className="mt-1 h-11 text-base"
              />
            </div>
            <div>
              <Label htmlFor="cheque-date">Date</Label>
              <Input id="cheque-date" type="date" value={dateCheque} onChange={(e) => setDateCheque(e.target.value)} className="mt-1 h-11 text-base" />
            </div>
          </div>
        )}

        {/* 6.5 : "Virement bancaire — Banque émettrice, référence de virement" — rapprochement différé */}
        {modePaiement === "VIREMENT" && (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="virement-banque">Banque émettrice</Label>
              <Input id="virement-banque" value={banque} onChange={(e) => setBanque(e.target.value)} className="mt-1 h-11 text-base" />
            </div>
            <div>
              <Label htmlFor="virement-reference">Référence de virement</Label>
              <Input
                id="virement-reference"
                value={referenceVirement}
                onChange={(e) => setReferenceVirement(e.target.value)}
                className="mt-1 h-11 text-base"
              />
            </div>
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
          {enCours ? "Encaissement…" : modePaiement === "MOBILE_MONEY" ? "Initier le paiement Mobile Money" : "Valider et encaisser"}
        </Button>
      </div>
    </aside>
  );
}
