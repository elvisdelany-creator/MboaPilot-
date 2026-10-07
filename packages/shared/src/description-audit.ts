// 11.5 : met en forme une entrée du journal d'audit pour l'écran d'audit (8.7) —
// objet en français et, champ par champ, la valeur avant/après. Le journal
// stocke des JSON bruts (noms de colonnes techniques) ; cette fonction ne
// modifie rien, elle ne fait que décrire.

export interface EntreeAuditBrute {
  action: string;
  tableCible: string;
  idCible: string;
  valeurAvant: string | null;
  valeurApres: string | null;
}

export interface ChangementAudit {
  champ: string;
  avant: string | null; // null = champ absent de cet état (création) ; « — » = valeur vide
  apres: string | null;
}

export interface DescriptionAudit {
  objet: string;
  reference: string;
  changements: ChangementAudit[];
}

const OBJETS: Record<string, string> = {
  abonne: "Abonné",
  utilisateur: "Utilisateur",
  cloture_caisse: "Clôture de caisse",
  paiement: "Paiement",
  formule: "Formule",
  option_complement: "Option",
  kit: "Kit",
  kit_prix_decodeur: "Prix décodeur du kit",
  formule_option_compat: "Option / formule",
  entreprise: "Paramètres de l'entreprise",
};

const CHAMPS: Record<string, string> = {
  libelle: "Libellé",
  prix: "Prix",
  rang: "Rang",
  actif: "Actif",
  statut: "Statut",
  role: "Rôle",
  identifiant: "Identifiant",
  siteId: "Site",
  idFamille: "Famille",
  reglePrix: "Règle de prix",
  prixFixe: "Prix fixe",
  prixParaboleAccessoires: "Parabole et accessoires",
  prixKitReference: "Prix de référence",
  prixDecodeur: "Prix du décodeur",
  prixSurcharge: "Surcharge",
  dureeCycles: "Durée en cycles",
  modeDuree: "Mode de durée",
  ecartTotal: "Écart total",
  champsEffaces: "Champs effacés",
  email: "Email",
  telephone: "Téléphone",
  idAbonne: "N° d'abonné",
  nom: "Nom",
  prenom: "Prénom",
  numeroCni: "N° CNI",
  adresse: "Adresse",
  apporteurId: "Apporteur",
  dateCreation: "Créé le",
  idPaiement: "N° de paiement",
  idFacture: "N° de facture",
  utilisateurId: "Utilisateur",
  referenceTransaction: "Référence de transaction",
  banque: "Banque",
  numeroCheque: "N° de chèque",
  titulaireCheque: "Titulaire du chèque",
  dateCheque: "Date du chèque",
  referenceVirement: "Référence de virement",
  datePaiement: "Payé le",
  statutRapprochement: "Rapprochement bancaire",
  montant: "Montant",
  mode: "Mode",
  tauxTva: "Taux de TVA",
  mentionsLegales: "Mentions légales",
  tauxCommissionVendeurDefaut: "Commission vendeur par défaut",
  tauxGarantiePourcent: "Taux de garantie",
  jalonAlerteUrgent: "Jalon d'alerte urgent",
  jalonAlerteModere: "Jalon d'alerte modéré",
  jalonAlerteAnticipe: "Jalon d'alerte anticipé",
  dureeRetentionExpiresJours: "Rétention des expirés (jours)",
  dureeConservationDonneesJours: "Conservation des données (jours)",
  politiqueMdpLongueurMin: "Longueur minimale du mot de passe",
  politiqueMdpExigerMajuscule: "Mot de passe : majuscule exigée",
  politiqueMdpExigerChiffre: "Mot de passe : chiffre exigé",
  politiqueMdpExigerCaractereSpecial: "Mot de passe : caractère spécial exigé",
  delaiGraceReabonnementJours: "Délai de grâce de réabonnement (jours)",
};

const CHAMPS_FCFA = new Set(["prix", "prixFixe", "prixParaboleAccessoires", "prixKitReference", "prixDecodeur", "prixSurcharge", "ecartTotal", "montant"]);
const CHAMPS_BOOLEENS = new Set(["actif", "politiqueMdpExigerMajuscule", "politiqueMdpExigerChiffre", "politiqueMdpExigerCaractereSpecial"]);

function groupeMilliers(n: number): string {
  return String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function entier(n: number): string {
  return (n < 0 ? "-" : "") + groupeMilliers(n);
}

function formaterValeur(champ: string, valeur: unknown): string {
  if (valeur === null || valeur === undefined || valeur === "") return "—";
  if (Array.isArray(valeur)) return valeur.map(String).join(", ");
  if (typeof valeur === "number") {
    if (CHAMPS_BOOLEENS.has(champ)) return valeur ? "oui" : "non";
    if (CHAMPS_FCFA.has(champ)) return `${entier(valeur)} FCFA`;
    if (champ === "tauxTva") return `${String(valeur / 100).replace(".", ",")} %`;
    if (champ === "tauxGarantiePourcent") return `${valeur} %`;
    if (champ === "tauxCommissionVendeurDefaut") return `${valeur} ‰`;
    return String(valeur);
  }
  if (typeof valeur === "boolean") return valeur ? "oui" : "non";
  if (typeof valeur === "object") return JSON.stringify(valeur);
  return String(valeur);
}

function analyserObjet(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const valeur: unknown = JSON.parse(json);
    return valeur !== null && typeof valeur === "object" && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function decrireEntreeAudit(entree: EntreeAuditBrute): DescriptionAudit {
  const avant = analyserObjet(entree.valeurAvant);
  const apres = analyserObjet(entree.valeurApres);
  const champs = [...new Set([...Object.keys(apres ?? {}), ...Object.keys(avant ?? {})])];

  return {
    objet: OBJETS[entree.tableCible] ?? entree.tableCible,
    reference: entree.idCible,
    changements: champs.map((champ) => ({
      champ: CHAMPS[champ] ?? champ,
      avant: avant && champ in avant ? formaterValeur(champ, avant[champ]) : null,
      apres: apres && champ in apres ? formaterValeur(champ, apres[champ]) : null,
    })),
  };
}
