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

// 5.1.1, 5.6 à 5.8 : le prix d'un kit couvre le matériel ET la première formule (« Décodeur + installation + formule GLOBAL »,
// « Décodeur + formule FULL 24H SPORT 3 MOIS »…). C'est vrai des kits à décodeur variable et à différentiel
// ("prix_kit = ... + prix_formule_choisie"), et aussi des kits à prix fixe : leur prix « n'évolue pas avec la formule »,
// il ne s'y ajoute pas. Le client paie donc le prix du kit, jamais prix du kit + formule.
//
// Part du prix du kit à facturer EN PLUS de la ligne formule : le matériel
// seul, pour que formule + kit ne compte jamais la formule deux fois.
export function calculerPrixKitHorsFormule(kit: Kit, formuleChoisie: FormuleReference): number {
  const prixKit = calculerPrixKit(kit, formuleChoisie);
  const materiel = prixKit - formuleChoisie.prix;
  // un prix fixe inférieur à la formule choisie ne couvre pas cette formule : pas de matériel à prix négatif
  if (materiel < 0) throw new Error(`Le prix du kit (${prixKit} FCFA) est inférieur à celui de la formule choisie (${formuleChoisie.prix} FCFA) : choisissez une formule couverte par ce kit`);
  return materiel;
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
