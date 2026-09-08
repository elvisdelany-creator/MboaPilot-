import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, History, PackageX, RotateCw } from "lucide-react";
import {
  chargerAbonnementsExpires,
  chargerAlertesEcheance,
  chargerAlertesStock,
  chargerCommissionsCanalplusEnCours,
  chargerEncaissementsJour,
  chargerEvolutionCA,
  chargerFamilles,
  chargerIndicateursJour,
  chargerValorisationStock,
  ErreurAuthentification,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EvolutionCaChart } from "./EvolutionCaChart";
import type {
  AbonnementExpire,
  AlerteEcheance,
  CommissionCanalplusEnCours,
  Famille,
  IndicateursJour,
  ModePaiement,
  PointEvolutionCA,
  Produit,
  VentilationPaiement,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  onNaviguer: (vue: Vue) => void;
  onReabonnerDepuisAlerte: (alerte: AlerteEcheance) => void;
  onReabonnerDepuisExpire: (abonnement: AbonnementExpire) => void;
}

// 4.4, 8.8 : le rang (1 = le plus urgent) pilote la couleur, indépendamment
// des jours effectivement configurés pour chaque jalon (paramétrable en
// Administration > Paramètres)
const STYLE_JALON: Record<1 | 2 | 3, string> = {
  1: "bg-alert-j1-bg text-alert-j1-fg",
  2: "bg-alert-j3-bg text-alert-j3-fg",
  3: "bg-alert-j7-bg text-alert-j7-fg",
};

function libelleJalon(jours: number): string {
  return jours === 1 ? "Échéance demain" : `Échéance dans ${jours} jours`;
}

const LIBELLE_MODE_PAIEMENT: Record<ModePaiement, string> = {
  CASH: "Comptant",
  CHEQUE: "Chèque",
  VIREMENT: "Virement",
  MOBILE_MONEY: "Mobile Money",
};

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDateCourte = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });

// 9.3 : tableau de bord — liste priorisée des abonnements à échéance, triée
// par urgence (J-1 en premier), avec accès direct au réabonnement en un clic.
// Section de pilotage (8.6) réservée à Administrateur/Gérant/Comptable :
// KPI du jour, courbe de CA, encaissements, commissions CANAL+ en cours.
export function DashboardPage({ onNaviguer, onReabonnerDepuisAlerte, onReabonnerDepuisExpire }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const siteId = session!.utilisateur.siteId;
  const peutPiloter = ["ADMINISTRATEUR", "GERANT", "COMPTABLE"].includes(session!.utilisateur.role);

  const [alertes, setAlertes] = useState<AlerteEcheance[] | null>(null);
  // 4.4, 8.8 : liste dédiée « Abonnements expirés », filtrable par famille
  const [abonnementsExpires, setAbonnementsExpires] = useState<AbonnementExpire[]>([]);
  const [familles, setFamilles] = useState<Famille[]>([]);
  const [idFamilleFiltre, setIdFamilleFiltre] = useState<number | null>(null);
  const [alertesStock, setAlertesStock] = useState<Produit[]>([]);
  const [indicateurs, setIndicateurs] = useState<IndicateursJour | null>(null);
  const [evolutionCA, setEvolutionCA] = useState<PointEvolutionCA[]>([]);
  const [periodeCA, setPeriodeCA] = useState<7 | 30>(7);
  const [encaissements, setEncaissements] = useState<VentilationPaiement[]>([]);
  const [valorisationStock, setValorisationStock] = useState<number | null>(null);
  const [commissionsCanalplus, setCommissionsCanalplus] = useState<CommissionCanalplusEnCours[]>([]);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function charger() {
    const aujourdHui = new Date().toISOString().slice(0, 10);

    chargerAlertesEcheance(token, siteId)
      .then(setAlertes)
      .catch((e) => gererErreur(e, "Impossible de charger les alertes."));
    // 4.4, 8.8 : liste dédiée « Abonnements expirés », filtrable par famille
    chargerAbonnementsExpires(token, siteId, idFamilleFiltre ?? undefined)
      .then(setAbonnementsExpires)
      .catch(() => setAbonnementsExpires([]));
    // 8.6, 9.3 : état des stocks — alertes de rupture
    chargerAlertesStock(token, siteId)
      .then(setAlertesStock)
      .catch(() => setAlertesStock([]));

    if (!peutPiloter) return;

    chargerIndicateursJour(token, siteId, aujourdHui)
      .then(setIndicateurs)
      .catch(() => setIndicateurs(null));
    chargerEvolutionCA(token, siteId, aujourdHui, periodeCA)
      .then(setEvolutionCA)
      .catch(() => setEvolutionCA([]));
    chargerValorisationStock(token, siteId)
      .then(setValorisationStock)
      .catch(() => setValorisationStock(null));
    chargerEncaissementsJour(token, siteId, aujourdHui)
      .then(setEncaissements)
      .catch(() => setEncaissements([]));
    chargerCommissionsCanalplusEnCours(token, siteId)
      .then(setCommissionsCanalplus)
      .catch(() => setCommissionsCanalplus([]));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(charger, [token, siteId, periodeCA, idFamilleFiltre]);

  useEffect(() => {
    chargerFamilles(token)
      .then(setFamilles)
      .catch(() => setFamilles([]));
  }, [token]);

  const alertesTriees = useMemo(() => [...(alertes ?? [])].sort((a, b) => a.rang - b.rang), [alertes]);

  const totalEncaisseJour = encaissements.reduce((total, v) => total + v.total, 0);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader vueActive="dashboard" onNaviguer={onNaviguer} />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-heading text-xl font-semibold text-foreground">Tableau de bord</h1>
            <Button variant="outline" size="sm" className="cursor-pointer gap-2" onClick={charger}>
              <RotateCw className="size-4" />
              Actualiser
            </Button>
          </div>

          {peutPiloter && indicateurs && (
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="gap-1 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CA du jour</p>
                <p className="text-xl font-semibold tabular-nums text-primary">{formateurFcfa.format(indicateurs.chiffreAffairesJour)}</p>
              </Card>
              <Card className="gap-1 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marge estimée</p>
                <p className="text-xl font-semibold tabular-nums text-card-foreground">{formateurFcfa.format(indicateurs.margeEstimeeJour)}</p>
              </Card>
              <Card className="gap-1 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Échéances &lt; 7 j</p>
                <p className="text-xl font-semibold tabular-nums text-card-foreground">{indicateurs.nombreEcheances7j}</p>
              </Card>
              <Card className="gap-1 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alertes de stock</p>
                <p className="text-xl font-semibold tabular-nums text-card-foreground">{indicateurs.nombreAlertesStock}</p>
              </Card>
            </div>
          )}

          {peutPiloter && evolutionCA.length > 0 && (
            <div className="mb-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-lg font-semibold text-foreground">Évolution du chiffre d'affaires</h2>
                <div className="flex gap-1">
                  <Button variant={periodeCA === 7 ? "default" : "outline"} size="sm" className="cursor-pointer" onClick={() => setPeriodeCA(7)}>
                    7 jours
                  </Button>
                  <Button variant={periodeCA === 30 ? "default" : "outline"} size="sm" className="cursor-pointer" onClick={() => setPeriodeCA(30)}>
                    30 jours
                  </Button>
                </div>
              </div>
              <Card className="p-4">
                <EvolutionCaChart points={evolutionCA} />
              </Card>
            </div>
          )}

          {peutPiloter && (
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Card className="gap-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Encaissements du jour</p>
                {totalEncaisseJour === 0 && <p className="text-sm text-muted-foreground">Aucun encaissement aujourd'hui.</p>}
                {encaissements
                  .filter((v) => v.total > 0)
                  .map((v) => (
                    <div key={v.mode} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{LIBELLE_MODE_PAIEMENT[v.mode]}</span>
                      <span className="tabular-nums font-medium text-card-foreground">{formateurFcfa.format(v.total)} FCFA</span>
                    </div>
                  ))}
                {totalEncaisseJour > 0 && (
                  <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums text-primary">{formateurFcfa.format(totalEncaisseJour)} FCFA</span>
                  </div>
                )}
              </Card>

              <Card className="gap-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">État des stocks</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Valorisation (coût de revient)</span>
                  <span className="tabular-nums font-medium text-card-foreground">
                    {valorisationStock !== null ? `${formateurFcfa.format(valorisationStock)} FCFA` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Produits en rupture</span>
                  <span className="tabular-nums font-medium text-card-foreground">{alertesStock.length}</span>
                </div>
              </Card>
            </div>
          )}

          {peutPiloter && commissionsCanalplus.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-3 font-heading text-lg font-semibold text-foreground">Commissions CANAL+ en cours</h2>
              <ul className="space-y-2">
                {commissionsCanalplus.map((c) => (
                  <li key={c.commission.idSuivi}>
                    <Card className="flex-row items-center justify-between gap-3 p-3">
                      <div>
                        <p className="font-medium text-card-foreground">
                          {c.abonne.prenom} {c.abonne.nom}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Abonnement n° {c.commission.numeroAbonnement} · fin probatoire {formateurDateCourte.format(new Date(c.commission.dateFinProbatoire))}
                        </p>
                      </div>
                      <span className="tabular-nums font-medium text-primary">{formateurFcfa.format(c.commission.montantCommission)} FCFA</span>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">Abonnements à échéance</h2>

          {alertes === null && <p className="text-sm text-muted-foreground">Chargement…</p>}

          {alertes !== null && alertesTriees.length === 0 && (
            <Card className="items-center gap-2 p-8 text-center">
              <p className="font-medium text-card-foreground">Aucune échéance à traiter.</p>
              <p className="text-sm text-muted-foreground">Les abonnements proches de l'échéance apparaîtront ici automatiquement.</p>
            </Card>
          )}

          <ul className="space-y-2">
            {alertesTriees.map((alerte) => (
              <li key={alerte.numeroAbonnement}>
                <Card className="flex-row items-center justify-between gap-4 p-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                        STYLE_JALON[alerte.rang]
                      )}
                    >
                      <AlertTriangle className="size-3.5" aria-hidden="true" />
                      J-{alerte.jalon}
                    </span>
                    <div>
                      <p className="font-medium text-card-foreground">
                        {alerte.abonne.prenom} {alerte.abonne.nom}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {libelleJalon(alerte.jalon)} · {alerte.formule.libelle} · {alerte.abonne.telephone}
                      </p>
                    </div>
                  </div>
                  <Button className="shrink-0 cursor-pointer" onClick={() => onReabonnerDepuisAlerte(alerte)}>
                    Réabonner
                  </Button>
                </Card>
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-semibold text-foreground">Abonnements expirés</h2>
              <Select
                value={idFamilleFiltre !== null ? String(idFamilleFiltre) : "toutes"}
                onValueChange={(v) => setIdFamilleFiltre(v === "toutes" ? null : Number(v))}
              >
                <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filtrer par famille">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="toutes">Toutes les familles</SelectItem>
                  {familles.map((f) => (
                    <SelectItem key={f.idFamille} value={String(f.idFamille)}>
                      {f.libelle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {abonnementsExpires.length === 0 && (
              <Card className="items-center gap-2 p-8 text-center">
                <p className="font-medium text-card-foreground">Aucun abonnement expiré à reconquérir.</p>
              </Card>
            )}

            <ul className="space-y-2">
              {abonnementsExpires.map((a) => (
                <li key={a.numeroAbonnement}>
                  <Card className="flex-row items-center justify-between gap-4 p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        <History className="size-3.5" aria-hidden="true" />
                        Expiré depuis {a.joursDepuisExpiration} j
                      </span>
                      <div>
                        <p className="font-medium text-card-foreground">
                          {a.abonne.prenom} {a.abonne.nom}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {a.formule.libelle} · {a.abonne.telephone}
                        </p>
                      </div>
                    </div>
                    <Button className="shrink-0 cursor-pointer" onClick={() => onReabonnerDepuisExpire(a)}>
                      Réabonner
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          </div>

          {alertesStock.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-4 font-heading text-xl font-semibold text-foreground">Alertes de rupture de stock</h2>
              <ul className="space-y-2">
                {alertesStock.map((p) => (
                  <li key={p.idProduit}>
                    <Card className="flex-row items-center gap-3 p-4">
                      <span className="flex items-center gap-1.5 rounded-full bg-alert-j1-bg px-2.5 py-1 text-xs font-semibold text-alert-j1-fg">
                        <PackageX className="size-3.5" aria-hidden="true" />
                        Rupture
                      </span>
                      <div>
                        <p className="font-medium text-card-foreground">{p.libelle}</p>
                        <p className="text-sm text-muted-foreground">
                          {p.quantiteStock} en stock · seuil {p.seuilAlerte}
                        </p>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
