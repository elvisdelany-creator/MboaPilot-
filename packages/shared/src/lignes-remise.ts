export interface LigneMontant {
  libelle: string;
  montant: number;
}

// 6.4, 6.7 : un ticket, un pro-forma ou un reçu montre le prix catalogue de la ligne puis la remise accordée, plutôt qu'un prix déjà
// diminué sans explication : les lignes totalisent alors toujours le total affiché, et le client voit ce qu'on lui a remisé.
// Une remise nulle, négative ou non numérique n'ajoute aucune ligne.
export function ligneAvecRemise(libelle: string, prixCatalogue: number, remise: number, libelleRemise = "Remise"): LigneMontant[] {
  const ligne = { libelle, montant: prixCatalogue };
  if (!(remise > 0)) return [ligne];
  return [ligne, { libelle: libelleRemise, montant: -remise }];
}
