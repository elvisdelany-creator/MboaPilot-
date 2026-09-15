import { calculerPrixKit, type Kit, type FormuleReference } from "@mboapilot/shared";

// 5.1.1 : calculerPrixKit lève une erreur si aucun prix décodeur n'est
// configuré pour la formule choisie (ex. formule tout juste ajoutée au
// catalogue) — jamais de NaN affiché ni envoyé au serveur.
export function calculerPrixKitSecurise(kit: Kit, formuleChoisie: FormuleReference): number | null {
  try {
    return calculerPrixKit(kit, formuleChoisie);
  } catch {
    return null;
  }
}
