import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { chargerVerificationFacture } from "@/lib/api";
import { Card } from "@/components/ui/card";
import type { VerificationFacture } from "@/lib/types";

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
const LIBELLE_STATUT_SAV: Record<string, string> = {
  RECU: "Reçu",
  DIAGNOSTIC: "Diagnostic en cours",
  DEVIS_ATTENTE: "En attente d'accord sur devis",
  REPARATION: "En réparation",
  PRET: "Prêt — à récupérer",
  LIVRE: "Livré",
  IRREPARABLE: "Irréparable",
  ABANDONNE: "Abandonné",
};

// 13.1 : "QR code de vérification sur factures et tickets... renvoyant vers
// la fiche numérique de la facture (authenticité, état du dossier SAV)" —
// page publique, accessible sans compte MboaPilot, atteinte via le chemin
// /verification/:idFacture/:jeton (voir App.tsx, en dehors du flux authentifié).
export function VerificationFacturePage() {
  const [resultat, setResultat] = useState<VerificationFacture | null>(null);
  const [erreur, setErreur] = useState(false);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const [, idFactureBrut, jeton] = segments; // ["verification", idFacture, jeton]
    const idFacture = Number(idFactureBrut);
    if (!idFacture || !jeton) {
      setErreur(true);
      setChargement(false);
      return;
    }
    chargerVerificationFacture(idFacture, jeton)
      .then(setResultat)
      .catch(() => setErreur(true))
      .finally(() => setChargement(false));
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm gap-4 p-6">
        {chargement && <p className="text-center text-sm text-muted-foreground">Vérification…</p>}

        {!chargement && erreur && (
          <div className="flex flex-col items-center gap-2 text-center">
            <XCircle className="size-10 text-destructive" aria-hidden="true" />
            <p className="font-heading text-lg font-semibold text-foreground">Document non authentifié</p>
            <p className="text-sm text-muted-foreground">Ce document ne correspond à aucune facture connue de MboaPilot.</p>
          </div>
        )}

        {!chargement && resultat && (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="size-10 text-primary" aria-hidden="true" />
              <p className="font-heading text-lg font-semibold text-foreground">Document authentique</p>
              <p className="text-sm text-muted-foreground">
                {resultat.facture.type === "AVOIR" ? "Avoir" : "Facture"} n° {resultat.facture.idFacture} — {resultat.entreprise.nom}
              </p>
            </div>

            <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Site</span>
                <span className="font-medium text-card-foreground">{resultat.site.nom}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Émise le</span>
                <span className="font-medium text-card-foreground">{formateurDateHeure.format(new Date(resultat.facture.dateCreation))}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Montant</span>
                <span className="font-medium text-card-foreground">
                  {formateurFcfa.format(resultat.facture.montantTotal)} {resultat.entreprise.devise}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Statut</span>
                <span className="font-medium text-card-foreground">{resultat.facture.statut === "VALIDEE" ? "Validée" : "Brouillon"}</span>
              </div>
            </div>

            {resultat.dossierSav && (
              <div className="rounded-lg border border-border p-4 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dossier SAV</p>
                <p className="font-medium text-card-foreground">{LIBELLE_STATUT_SAV[resultat.dossierSav.statut] ?? resultat.dossierSav.statut}</p>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
