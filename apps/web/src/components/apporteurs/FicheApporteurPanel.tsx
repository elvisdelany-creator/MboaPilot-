import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { ModePaiementEncaissement } from "@/lib/api";
import type { FicheApporteur, ModePaiement, StatutCommission } from "@/lib/types";

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });
const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

const LIBELLE_MODE_PAIEMENT: Record<ModePaiement, string> = {
  CASH: "Comptant",
  CHEQUE: "Chèque",
  VIREMENT: "Virement",
  MOBILE_MONEY: "Mobile Money",
};

const LIBELLES_STATUT_COMMISSION: Record<StatutCommission, string> = {
  EN_COURS: "En cours (probatoire)",
  CONFIRMEE: "Confirmée",
  ANNULEE: "Annulée",
};

const VARIANTE_STATUT_COMMISSION: Record<StatutCommission, "secondary" | "default" | "destructive"> = {
  EN_COURS: "secondary",
  CONFIRMEE: "default",
  ANNULEE: "destructive",
};

interface Props {
  fiche: FicheApporteur;
  // 6.3 : "historique de règlement de ses commissions" — formulaire
  // d'enregistrement fourni uniquement côté gestion (Administrateur/Gérant) ;
  // absent sur la fiche en lecture seule de l'apporteur lui-même (2.5.1)
  onEnregistrerReglement?: (payload: { montant: number; modePaiement: ModePaiementEncaissement; reference?: string }) => void | Promise<void>;
}

// 6.3 : fiche consolidée d'un apporteur — abonnés recrutés, chiffre d'affaires
// généré, suivi des commissions CANAL+ (probatoire 4 mois → confirmée/annulée)
// et historique de règlement des commissions dues.
export function FicheApporteurPanel({ fiche, onEnregistrerReglement }: Props) {
  const [montant, setMontant] = useState("");
  const [modePaiement, setModePaiement] = useState<ModePaiementEncaissement>("CASH");
  const [reference, setReference] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function valider() {
    if (!onEnregistrerReglement || !montant) return;
    setEnCours(true);
    try {
      await onEnregistrerReglement({ montant: Number(montant), modePaiement, reference: reference.trim() || undefined });
      setMontant("");
      setReference("");
      setModePaiement("CASH");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">{fiche.apporteur.nom}</h2>
          <p className="text-sm text-muted-foreground">{fiche.apporteur.telephone ?? "Aucun téléphone renseigné"}</p>
        </div>
        <Badge variant={fiche.apporteur.actif === 1 ? "default" : "outline"}>
          {fiche.apporteur.actif === 1 ? "Actif" : "Inactif"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="gap-1 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chiffre d'affaires généré</p>
          <p className="text-xl font-semibold tabular-nums text-primary">{formateurFcfa.format(fiche.chiffreAffaires)} FCFA</p>
        </Card>
        <Card className="gap-1 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Abonnés recrutés</p>
          <p className="text-xl font-semibold tabular-nums text-card-foreground">{fiche.abonnes.length}</p>
        </Card>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Abonnés recrutés</p>
        {fiche.abonnes.length === 0 && <p className="text-sm text-muted-foreground">Aucun abonné recruté pour l'instant.</p>}
        <ul className="space-y-1 text-sm text-card-foreground">
          {fiche.abonnes.map((a) => (
            <li key={a.idAbonne}>
              {a.prenom} {a.nom} · {a.telephone}
            </li>
          ))}
        </ul>
      </div>

      <Separator />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Commissions CANAL+ (suivi 4 mois)</p>
        {fiche.commissionsCanalplus.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune commission CANAL+ enregistrée.</p>
        )}
        <ul className="space-y-2">
          {fiche.commissionsCanalplus.map((c) => (
            <li key={c.idSuivi} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Abonnement n° {c.numeroAbonnement} · fin probatoire {formateurDate.format(new Date(c.dateFinProbatoire))}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums font-medium text-card-foreground">{formateurFcfa.format(c.montantCommission)} FCFA</span>
                <Badge variant={VARIANTE_STATUT_COMMISSION[c.statut]}>{LIBELLES_STATUT_COMMISSION[c.statut]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Separator />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Règlement des commissions</p>
        <div className="grid grid-cols-3 gap-3">
          <Card className="gap-1 p-3">
            <p className="text-xs text-muted-foreground">Confirmées</p>
            <p className="text-base font-semibold tabular-nums text-card-foreground">{formateurFcfa.format(fiche.montantCommissionConfirmee)}</p>
          </Card>
          <Card className="gap-1 p-3">
            <p className="text-xs text-muted-foreground">Réglées</p>
            <p className="text-base font-semibold tabular-nums text-card-foreground">{formateurFcfa.format(fiche.montantCommissionRegle)}</p>
          </Card>
          <Card className="gap-1 p-3">
            <p className="text-xs text-muted-foreground">Solde dû</p>
            <p className="text-base font-semibold tabular-nums text-primary">{formateurFcfa.format(fiche.soldeCommissionDu)}</p>
          </Card>
        </div>

        {fiche.reglements.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Aucun règlement enregistré.</p>}
        <ul className="mt-3 space-y-1.5">
          {fiche.reglements.map((r) => (
            <li key={r.idReglement} className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {formateurDateHeure.format(new Date(r.dateReglement))} — {LIBELLE_MODE_PAIEMENT[r.modePaiement]}
                {r.reference ? ` (${r.reference})` : ""}
              </span>
              <span className="tabular-nums font-medium text-card-foreground">{formateurFcfa.format(r.montant)} FCFA</span>
            </li>
          ))}
        </ul>

        {onEnregistrerReglement && fiche.soldeCommissionDu > 0 && (
          <div className="mt-4 flex items-end gap-2 border-t border-border pt-3">
            <div className="flex-1">
              <Label htmlFor="reglement-montant" className="text-xs">
                Montant
              </Label>
              <Input
                id="reglement-montant"
                type="number"
                min={1}
                max={fiche.soldeCommissionDu}
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
                placeholder="0"
                className="mt-1 h-9"
              />
            </div>
            <div className="w-36">
              <Label htmlFor="reglement-mode" className="text-xs">
                Mode
              </Label>
              <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as ModePaiementEncaissement)}>
                <SelectTrigger id="reglement-mode" className="mt-1 h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Comptant</SelectItem>
                  <SelectItem value="CHEQUE">Chèque</SelectItem>
                  <SelectItem value="VIREMENT">Virement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label htmlFor="reglement-reference" className="text-xs">
                Référence (optionnel)
              </Label>
              <Input id="reglement-reference" value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-9" />
            </div>
            <Button
              className="h-9 cursor-pointer"
              disabled={!montant || Number(montant) <= 0 || Number(montant) > fiche.soldeCommissionDu || enCours}
              onClick={valider}
            >
              {enCours ? "Enregistrement…" : "Régler"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
