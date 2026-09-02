export interface FormuleMigration {
  idFormule: number;
  idFamille: number;
  rang: number;
  prix: number;
}

export type ResultatValidationMigration = { autorise: true; montantDifferentiel: number } | { autorise: false; motif: string };

// 7.4 : le changement de formule (migration) n'autorise qu'une formule de
// rang strictement supérieur, dans la même famille. La facturation suit la
// même logique de différentiel que le prix de kit (5.1.1).
export function validerMigrationFormule(actuelle: FormuleMigration, cible: FormuleMigration): ResultatValidationMigration {
  if (cible.idFamille !== actuelle.idFamille) {
    return { autorise: false, motif: "La formule cible doit appartenir à la même famille d'abonnement." };
  }
  if (cible.idFormule === actuelle.idFormule) {
    return { autorise: false, motif: "Formule identique — ce n'est pas un changement de formule mais un simple réabonnement (7.2)." };
  }
  if (cible.rang <= actuelle.rang) {
    return {
      autorise: false,
      motif: "Seule une formule de rang strictement supérieur peut être sélectionnée en migration — une rétrogradation n'est possible qu'au réabonnement suivant.",
    };
  }
  return { autorise: true, montantDifferentiel: cible.prix - actuelle.prix };
}
