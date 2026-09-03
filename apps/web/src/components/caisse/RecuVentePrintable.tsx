import { Printer, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { InfosEntreprise } from "@/lib/types";

export interface LigneRecu {
  libelle: string;
  montant: number;
}

export interface RecuVente {
  operation: "Recrutement" | "Réabonnement";
  numeroAbonnement: number;
  lignes: LigneRecu[];
  total: number;
  modePaiement: "CASH" | "MOBILE_MONEY";
  montantEncaisse: number;
  dateHeure: string;
}

interface Props {
  infosEntreprise: InfosEntreprise | null;
  recu: RecuVente;
  onNouvelleVente: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const LIBELLE_MODE_PAIEMENT: Record<"CASH" | "MOBILE_MONEY", string> = { CASH: "Comptant", MOBILE_MONEY: "Mobile Money" };

// 6.7, 9.2 : ticket de caisse — édité immédiatement au comptoir après
// encaissement. Mise en page pensée pour une imprimante thermique 80mm
// (window.print(), comme l'export PDF de la fiche 360°, 8.1) mais lisible à
// l'écran en attendant l'intégration matérielle.
export function RecuVentePrintable({ infosEntreprise, recu, onNouvelleVente }: Props) {
  const monnaieRendue = recu.modePaiement === "CASH" ? Math.max(0, recu.montantEncaisse - recu.total) : 0;
  const soldeDu = Math.max(0, recu.total - recu.montantEncaisse);

  // 6.1, 8.8 : taux configurable (le cas échéant) — le total facturé reste
  // inchangé (TTC), la TVA n'est qu'une mention informative de sa composition
  const tauxTva = infosEntreprise?.entreprise.tauxTva ?? null;
  const montantHT = tauxTva !== null ? Math.round((recu.total * 10000) / (10000 + tauxTva)) : recu.total;
  const montantTaxe = recu.total - montantHT;

  return (
    <div className="flex h-dvh flex-col items-center overflow-y-auto bg-background p-6">
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="w-full max-w-xs space-y-3 border border-border bg-card p-4 font-mono text-sm text-card-foreground print:border-none">
        <div className="text-center">
          <p className="font-semibold">{infosEntreprise?.entreprise.nom ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{infosEntreprise?.site.nom}</p>
          {infosEntreprise?.site.adresse && <p className="text-xs text-muted-foreground">{infosEntreprise.site.adresse}</p>}
        </div>

        <Separator />

        <p className="text-xs">{formateurDateHeure.format(new Date(recu.dateHeure))}</p>
        <p className="text-xs">
          {recu.operation} — abonnement n° {recu.numeroAbonnement}
        </p>

        <Separator />

        <ul className="space-y-1">
          {recu.lignes.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span>{l.libelle}</span>
              <span className="tabular-nums">{formateurFcfa.format(l.montant)}</span>
            </li>
          ))}
        </ul>

        <Separator />

        {tauxTva !== null && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Total HT</span>
              <span className="tabular-nums">{formateurFcfa.format(montantHT)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>dont TVA {(tauxTva / 100).toString().replace(".", ",")} %</span>
              <span className="tabular-nums">{formateurFcfa.format(montantTaxe)}</span>
            </div>
          </>
        )}
        <div className="flex items-center justify-between font-semibold">
          <span>TOTAL{tauxTva !== null ? " TTC" : ""}</span>
          <span className="tabular-nums">{formateurFcfa.format(recu.total)} {infosEntreprise?.entreprise.devise ?? "FCFA"}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>{LIBELLE_MODE_PAIEMENT[recu.modePaiement]}</span>
          <span className="tabular-nums">{formateurFcfa.format(recu.montantEncaisse)}</span>
        </div>
        {monnaieRendue > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span>Monnaie rendue</span>
            <span className="tabular-nums">{formateurFcfa.format(monnaieRendue)}</span>
          </div>
        )}
        {soldeDu > 0 && (
          <div className="flex items-center justify-between text-xs font-medium">
            <span>Solde restant dû</span>
            <span className="tabular-nums">{formateurFcfa.format(soldeDu)}</span>
          </div>
        )}

        <Separator />

        <p className="text-center text-xs text-muted-foreground">{infosEntreprise?.entreprise.mentionsLegales || "Merci de votre confiance."}</p>
      </div>

      <div className="no-print mt-6 flex gap-2">
        <Button variant="outline" className="cursor-pointer gap-2" onClick={onNouvelleVente}>
          <RotateCcw className="size-4" />
          Nouvelle vente
        </Button>
        <Button className="cursor-pointer gap-2" onClick={() => window.print()}>
          <Printer className="size-4" />
          Imprimer le ticket
        </Button>
      </div>
    </div>
  );
}
