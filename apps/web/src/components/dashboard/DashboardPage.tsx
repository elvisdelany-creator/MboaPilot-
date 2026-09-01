import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, RotateCw } from "lucide-react";
import { chargerAlertesEcheance, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AlerteEcheance, JalonAlerte } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  onNaviguer: (vue: Vue) => void;
  onReabonnerDepuisAlerte: (alerte: AlerteEcheance) => void;
}

const ORDRE_URGENCE: Record<JalonAlerte, number> = { "J-1": 0, "J-3": 1, "J-7": 2 };

const STYLE_JALON: Record<JalonAlerte, string> = {
  "J-1": "bg-alert-j1-bg text-alert-j1-fg",
  "J-3": "bg-alert-j3-bg text-alert-j3-fg",
  "J-7": "bg-alert-j7-bg text-alert-j7-fg",
};

const LIBELLE_JALON: Record<JalonAlerte, string> = {
  "J-1": "Échéance demain",
  "J-3": "Échéance dans 3 jours",
  "J-7": "Échéance dans 7 jours",
};

// 9.3 : tableau de bord — liste priorisée des abonnements à échéance, triée
// par urgence (J-1 en premier), avec accès direct au réabonnement en un clic
export function DashboardPage({ onNaviguer, onReabonnerDepuisAlerte }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const siteId = session!.utilisateur.siteId;

  const [alertes, setAlertes] = useState<AlerteEcheance[] | null>(null);

  function charger() {
    chargerAlertesEcheance(token, siteId)
      .then(setAlertes)
      .catch((e) => {
        if (e instanceof ErreurAuthentification) {
          toast.error("Session expirée — veuillez vous reconnecter.");
          deconnecter();
          return;
        }
        toast.error(e instanceof Error ? e.message : "Impossible de charger les alertes.");
      });
  }

  useEffect(charger, [token, siteId]);

  const alertesTriees = useMemo(
    () => [...(alertes ?? [])].sort((a, b) => ORDRE_URGENCE[a.jalon] - ORDRE_URGENCE[b.jalon]),
    [alertes]
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader vueActive="dashboard" onNaviguer={onNaviguer} />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-heading text-xl font-semibold text-foreground">Abonnements à échéance</h1>
            <Button variant="outline" size="sm" className="cursor-pointer gap-2" onClick={charger}>
              <RotateCw className="size-4" />
              Actualiser
            </Button>
          </div>

          {alertes === null && <p className="text-sm text-muted-foreground">Chargement…</p>}

          {alertes !== null && alertesTriees.length === 0 && (
            <Card className="items-center gap-2 p-8 text-center">
              <p className="font-medium text-card-foreground">Aucune échéance à traiter.</p>
              <p className="text-sm text-muted-foreground">Les abonnements à J-7, J-3 ou J-1 apparaîtront ici automatiquement.</p>
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
                        STYLE_JALON[alerte.jalon]
                      )}
                    >
                      <AlertTriangle className="size-3.5" aria-hidden="true" />
                      {alerte.jalon}
                    </span>
                    <div>
                      <p className="font-medium text-card-foreground">
                        {alerte.abonne.prenom} {alerte.abonne.nom}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {LIBELLE_JALON[alerte.jalon]} · {alerte.formule.libelle} · {alerte.abonne.telephone}
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
        </div>
      </main>
    </div>
  );
}
