import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, Package, Pencil, Plus, Upload } from "lucide-react";
import {
  chargerAlertesStock,
  chargerHistoriquePrixProduit,
  chargerMouvementsProduit,
  chargerProduits,
  exporterCatalogueCsvRequete,
  importerCatalogueCsvRequete,
  ErreurAuthentification,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ReceptionAchatDialog } from "./ReceptionAchatDialog";
import { CasseDialog } from "./CasseDialog";
import { AjusterInventaireDialog } from "./AjusterInventaireDialog";
import { TransfererStockDialog } from "./TransfererStockDialog";
import { ArticleDialog } from "./ArticleDialog";
import type { HistoriquePrixProduit, Produit, StockMouvement, TypeMouvementStock, TypeProduit } from "@/lib/types";

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
  RETOUR_CLIENT: "Retour client (avoir)",
};

const LIBELLE_TYPE: Record<TypeProduit, string> = {
  BIEN: "Bien physique",
  SERVICE: "Service",
  SAV: "Article SAV",
  KIT: "Kit composé",
};

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const formateurDateCourte = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });

// 5.2, 8.2, 8.6, 9.3 : catalogue — création/édition des fiches article, suivi
// de stock (niveaux, seuils, mouvements) et historique des variations de prix.
export function StockPage({ onNaviguer }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;
  const siteId = utilisateur.siteId;

  const [produits, setProduits] = useState<Produit[] | null>(null);
  const [alertes, setAlertes] = useState<Produit[]>([]);
  const [idSelectionne, setIdSelectionne] = useState<number | null>(null);
  const [mouvements, setMouvements] = useState<StockMouvement[]>([]);
  const [historiquePrix, setHistoriquePrix] = useState<HistoriquePrixProduit[]>([]);
  const [dialogueOuvert, setDialogueOuvert] = useState<"achat" | "casse" | "inventaire" | "transfert" | null>(null);
  const [articleDialogueOuvert, setArticleDialogueOuvert] = useState<"creation" | "edition" | null>(null);
  const [importEnCours, setImportEnCours] = useState(false);
  const inputFichierRef = useRef<HTMLInputElement>(null);

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
      .then(setProduits)
      .catch((e) => gererErreur(e, "Impossible de charger les produits."));
    chargerAlertesStock(token, siteId)
      .then(setAlertes)
      .catch(() => setAlertes([]));
  }

  function rechargerDetail(idProduit: number) {
    chargerMouvementsProduit(token, idProduit)
      .then(setMouvements)
      .catch((e) => gererErreur(e, "Impossible de charger l'historique des mouvements."));
    chargerHistoriquePrixProduit(token, idProduit)
      .then(setHistoriquePrix)
      .catch(() => setHistoriquePrix([]));
  }

  useEffect(rechargerListe, [token, siteId]);

  useEffect(() => {
    if (idSelectionne !== null) rechargerDetail(idSelectionne);
    else {
      setMouvements([]);
      setHistoriquePrix([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSelectionne]);

  const produitSelectionne = produits?.find((p) => p.idProduit === idSelectionne) ?? null;
  const idsEnAlerte = new Set(alertes.map((p) => p.idProduit));

  function onActionReussie() {
    setDialogueOuvert(null);
    rechargerListe();
    if (idSelectionne !== null) rechargerDetail(idSelectionne);
  }

  function onArticleEnregistre() {
    setArticleDialogueOuvert(null);
    rechargerListe();
    if (idSelectionne !== null) rechargerDetail(idSelectionne);
  }

  // 8.2 : export du catalogue en CSV — pour édition tarifaire en masse dans un tableur, puis réimport
  async function exporterCsv() {
    try {
      const contenuCsv = await exporterCatalogueCsvRequete(token, siteId);
      const url = URL.createObjectURL(new Blob([contenuCsv], { type: "text/csv;charset=utf-8" }));
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = "catalogue.csv";
      lien.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      gererErreur(e, "Impossible d'exporter le catalogue.");
    }
  }

  async function importerCsv(fichier: File) {
    setImportEnCours(true);
    try {
      const contenuCsv = await fichier.text();
      const resultat = await importerCatalogueCsvRequete(token, { siteId, userId: utilisateur.idUser, contenuCsv });
      if (resultat.erreurs.length === 0) {
        toast.success(`Import réussi : ${resultat.crees} créé(s), ${resultat.misAJour} mis à jour.`);
      } else {
        toast.warning(
          `Import partiel : ${resultat.crees} créé(s), ${resultat.misAJour} mis à jour, ${resultat.erreurs.length} ligne(s) ignorée(s).`,
          { description: resultat.erreurs.slice(0, 5).map((e) => `Ligne ${e.ligne} : ${e.message}`).join("\n") }
        );
      }
      rechargerListe();
    } catch (e) {
      gererErreur(e, "Échec de l'import du catalogue.");
    } finally {
      setImportEnCours(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader vueActive="stock" onNaviguer={onNaviguer} />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-80 shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h1 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">Catalogue</h1>
            <Button size="sm" className="cursor-pointer gap-1" onClick={() => setArticleDialogueOuvert("creation")}>
              <Plus className="size-4" />
              Nouvel article
            </Button>
          </div>

          {/* 8.2 : import/export CSV — initialisation et mises à jour tarifaires en masse */}
          <div className="flex items-center gap-2 border-b border-border p-3">
            <Button variant="outline" size="sm" className="cursor-pointer gap-1" onClick={exporterCsv}>
              <Download className="size-3.5" />
              Exporter CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1"
              disabled={importEnCours}
              onClick={() => inputFichierRef.current?.click()}
            >
              <Upload className="size-3.5" />
              {importEnCours ? "Import…" : "Importer CSV"}
            </Button>
            <input
              ref={inputFichierRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                e.target.value = "";
                if (fichier) importerCsv(fichier);
              }}
            />
          </div>
          <ul className="flex-1 overflow-y-auto">
            {produits?.length === 0 && <li className="p-4 text-sm text-muted-foreground">Aucun article dans le catalogue.</li>}
            {produits?.map((p) => (
              <li key={p.idProduit}>
                <button
                  type="button"
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 border-b border-border px-4 py-3 text-left hover:bg-muted ${idSelectionne === p.idProduit ? "bg-muted" : ""}`}
                  onClick={() => setIdSelectionne(p.idProduit)}
                >
                  <div>
                    <p className="font-medium text-foreground">{p.libelle}</p>
                    <p className="text-sm text-muted-foreground">
                      {LIBELLE_TYPE[p.type]}
                      {p.categorie ? ` · ${p.categorie}` : ""}
                      {p.suiviStock === 1 ? ` · ${p.quantiteStock} en stock` : ""}
                    </p>
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
                Sélectionnez un article pour voir son détail.
              </div>
            </div>
          )}

          {produitSelectionne && (
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-heading text-lg font-semibold text-foreground">{produitSelectionne.libelle}</h2>
                  <p className="text-sm text-muted-foreground">
                    {LIBELLE_TYPE[produitSelectionne.type]}
                    {produitSelectionne.categorie ? ` · ${produitSelectionne.categorie}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {idsEnAlerte.has(produitSelectionne.idProduit) && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      Sous le seuil d'alerte
                    </Badge>
                  )}
                  <Button variant="outline" size="sm" className="cursor-pointer gap-1" onClick={() => setArticleDialogueOuvert("edition")}>
                    <Pencil className="size-3.5" />
                    Modifier
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Card className="gap-1 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prix de vente</p>
                  <p className="text-xl font-semibold tabular-nums text-card-foreground">{formateurFcfa.format(produitSelectionne.prixVente)} FCFA</p>
                </Card>
                <Card className="gap-1 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Coût de revient</p>
                  <p className="text-xl font-semibold tabular-nums text-card-foreground">{formateurFcfa.format(produitSelectionne.coutRevient)} FCFA</p>
                </Card>
                <Card className="gap-1 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marge</p>
                  <p className="text-xl font-semibold tabular-nums text-card-foreground">
                    {formateurFcfa.format(produitSelectionne.margeValeur ?? 0)} FCFA
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      ({((produitSelectionne.margePourcentage ?? 0) / 100).toFixed(2)} %)
                    </span>
                  </p>
                </Card>
                {produitSelectionne.suiviStock === 1 && (
                  <>
                    <Card className="gap-1 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quantité en stock</p>
                      <p className="text-xl font-semibold tabular-nums text-card-foreground">{produitSelectionne.quantiteStock}</p>
                    </Card>
                    <Card className="gap-1 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Seuil d'alerte</p>
                      <p className="text-xl font-semibold tabular-nums text-card-foreground">{produitSelectionne.seuilAlerte ?? "—"}</p>
                    </Card>
                  </>
                )}
              </div>

              {produitSelectionne.suiviStock === 1 && (
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
                  <Button variant="outline" className="cursor-pointer" onClick={() => setDialogueOuvert("transfert")}>
                    Transférer vers un autre site
                  </Button>
                </div>
              )}

              {produitSelectionne.suiviStock === 1 && (
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
              )}

              <Separator />

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historique des prix</p>
                {historiquePrix.length === 0 && <p className="text-sm text-muted-foreground">Aucune variation de prix enregistrée.</p>}
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {historiquePrix.map((h) => (
                    <li key={h.idHistoPrix}>
                      {formateurDateCourte.format(new Date(h.dateChangement))} — prix {formateurFcfa.format(h.prixVenteAvant)} → {formateurFcfa.format(h.prixVenteApres)} FCFA
                      {h.coutRevientAvant !== h.coutRevientApres &&
                        ` · coût ${formateurFcfa.format(h.coutRevientAvant)} → ${formateurFcfa.format(h.coutRevientApres)} FCFA`}
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
      <TransfererStockDialog produit={dialogueOuvert === "transfert" ? produitSelectionne : null} onFerme={() => setDialogueOuvert(null)} onSucces={onActionReussie} />
      <ArticleDialog
        ouvert={articleDialogueOuvert !== null}
        produit={articleDialogueOuvert === "edition" ? produitSelectionne : null}
        onFerme={() => setArticleDialogueOuvert(null)}
        onSucces={onArticleEnregistre}
      />
    </div>
  );
}
