import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { FicheApporteur, StatutCommission } from "@/lib/types";

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });

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

// 6.3 : fiche consolidée d'un apporteur — abonnés recrutés, chiffre d'affaires
// généré et suivi des commissions CANAL+ (probatoire 4 mois → confirmée/annulée).
export function FicheApporteurPanel({ fiche }: { fiche: FicheApporteur }) {
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
    </div>
  );
}
