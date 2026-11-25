import { closeSync, fsyncSync, openSync } from "node:fs";

// Un fichier écrit n'est d'abord que dans la mémoire du système : on attend qu'il soit sur le disque avant de lui donner son nom définitif.
export function forcerSurDisque(chemin: string): void {
  const descripteur = openSync(chemin, "r+");
  try {
    fsyncSync(descripteur);
  } finally {
    closeSync(descripteur);
  }
}
