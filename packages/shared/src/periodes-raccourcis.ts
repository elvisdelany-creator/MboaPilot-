import { decalerJour } from "./plage-jours.js";
import { periodeDuMois } from "./periode-mois.js";

export type ClePeriodeRaccourci = "aujourdhui" | "hier" | "semaine" | "mois" | "moisDernier";

// Les raccourcis de période de l'écran des états. Jours de Douala, `aujourdHui` au format AAAA-MM-JJ. La semaine va du lundi à aujourd'hui.
export function raccourcisPeriode(aujourdHui: string): { cle: ClePeriodeRaccourci; libelle: string; periode: { du: string; au: string } }[] {
  // getUTCDay : 0 = dimanche … 6 = samedi ; le lundi précédent est à (jour + 6) % 7 jours en arrière
  const joursDepuisLundi = (new Date(`${aujourdHui}T00:00:00Z`).getUTCDay() + 6) % 7;
  const hier = decalerJour(aujourdHui, -1);
  return [
    { cle: "aujourdhui", libelle: "Aujourd'hui", periode: { du: aujourdHui, au: aujourdHui } },
    { cle: "hier", libelle: "Hier", periode: { du: hier, au: hier } },
    { cle: "semaine", libelle: "Cette semaine", periode: { du: decalerJour(aujourdHui, -joursDepuisLundi), au: aujourdHui } },
    { cle: "mois", libelle: "Ce mois", periode: { du: periodeDuMois(aujourdHui).du, au: aujourdHui } },
    { cle: "moisDernier", libelle: "Mois dernier", periode: periodeDuMois(aujourdHui, -1) },
  ];
}
