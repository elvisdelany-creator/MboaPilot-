import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { jourDouala, nomFichierEtat, raccourcisPeriode, type EtatImprimable } from "@mboapilot/shared";
import { chargerEtatVentes, ErreurAuthentification, telechargerEtatVentes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { EtatImprime } from "./EtatImprime";

interface Props {
  onNaviguer: (vue: Vue) => void;
}

// À l'impression, seule la feuille de l'état reste : la navigation et les boutons disparaissent, la page redevient un document A4 qui se
// continue sur autant de pages que nécessaire.
const STYLE_IMPRESSION = `@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body { background: white; }
  .etats-page { display: block !important; height: auto !important; }
  .etats-page header:not(.etat-entete), .etats-page .no-print { display: none !important; }
  .etats-page main { overflow: visible !important; height: auto !important; padding: 0 !important; }
}`;

// 8.6, 9.3 : états de gestion (Administrateur, Gérant, Comptable). Premier état : l'état des ventes d'une période, à l'écran, imprimé en A4, en PDF
// ou en CSV. Les jours sont ceux de Douala.
export function EtatsPage({ onNaviguer }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const raccourcis = raccourcisPeriode(jourDouala());
  const [periode, setPeriode] = useState(() => raccourcis.find((r) => r.cle === "mois")!.periode);
  const [etat, setEtat] = useState<EtatImprimable | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<"pdf" | "csv" | null>(null);

  const periodeComplete = periode.du !== "" && periode.au !== "";

  useEffect(() => {
    setEtat(null);
    setErreur(null);
    if (!periodeComplete) return;
    // le serveur juge la période (inversée, trop longue) : son message est montré tel quel, sous les dates
    let abandonne = false;
    const identifiant = setTimeout(() => {
      chargerEtatVentes(token, periode.du, periode.au)
        .then((e) => !abandonne && setEtat(e))
        .catch((e) => {
          if (abandonne) return;
          if (e instanceof ErreurAuthentification) {
            toast.error("Session expirée — veuillez vous reconnecter.");
            deconnecter();
            return;
          }
          setErreur(e instanceof Error ? e.message : "Impossible de calculer l'état.");
        });
    }, 250);
    return () => {
      abandonne = true;
      clearTimeout(identifiant);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, periode.du, periode.au]);

  async function telecharger(format: "pdf" | "csv") {
    setEnCours(format);
    try {
      const { blob, nomFichier } = await telechargerEtatVentes(token, format, periode.du, periode.au);
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = etat ? nomFichierEtat(etat, format) : nomFichier;
      lien.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(e instanceof Error ? e.message : "Échec du téléchargement.");
    } finally {
      setEnCours(null);
    }
  }

  const peutAgir = etat !== null && erreur === null && enCours === null;

  return (
    <div className="etats-page flex h-dvh flex-col bg-background">
      <style>{STYLE_IMPRESSION}</style>
      <AppHeader vueActive="etats" onNaviguer={onNaviguer} />

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="no-print mx-auto mb-6 w-full max-w-4xl space-y-4">
          <div>
            <h1 className="font-heading text-lg font-semibold text-foreground">États de gestion</h1>
            <p className="text-sm text-muted-foreground">État des ventes d'une période : à imprimer, en PDF, ou en CSV pour Excel. Les jours sont ceux de Douala.</p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="etat-du">Du</Label>
              <Input id="etat-du" type="date" value={periode.du} onChange={(e) => setPeriode((p) => ({ ...p, du: e.target.value }))} className="mt-1 h-10 w-40" />
            </div>
            <div>
              <Label htmlFor="etat-au">Au (inclus)</Label>
              <Input id="etat-au" type="date" value={periode.au} onChange={(e) => setPeriode((p) => ({ ...p, au: e.target.value }))} className="mt-1 h-10 w-40" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Périodes usuelles">
            {raccourcis.map((r) => {
              const actif = r.periode.du === periode.du && r.periode.au === periode.au;
              return (
                <Button
                  key={r.cle}
                  variant={actif ? "default" : "outline"}
                  size="sm"
                  aria-pressed={actif}
                  className={cn("min-h-11 cursor-pointer sm:min-h-9")}
                  onClick={() => setPeriode(r.periode)}
                >
                  {r.libelle}
                </Button>
              );
            })}
          </div>

          {erreur !== null && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {erreur}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11 cursor-pointer gap-2 sm:min-h-9" disabled={!peutAgir} onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimer
            </Button>
            <Button variant="outline" className="min-h-11 cursor-pointer gap-2 sm:min-h-9" disabled={!peutAgir} onClick={() => telecharger("pdf")}>
              <FileDown className="size-4" aria-hidden="true" />
              {enCours === "pdf" ? "Préparation…" : "Télécharger le PDF"}
            </Button>
            <Button variant="outline" className="min-h-11 cursor-pointer gap-2 sm:min-h-9" disabled={!peutAgir} onClick={() => telecharger("csv")}>
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              {enCours === "csv" ? "Préparation…" : "Télécharger le CSV"}
            </Button>
          </div>
        </div>

        {etat === null && erreur === null && periodeComplete && <p className="no-print mx-auto max-w-4xl text-sm text-muted-foreground">Calcul de l'état…</p>}
        {etat !== null && erreur === null && <EtatImprime etat={etat} />}
      </main>
    </div>
  );
}
