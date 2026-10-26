export interface DonneesSavPret {
  entreprise: string; // nom de la boutique, vide si inconnu
  numeroDossier: number;
  montantDu: number; // montant facturé à régler à la remise de l'appareil, 0 sous garantie ou sans frais
}

// milliers séparés par une espace ordinaire : Intl fr-FR emploie une espace fine insécable, que toutes les passerelles SMS ne
// transmettent pas (elle devient « ? » ou fait passer le message en encodage long)
function montantSms(montant: number): string {
  return String(montant).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// 8.4 : notification au client quand l'appareil passe en « Prêt ». Comme pour les relances d'échéance, le client doit savoir qui
// lui écrit, pour quel dossier, et ce qu'il doit prévoir à la remise : « Votre appareil est prêt » seul ne dit rien à quelqu'un
// qui a laissé du matériel dans plusieurs boutiques, et ne dit pas combien apporter.
export function messageSavPret(donnees: DonneesSavPret): string {
  const boutique = donnees.entreprise.trim();
  const phrase = `votre appareil (dossier n°${donnees.numeroDossier}) est prêt à être récupéré.`;
  const debut = boutique ? `${boutique} : ${phrase}` : phrase.charAt(0).toUpperCase() + phrase.slice(1);
  const reglement = donnees.montantDu > 0 ? `Montant à régler : ${montantSms(donnees.montantDu)} FCFA.` : "Aucun frais à régler.";
  return `${debut} ${reglement}`;
}
