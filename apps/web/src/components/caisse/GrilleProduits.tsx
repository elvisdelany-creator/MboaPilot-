import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { filtrerArticles, resoudreEntreeRecherche } from "@mboapilot/shared";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { Produit } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  produits: Produit[];
  onAjouter: (produit: Produit) => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 5.2, 5.3, 9.2 : grille des produits physiques et services, hors catalogue
// d'abonnement — un clic ajoute une unité au panier (7.2, GrilleArticles)
export function GrilleProduits({ produits, onAjouter }: Props) {
  // 5.2, 9.2 : "recherche unifiée article/abonné" — filtre par libellé ou
  // code interne/code-barres ; une scanette termine sa frappe par Entrée,
  // ce qui ajoute directement l'article au ticket sur une correspondance exacte.
  const [recherche, setRecherche] = useState("");
  const champRecherche = useRef<HTMLInputElement>(null);
  const produitsFiltres = filtrerArticles(produits, recherche);

  // Poste avec souris et clavier : le champ est prêt à recevoir la scanette dès l'ouverture de la grille, sans clic préalable.
  // Sur tablette tactile, on ne le prend pas : cela ferait surgir le clavier à l'écran par-dessus la grille.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) champRecherche.current?.focus();
  }, []);

  function surEntree(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const entree = resoudreEntreeRecherche(produits, recherche);
    if (entree.action === "ajouter") {
      onAjouter(entree.article);
      setRecherche("");
    } else if (entree.action === "inconnu") {
      // un code inconnu ne doit pas rester dans le champ : le code suivant s'y collerait et ne correspondrait plus à rien
      toast.error(`Aucun article ne correspond à « ${entree.saisie} »`);
      setRecherche("");
    }
  }

  const biens = produitsFiltres.filter((p) => p.type === "BIEN");
  const services = produitsFiltres.filter((p) => p.type === "SERVICE");

  if (produits.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Aucun produit ou service dans le catalogue de ce site.
      </div>
    );
  }

  function grille(titre: string, articles: Produit[]) {
    if (articles.length === 0) return null;
    return (
      <section aria-labelledby={`titre-${titre}`} className="mt-6 first:mt-0">
        <h2 id={`titre-${titre}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {titre}
        </h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {articles.map((produit) => (
            <Card
              key={produit.idProduit}
              role="button"
              tabIndex={0}
              onClick={() => onAjouter(produit)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onAjouter(produit);
              }}
              aria-disabled={produit.suiviStock === 1 && produit.quantiteStock <= 0 ? true : undefined}
              className={cn("relative min-h-20 cursor-pointer justify-center gap-1 border-2 border-transparent p-4 text-center transition-colors hover:border-border", produit.suiviStock === 1 && produit.quantiteStock <= 0 && "opacity-60")}
            >
              {produit.suiviStock === 1 && (
                <Badge variant={produit.quantiteStock > 0 ? "secondary" : "destructive"} className="absolute -top-2 left-1/2 -translate-x-1/2">
                  {produit.quantiteStock > 0 ? `${produit.quantiteStock} en stock` : "Rupture"}
                </Badge>
              )}
              <span className="font-heading font-semibold text-card-foreground">{produit.libelle}</span>
              <span className="text-lg font-semibold tabular-nums text-primary">{formateurFcfa.format(produit.prixVente)} FCFA</span>
            </Card>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <Input
        ref={champRecherche}
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        onKeyDown={surEntree}
        placeholder="Rechercher un article (libellé ou code-barres)…"
        aria-label="Rechercher un article"
        className="mb-4"
      />
      {produitsFiltres.length === 0 && (
        <p className="text-center text-muted-foreground">Aucun article ne correspond à « {recherche} ».</p>
      )}
      {grille("Produits", biens)}
      {grille("Services", services)}
    </div>
  );
}
