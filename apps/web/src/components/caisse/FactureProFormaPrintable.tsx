import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { InfosEntreprise } from "@/lib/types";
import type { LigneRecu } from "./RecuVentePrintable";

interface Props {
  infosEntreprise: InfosEntreprise | null;
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
export function FactureProFormaPrintable({ infosEntreprise, nomClient, lignes, total, onRetour }: Props) {
  return (
    <div className="flex h-dvh flex-col items-center overflow-y-auto bg-background p-6">
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="w-full max-w-sm space-y-3 border border-border bg-card p-5 text-sm text-card-foreground print:border-none">
        <div className="rounded-md border border-alert-j3-fg/40 bg-alert-j3-bg/25 px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-alert-j3-fg">
          Pro-forma — document sans valeur comptable
        </div>

        <div>
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

        <div className="flex items-center justify-between text-base font-semibold">
          <span>Total estimé</span>
          <span className="tabular-nums">{formateurFcfa.format(total)} FCFA</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Ce document est une estimation et ne constitue ni une facture, ni une preuve de paiement. Il n'engage l'entreprise que jusqu'à la
          date d'émission indiquée ci-dessus.
        </p>
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
