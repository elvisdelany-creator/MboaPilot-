// 10.3, 10.4 : un abonnement éditeur expiré, ou une revalidation périodique non réussie au-delà du délai de grâce hors ligne, bascule
// l'application en mode dégradé (lecture seule). La cause décide de l'action à mener — une échéance se prolonge (administrateur), un
// délai de grâce dépassé se lève par une revalidation — donc du message : dire « expirée » dans les deux cas envoyait l'utilisateur vers
// la mauvaise action (et le bouton « Revalider » annonçait un succès sans rien changer).
export const DELAI_GRACE_LICENCE_JOURS = 21;

export type CauseModeDegrade = "ECHEANCE" | "REVALIDATION";

export function causeModeDegrade(statut: { joursRestantsAbonnement: number }): CauseModeDegrade {
  return statut.joursRestantsAbonnement < 0 ? "ECHEANCE" : "REVALIDATION";
}

export function messageModeDegrade(statut: { joursRestantsAbonnement: number }): string {
  return causeModeDegrade(statut) === "ECHEANCE"
    ? "Licence éditeur expirée : application en mode dégradé (lecture seule). Un administrateur peut prolonger l'abonnement dans Administration → Paramètres, ou contactez votre éditeur."
    : `Licence non revalidée depuis plus de ${DELAI_GRACE_LICENCE_JOURS} jours : application en mode dégradé (lecture seule). Revalidez la licence pour reprendre.`;
}
