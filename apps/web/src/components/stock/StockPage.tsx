import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Package } from "lucide-react";
import { chargerAlertesStock, chargerMouvementsProduit, chargerProduits, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ReceptionAchatDialog } from "./ReceptionAchatDialog";
import { CasseDialog } from "./CasseDialog";
import { AjusterInventaireDialog } from "./AjusterInventaireDialog";
import type { Produit, StockMouvement, TypeMouvementStock } from "@/lib/types";

interface Props {
  onNaviguer: (vue: Vue) => void;
}

const LIBELLE_MOUVEMENT: Record<TypeMouvementStock, string> = {
  ACHAT: "Réception d'achat",
  VENTE: "Vente",
  CASSE: "Casse / perte",
  TRANSFERT_ENTREE: "Transfert entrant",
  TRANSFERT_SORTIE: "Transfert sortant",
  INVENTAIRE: "Ajustement d'inventaire",
};

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

// 5.2, 8.6, 9.3 : suivi de stock — niveaux, seuils d'alerte, historique des
// mouvements, et les trois actions correctives (achat, casse, inventaire).
export function StockPage({ onNaviguer }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const siteId = session!.utilisateur.siteId;

  const [produits, setProduits] = useState<Produit[] | null>(null);
  const [alertes, setAlertes] = useState<Produit[]>([]);
  const [idSelectionne, setIdSelectionne] = useState<number | null>(null);
  const [mouvements, setMouvements] = useState<StockMouvement[]>([]);
  const [dialogueOuvert, setDialogueOuvert] = useState<"achat" | "casse" | "inventaire" | null>(null);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function rechargerListe() {
    chargerProduits(token, siteId)
      .then((data) => setProduits(data.filter((p) => p.suiviStock === 1)))
      .catch((e) => gererErreur(e, "Impossible de charger les produits."));
    chargerAlertesStock(token, siteId)
      .then(setAlertes)
      .catch(() => setAlertes([]));
  }

  function rechargerMouvements(idProduit: number) {
    chargerMouvementsProduit(token, idProduit)
      .then(setMouvements)
      .catch((e) => gererErreur(e, "Impossible de charger l'historique des mouvements."));
  }

  useEffect(rechargerListe, [token, siteId]);

  useEffect(() => {
    if (idSelectionne !== null) rechargerMouvements(idSelectionne);
    else setMouvements([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSelectionne]);

  const produitSelectionne = produits?.find((p) => p.idProduit === idSelectionne) ?? null;
  const idsEnAlerte = new Set(alertes.map((p) => p.idProduit));

  function onActionReussie() {
    setDialogueOuvert(null);
    rechargerListe();
    if (idSelectionne !== null) rechargerMouvements(idSelectionne);
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader vueActive="stock" onNaviguer={onNaviguer} />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-80 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-4">
            <h1 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">Stock</h1>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {produits?.length === 0 && <li className="p-4 text-sm text-muted-foreground">Aucun produit suivi en stock.</li>}
            {produits?.map((p) => (
              <li key={p.idProduit}>
                <button
                  type="button"
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 border-b border-border px-4 py-3 text-left hover:bg-muted ${idSelectionne === p.idProduit ? "bg-muted" : ""}`}
                  onClick={() => setIdSelectionne(p.idProduit)}
                >
                  <div>
                    <p className="font-medium text-foreground">{p.libelle}</p>
                    <p className="text-sm text-muted-foreground">{p.quantiteStock} en stock</p>
                  </div>
                  {idsEnAlerte.has(p.idProduit) && (
                    <Badge variant="destructive" className="shrink-0 gap-1">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      Rupture
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!produitSelectionne && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Package className="mx-auto mb-2 size-8" />
                Sélectionnez un produit pour voir son détail.
              </div>
            </div>
          )}

          {produitSelectionne && (
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-heading text-lg font-semibold text-foreground">{produitSelectionne.libelle}</h2>
                  <p className="text-sm text-muted-foreground">Coût de revient moyen : {formateurFcfa.format(produitSelectionne.coutRevient)} FCFA</p>
                </div>
                {idsEnAlerte.has(produitSelectionne.idProduit) && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="size-3" aria-hidden="true" />
                    Sous le seuil d'alerte
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Card className="gap-1 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quantité en stock</p>
                  <p className="text-xl font-semibold tabular-nums text-card-foreground">{produitSelectionne.quantiteStock}</p>
                </Card>
                <Card className="gap-1 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Seuil d'alerte</p>
                  <p className="text-xl font-semibold tabular-nums text-card-foreground">{produitSelectionne.seuilAlerte ?? "—"}</p>
                </Card>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="cursor-pointer" onClick={() => setDialogueOuvert("achat")}>
                  Réceptionner un achat
                </Button>
                <Button variant="outline" className="cursor-pointer" onClick={() => setDialogueOuvert("casse")}>
                  Casse / perte
                </Button>
                <Button variant="outline" className="cursor-pointer" onClick={() => setDialogueOuvert("inventaire")}>
                  Ajuster l'inventaire
                </Button>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historique des mouvements</p>
                {mouvements.length === 0 && <p className="text-sm text-muted-foreground">Aucun mouvement enregistré.</p>}
                <ul className="space-y-1 text-sm">
                  {mouvements.map((m) => (
                    <li key={m.idMouvement} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {formateurDate.format(new Date(m.dateMouvement))} — {LIBELLE_MOUVEMENT[m.typeMouvement]}
                        {m.motif ? ` (${m.motif})` : ""}
                      </span>
                      <span className="shrink-0 tabular-nums font-medium text-card-foreground">
                        {m.typeMouvement === "INVENTAIRE" ? (m.quantite > 0 ? `+${m.quantite}` : m.quantite) : m.quantite}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <ReceptionAchatDialog produit={dialogueOuvert === "achat" ? produitSelectionne : null} onFerme={() => setDialogueOuvert(null)} onSucces={onActionReussie} />
      <CasseDialog produit={dialogueOuvert === "casse" ? produitSelectionne : null} onFerme={() => setDialogueOuvert(null)} onSucces={onActionReussie} />
      <AjusterInventaireDialog produit={dialogueOuvert === "inventaire" ? produitSelectionne : null} onFerme={() => setDialogueOuvert(null)} onSucces={onActionReussie} />
    </div>
  );
}
