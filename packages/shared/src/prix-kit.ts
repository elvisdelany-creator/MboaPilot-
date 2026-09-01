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

// 5.1.1 : le prix d'un kit dépend de la formule choisie selon la règle du kit
export function calculerPrixKit(kit: Kit, formuleChoisie: FormuleReference): number {
  switch (kit.reglePrix) {
    case "PRIX_FIXE":
      return kit.prixFixe;
    case "PRIX_DECODEUR_VARIABLE_SELON_FORMULE": {
      const prixDecodeur = kit.prixDecodeurParFormule[formuleChoisie.idFormule];
      return prixDecodeur + kit.prixParaboleAccessoires + formuleChoisie.prix;
    }
    case "PRIX_KIT_FIXE_PAR_DIFFERENTIEL":
      return kit.prixKitReference + (formuleChoisie.prix - kit.formuleReference.prix);
  }
}
