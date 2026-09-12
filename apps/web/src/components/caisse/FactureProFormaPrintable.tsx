import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { InfosEntreprise } from "@/lib/types";
import type { LigneRecu } from "./RecuVentePrintable";

interface Props {
  infosEntreprise: InfosEntreprise | null;
  // 3.2.1, 13.2 : logo de l'entreprise, déjà résolu en URL locale (blob) par
  // l'appelant — l'endpoint qui le sert exige une authentification Bearer
  logoUrl: string | null;
  nomClient: string;
  lignes: LigneRecu[];
  total: number;
  onRetour: () => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

// 6.7 : facture pro-forma — document non définitif, sans valeur
// d'encaissement, édité AVANT paiement pour donner au client une estimation
// engageante. Se distingue visuellement et textuellement de la facture
// BROUILLON, qui existe déjà en base et porte une valeur comptable en attente.
export function FactureProFormaPrintable({ infosEntreprise, logoUrl, nomClient, lignes, total, onRetour }: Props) {
  // 6.1, 8.8 : mention informative de la composition du total, comme sur le ticket (6.7)
  const tauxTva = infosEntreprise?.entreprise.tauxTva ?? null;
  const montantHT = tauxTva !== null ? Math.round((total * 10000) / (10000 + tauxTva)) : total;
  const montantTaxe = total - montantHT;

  return (
    <div className="flex h-dvh flex-col items-center overflow-y-auto bg-background p-6">
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="w-full max-w-sm space-y-3 border border-border bg-card p-5 text-sm text-card-foreground print:border-none">
        <div className="rounded-md border border-alert-j3-fg/40 bg-alert-j3-bg/25 px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-alert-j3-fg">
          Pro-forma — document sans valeur comptable
        </div>

        <div>
          {logoUrl && <img src={logoUrl} alt="" className="mb-1 max-h-12 object-contain" />}
          <p className="font-semibold text-card-foreground">{infosEntreprise?.entreprise.nom ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{infosEntreprise?.site.nom}</p>
          {infosEntreprise?.site.adresse && <p className="text-xs text-muted-foreground">{infosEntreprise.site.adresse}</p>}
        </div>

        <Separator />

        <p className="text-xs text-muted-foreground">{formateurDateHeure.format(new Date())}</p>
        {nomClient && <p className="text-sm">Client : {nomClient}</p>}

        <Separator />

        <ul className="space-y-1.5">
          {lignes.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span>{l.libelle}</span>
              <span className="tabular-nums">{formateurFcfa.format(l.montant)} FCFA</span>
            </li>
          ))}
        </ul>

        <Separator />

        {tauxTva !== null && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Total HT</span>
              <span className="tabular-nums">{formateurFcfa.format(montantHT)} FCFA</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>dont TVA {(tauxTva / 100).toString().replace(".", ",")} %</span>
              <span className="tabular-nums">{formateurFcfa.format(montantTaxe)} FCFA</span>
            </div>
          </>
        )}
        <div className="flex items-center justify-between text-base font-semibold">
          <span>Total estimé{tauxTva !== null ? " TTC" : ""}</span>
          <span className="tabular-nums">{formateurFcfa.format(total)} FCFA</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Ce document est une estimation et ne constitue ni une facture, ni une preuve de paiement. Il n'engage l'entreprise que jusqu'à la
          date d'émission indiquée ci-dessus.
        </p>

        {infosEntreprise?.entreprise.mentionsLegales && (
          <p className="text-center text-xs text-muted-foreground">{infosEntreprise.entreprise.mentionsLegales}</p>
        )}
      </div>

      <div className="no-print mt-6 flex gap-2">
        <Button variant="outline" className="cursor-pointer gap-2" onClick={onRetour}>
          <ArrowLeft className="size-4" />
          Retour à la vente
        </Button>
        <Button className="cursor-pointer gap-2" onClick={() => window.print()}>
          <Printer className="size-4" />
          Imprimer le pro-forma
        </Button>
      </div>
    </div>
  );
}
