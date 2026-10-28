import { Tv, Package, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogueFamille } from "@/lib/types";

interface Props {
  familles: CatalogueFamille[];
  familleSelectionnee: number | null;
  modeProduits: boolean;
  onSelectionner: (idFamille: number) => void;
  onSelectionnerProduits: () => void;
}

// 5.1, 5.2, 5.3, 9.2 : accès direct aux familles du catalogue (produits,
// services, chaque opérateur TV, streaming/IPTV, SAV)
export function CategoriesPanel({ familles, familleSelectionnee, modeProduits, onSelectionner, onSelectionnerProduits }: Props) {
  return (
    <nav aria-label="Catégories du catalogue" className="flex w-full shrink-0 gap-1 overflow-x-auto p-3 md:w-44 md:flex-col md:overflow-x-visible md:overflow-y-auto lg:w-56">
      <button
        type="button"
        onClick={onSelectionnerProduits}
        className={cn(
          "flex min-h-11 shrink-0 cursor-pointer items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors md:whitespace-normal",
          modeProduits ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
        )}
        aria-pressed={modeProduits}
      >
        <ShoppingBag className="size-4 shrink-0" />
        Produits & Services
      </button>
      <div className="my-1 hidden border-t border-border md:block" />
      {familles.map((famille) => {
        const actif = !modeProduits && famille.idFamille === familleSelectionnee;
        return (
          <button
            key={famille.idFamille}
            type="button"
            onClick={() => onSelectionner(famille.idFamille)}
            className={cn(
              "flex min-h-11 shrink-0 cursor-pointer items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors md:whitespace-normal",
              actif
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            )}
            aria-pressed={actif}
          >
            {famille.libelle === "STREAMING" ? <Package className="size-4 shrink-0" /> : <Tv className="size-4 shrink-0" />}
            {famille.libelle}
          </button>
        );
      })}
      {familles.length === 0 && (
        <p className="px-3 py-2 text-sm text-muted-foreground">Catalogue vide.</p>
      )}
    </nav>
  );
}
