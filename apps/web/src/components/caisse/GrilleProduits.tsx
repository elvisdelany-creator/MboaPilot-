import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Produit } from "@/lib/types";

interface Props {
  produits: Produit[];
  onAjouter: (produit: Produit) => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 5.2, 5.3, 9.2 : grille des produits physiques et services, hors catalogue
// d'abonnement — un clic ajoute une unité au panier (7.2, GrilleArticles)
export function GrilleProduits({ produits, onAjouter }: Props) {
  const biens = produits.filter((p) => p.type === "BIEN");
  const services = produits.filter((p) => p.type === "SERVICE");

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
              className="relative min-h-20 cursor-pointer justify-center gap-1 border-2 border-transparent p-4 text-center transition-colors hover:border-border"
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
      {grille("Produits", biens)}
      {grille("Services", services)}
    </div>
  );
}
