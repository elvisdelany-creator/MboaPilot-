import { calculerPrixKit } from "@mboapilot/shared";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CatalogueFamille, Formule } from "@/lib/types";

interface Props {
  famille: CatalogueFamille | undefined;
  formuleSelectionnee: Formule | null;
  idKitSelectionne: number | null;
  idFormuleActuelle: number | null;
  masquerKits: boolean;
  onSelectionnerFormule: (formule: Formule) => void;
  onSelectionnerKit: (idKit: number | null) => void;
}

const formateurFcfa = new Intl.NumberFormat("fr-FR");

// 9.2 : grille centrale — formules, options et kits, prix affiché en temps réel
// (y compris le prix de kit dynamique, 5.1.1). En réabonnement (7.2), les kits
// sont masqués : le matériel ne se change pas ici (échange de matériel, 7.3).
export function GrilleArticles({
  famille,
  formuleSelectionnee,
  idKitSelectionne,
  idFormuleActuelle,
  masquerKits,
  onSelectionnerFormule,
  onSelectionnerKit,
}: Props) {
  if (!famille) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Sélectionnez une catégorie à gauche.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <section aria-labelledby="titre-formules">
        <h2 id="titre-formules" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Formules
        </h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {famille.formules.map((formule) => {
            const actif = formule.idFormule === formuleSelectionnee?.idFormule;
            const estFormuleActuelle = formule.idFormule === idFormuleActuelle;
            return (
              <Card
                key={formule.idFormule}
                role="button"
                tabIndex={0}
                onClick={() => onSelectionnerFormule(formule)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelectionnerFormule(formule);
                }}
                className={cn(
                  "relative min-h-20 cursor-pointer justify-center gap-1 border-2 p-4 text-center transition-colors",
                  actif ? "border-primary bg-primary/5" : "border-transparent hover:border-border"
                )}
                aria-pressed={actif}
              >
                {estFormuleActuelle && (
                  <Badge variant="secondary" className="absolute -top-2 left-1/2 -translate-x-1/2">
                    Formule actuelle
                  </Badge>
                )}
                <span className="font-heading font-semibold text-card-foreground">{formule.libelle}</span>
                <span className="text-lg font-semibold tabular-nums text-primary">
                  {formateurFcfa.format(formule.prix)} FCFA
                </span>
              </Card>
            );
          })}
        </div>
      </section>

      {!masquerKits && famille.kits.length > 0 && (
        <section aria-labelledby="titre-kits" className="mt-6">
          <h2 id="titre-kits" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Kits matériel
          </h2>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {famille.kits.map((kit) => {
              const actif = kit.idKit === idKitSelectionne;
              const prix = formuleSelectionnee ? calculerPrixKit(kit, { idFormule: formuleSelectionnee.idFormule, prix: formuleSelectionnee.prix }) : null;
              return (
                <Card
                  key={kit.idKit}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectionnerKit(actif ? null : kit.idKit)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelectionnerKit(actif ? null : kit.idKit);
                  }}
                  className={cn(
                    "min-h-20 cursor-pointer justify-center gap-1 border-2 p-4 text-center transition-colors",
                    actif ? "border-accent bg-accent/5" : "border-transparent hover:border-border"
                  )}
                  aria-pressed={actif}
                >
                  <span className="font-heading font-semibold text-card-foreground">{kit.libelle}</span>
                  <span className="text-lg font-semibold tabular-nums text-accent">
                    {prix !== null ? `${formateurFcfa.format(prix)} FCFA` : "Choisir une formule"}
                  </span>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
