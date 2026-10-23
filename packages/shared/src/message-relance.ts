export interface DonneesRelanceEcheance {
  entreprise: string; // nom de la boutique, vide si inconnu
  libelleAbonnement: string; // ex. « CANAL+ EVASION » : le client peut avoir plusieurs abonnements chez plusieurs opérateurs
  numeroAbonnement: number;
  dateFin: string; // déjà au format JJ/MM/AAAA
  joursRestants: number;
  rang: 1 | 2 | 3; // jalon atteint : 1 = le plus urgent
}

function quand(joursRestants: number): string {
  if (joursRestants <= 0) return "aujourd'hui";
  if (joursRestants === 1) return "demain";
  return `dans ${joursRestants} jours`;
}

const TON: Record<1 | 2 | 3, { introduction: string; invitation: string }> = {
  3: { introduction: "", invitation: "Pensez à vous réabonner." }, // J-7 : courtoisie
  2: { introduction: "rappel — ", invitation: "Réabonnez-vous dès maintenant." }, // J-3 : relance ferme
  1: { introduction: "dernier rappel — ", invitation: "Réabonnez-vous sans attendre." }, // J-1 : dernier rappel
};

// 4.4 : J-7 courtoisie, J-3 relance ferme, J-1 dernier rappel. Le client doit savoir qui lui écrit, pour quel abonnement et
// quand : un SMS « Votre abonnement n°6 arrive à échéance » sans expéditeur ni opérateur ne dit rien à un client qui en a
// plusieurs. Le ton suit le jalon atteint (rattrapage compris), l'échéance est dite en clair avec sa date, le tout en un SMS court.
export function messageRelanceEcheance(donnees: DonneesRelanceEcheance): string {
  const { introduction, invitation } = TON[donnees.rang];
  const boutique = donnees.entreprise.trim();
  const phrase = `${introduction}votre abonnement ${donnees.libelleAbonnement} n°${donnees.numeroAbonnement} arrive à échéance ${quand(donnees.joursRestants)} (${donnees.dateFin}).`;
  const texte = boutique ? `${boutique} : ${phrase}` : phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return `${texte} ${invitation}`;
}
