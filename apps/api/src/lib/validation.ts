// Validation commune des montants et compteurs reçus de l'extérieur (corps de
// requête JSON). Constaté en test grandeur nature : les comparaisons `< 0` ou
// `<= 0` sont fausses pour « abc », NaN ou null, qui passaient alors les gardes
// et finissaient stockés dans des colonnes entières.
//
// Valide un entier sûr (ni « abc », ni décimal, ni 1e30). `min` : borne basse
// incluse (0 par défaut) ; `message` remplace le message de dépassement de la
// borne ; `requis` : l'absence est refusée ; `nullable` : null est accepté
// (colonne optionnelle).
export function verifierEntier(valeur: unknown, libelle: string, options: { min?: number; max?: number; nullable?: boolean; requis?: boolean; message?: string } = {}): void {
  const { min = 0, max, nullable = true, requis = false } = options;
  if (valeur === undefined) {
    if (requis) throw new Error(`${libelle} est obligatoire`);
    return;
  }
  if (valeur === null && nullable) return;
  if (typeof valeur !== "number" || !Number.isSafeInteger(valeur)) throw new Error(`${libelle} doit être un nombre entier`);
  if (valeur < min) throw new Error(options.message ?? (min === 0 ? `${libelle} ne peut pas être négatif` : `${libelle} doit être d'au moins ${min}`));
  if (max !== undefined && valeur > max) throw new Error(`${libelle} ne peut pas dépasser ${max}`);
}

const MODES_ENCAISSEMENT: readonly string[] = ["CASH", "CHEQUE", "VIREMENT"];
const CHAMPS_REFERENCE_PAIEMENT = ["banque", "numeroCheque", "titulaireCheque", "dateCheque", "referenceVirement"] as const;

export function verifierRemise(remise: unknown): void {
  verifierEntier(remise, "La remise", { nullable: false, message: "La remise ne peut pas être négative" });
}

// Mode de paiement d'un encaissement saisi en caisse (le Mobile Money suit son
// propre parcours) et références associées (banque, n° de chèque…) : « BITCOIN »
// ou un objet passaient jusqu'à la base, qui échouait avec un message technique.
export function verifierModeEtReferencesPaiement(params: object): void {
  const champs = params as Record<string, unknown>;
  const mode = champs.modePaiement;
  if (mode !== undefined && mode !== null && (typeof mode !== "string" || !MODES_ENCAISSEMENT.includes(mode))) {
    throw new Error("Mode de paiement invalide (CASH, CHEQUE ou VIREMENT attendu)");
  }
  for (const champ of CHAMPS_REFERENCE_PAIEMENT) {
    const valeur = champs[champ];
    if (valeur !== undefined && valeur !== null && typeof valeur !== "string") throw new Error(`Le champ ${champ} doit être un texte`);
  }
}

// Encaissement saisi lors d'une vente, d'un recrutement, d'un réabonnement, d'un
// changement de formule ou d'un échange de matériel : montant encaissé obligatoire
// et entier (FCFA), remise entière et positive, mode et références cohérents.
export function verifierEncaissementSaisi(params: { montantEncaisse?: unknown; remise?: unknown }): void {
  verifierEntier(params.montantEncaisse, "Le montant encaissé", { requis: true, nullable: false });
  verifierRemise(params.remise);
  verifierModeEtReferencesPaiement(params);
}
