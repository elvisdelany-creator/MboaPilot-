export type ReglePrixKit = "PRIX_FIXE" | "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" | "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";

export interface FormuleReference {
  idFormule: number;
  prix: number;
}

export interface KitPrixFixe {
  reglePrix: "PRIX_FIXE";
  prixFixe: number;
}

export interface KitDecodeurVariable {
  reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE";
  prixParaboleAccessoires: number;
  prixDecodeurParFormule: Record<number, number>;
}

export interface KitDifferentiel {
  reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";
  prixKitReference: number;
  formuleReference: FormuleReference;
}

export type Kit = KitPrixFixe | KitDecodeurVariable | KitDifferentiel;

// 5.1.1 : les kits à décodeur variable ou à différentiel embarquent leur
// formule de départ ("prix_kit = ... + prix_formule_choisie") ; un kit à
// PRIX_FIXE (StarTimes, 24H Sport, Moreplex) a un prix qui "n'évolue pas avec
// la formule" et ne l'embarque donc pas.
export function kitEmbarqueFormule(kit: Kit): boolean {
  return kit.reglePrix !== "PRIX_FIXE";
}

// Part du prix du kit à facturer EN PLUS de la ligne formule : le matériel
// seul, pour que formule + kit ne compte jamais la formule deux fois.
export function calculerPrixKitHorsFormule(kit: Kit, formuleChoisie: FormuleReference): number {
  const prixKit = calculerPrixKit(kit, formuleChoisie);
  return kitEmbarqueFormule(kit) ? prixKit - formuleChoisie.prix : prixKit;
}

// 5.1.1 : le prix d'un kit dépend de la formule choisie selon la règle du kit
export function calculerPrixKit(kit: Kit, formuleChoisie: FormuleReference): number {
  switch (kit.reglePrix) {
    case "PRIX_FIXE":
      return kit.prixFixe;
    case "PRIX_DECODEUR_VARIABLE_SELON_FORMULE": {
      const prixDecodeur = kit.prixDecodeurParFormule[formuleChoisie.idFormule];
      if (prixDecodeur === undefined) {
        throw new Error(`Prix décodeur non configuré pour la formule ${formuleChoisie.idFormule}`);
      }
      return prixDecodeur + kit.prixParaboleAccessoires + formuleChoisie.prix;
    }
    case "PRIX_KIT_FIXE_PAR_DIFFERENTIEL":
      return kit.prixKitReference + (formuleChoisie.prix - kit.formuleReference.prix);
  }
}
