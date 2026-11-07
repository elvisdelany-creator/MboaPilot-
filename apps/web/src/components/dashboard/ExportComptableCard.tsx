import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { jourDouala, periodeDuMois } from "@mboapilot/shared";
import { chargerApercuExportComptable, ErreurAuthentification, exporterJournalComptableRequete, type ApercuExportComptable, type JournalComptable } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// bornes d'un mois, sans dépasser aujourd'hui pour le mois en cours (une fin au 30 pour un 7 du mois ne sert à personne)
function moisJusquAujourdhui(decalage: number) {
  const aujourdHui = jourDouala();
  const { du, au } = periodeDuMois(aujourdHui, decalage);
  return { du, au: au > aujourdHui ? aujourdHui : au };
}

// Export comptable (offre Pro) : le comptable clôture le mois avec deux journaux CSV pour Excel français — ventes (TVA figée à la vente)
// et encaissements (banque, référence, rapprochement). L'aperçu donne les totaux avant de télécharger, à comparer aux siens.
export function ExportComptableCard() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [periode, setPeriode] = useState(() => moisJusquAujourdhui(-1));
  const [apercu, setApercu] = useState<ApercuExportComptable | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<JournalComptable | null>(null);

  const periodeComplete = periode.du !== "" && periode.au !== "";

  useEffect(() => {
    setApercu(null);
    setErreur(null);
    if (!periodeComplete) return;
    // le serveur juge la période (inversée, trop longue) : son message est montré tel quel, sous les dates
    let abandonne = false;
    const identifiant = setTimeout(() => {
      chargerApercuExportComptable(token, periode.du, periode.au)
        .then((a) => !abandonne && setApercu(a))
        .catch((e) => {
          if (abandonne) return;
          if (e instanceof ErreurAuthentification) {
            toast.error("Session expirée — veuillez vous reconnecter.");
            deconnecter();
            return;
          }
          setErreur(e instanceof Error ? e.message : "Impossible de calculer l'aperçu.");
        });
    }, 250);
    return () => {
      abandonne = true;
      clearTimeout(identifiant);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, periode.du, periode.au]);

  async function telecharger(journal: JournalComptable) {
    setEnCours(journal);
    try {
      const { csv, nomFichier } = await exporterJournalComptableRequete(token, journal, periode.du, periode.au);
      // le BOM UTF-8 en tête : sans lui, Excel lit les accents comme du Windows-1252 (« CÃ¢ble »)
      const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nomFichier;
      lien.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(e instanceof Error ? e.message : "Échec de l'export.");
    } finally {
      setEnCours(null);
    }
  }

  const peutTelecharger = periodeComplete && erreur === null && enCours === null;

  return (
    <div className="mb-8">
      <h2 className="font-heading text-lg font-semibold text-foreground">Export comptable</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Deux fichiers pour Excel : le journal des ventes (TTC, TVA, HT, avoirs) et celui des encaissements (mode, banque, référence). Les jours sont ceux de Douala.
      </p>
      <Card className="gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="export-du">Du</Label>
            <Input id="export-du" type="date" value={periode.du} onChange={(e) => setPeriode((p) => ({ ...p, du: e.target.value }))} className="mt-1 h-10 w-40" />
          </div>
          <div>
            <Label htmlFor="export-au">Au (inclus)</Label>
            <Input id="export-au" type="date" value={periode.au} onChange={(e) => setPeriode((p) => ({ ...p, au: e.target.value }))} className="mt-1 h-10 w-40" />
          </div>
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setPeriode(moisJusquAujourdhui(0))}>
            Mois en cours
          </Button>
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setPeriode(moisJusquAujourdhui(-1))}>
            Mois dernier
          </Button>
        </div>

        {erreur !== null && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {erreur}
          </p>
        )}

        {apercu !== null && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-card-foreground">Ventes</dt>
              <dd className="text-muted-foreground tabular-nums">
                {apercu.ventes.nombre} facture{apercu.ventes.nombre > 1 ? "s" : ""} · {formateurFcfa.format(apercu.ventes.totalTtc)} FCFA TTC · dont {formateurFcfa.format(apercu.ventes.totalTva)} FCFA de TVA
              </dd>
            </div>
            <div>
              <dt className="font-medium text-card-foreground">Encaissements</dt>
              <dd className="text-muted-foreground tabular-nums">
                {apercu.encaissements.nombre} paiement{apercu.encaissements.nombre > 1 ? "s" : ""} · {formateurFcfa.format(apercu.encaissements.total)} FCFA
              </dd>
            </div>
          </dl>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="cursor-pointer gap-2" disabled={!peutTelecharger} onClick={() => telecharger("ventes")}>
            <Download className="size-4" aria-hidden="true" />
            {enCours === "ventes" ? "Export en cours…" : "Journal des ventes (CSV)"}
          </Button>
          <Button variant="outline" className="cursor-pointer gap-2" disabled={!peutTelecharger} onClick={() => telecharger("encaissements")}>
            <Download className="size-4" aria-hidden="true" />
            {enCours === "encaissements" ? "Export en cours…" : "Journal des encaissements (CSV)"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Les ventes en attente de paiement n'y figurent pas, comme dans le chiffre d'affaires. Un avoir apparaît en négatif, avec la facture qu'il corrige.
        </p>
      </Card>
    </div>
  );
}
