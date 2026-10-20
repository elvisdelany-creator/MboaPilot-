import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { texteFacultatif, texteObligatoire } from "../../lib/champs-texte.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";

export interface SaisieInstallation {
  nomEntreprise: string;
  nomSite: string;
  adresseSite?: string;
  administrateur: { prenom: string; nom: string; identifiant: string; motDePasse: string };
}

// Une base neuve n'a aucun compte : l'application n'est « installée » qu'à partir du premier utilisateur.
export function installationNecessaire(db: Db): boolean {
  return db.select({ idUser: schema.utilisateur.idUser }).from(schema.utilisateur).limit(1).get() === undefined;
}

// Première installation d'une boutique : crée l'entreprise, son site et le premier administrateur, avec le mot de passe
// choisi par la boutique (jamais un compte de démonstration). Tout ou rien. Refusée dès qu'un compte existe : la
// route est publique, elle ne doit servir qu'une fois. Une entreprise ou un site laissés par une installation
// interrompue (sans compte) sont réutilisés plutôt que dupliqués.
export function installer(db: Db, saisie: SaisieInstallation): void {
  if (typeof saisie !== "object" || saisie === null) throw new Error("La saisie de l'installation est vide");
  if (typeof saisie.administrateur !== "object" || saisie.administrateur === null) throw new Error("Les informations de l'administrateur sont obligatoires");

  const nomEntreprise = texteObligatoire(saisie.nomEntreprise, "Le nom de l'entreprise", 150);
  const nomSite = texteObligatoire(saisie.nomSite, "Le nom de la boutique", 100);
  const adresseSite = texteFacultatif(saisie.adresseSite, "L'adresse de la boutique", 300) ?? null;

  db.transaction(() => {
    if (!installationNecessaire(db)) throw new Error("L'application est déjà installée");

    const entrepriseExistante = db.select().from(schema.entreprise).get();
    const entreprise = entrepriseExistante
      ? db.update(schema.entreprise).set({ nom: nomEntreprise }).where(eq(schema.entreprise.idEntreprise, entrepriseExistante.idEntreprise)).returning().get()
      : db.insert(schema.entreprise).values({ nom: nomEntreprise }).returning().get();

    const siteExistant = db.select().from(schema.site).where(eq(schema.site.idEntreprise, entreprise.idEntreprise)).get();
    const site = siteExistant
      ? db.update(schema.site).set({ nom: nomSite, adresse: adresseSite }).where(eq(schema.site.idSite, siteExistant.idSite)).returning().get()
      : db.insert(schema.site).values({ idEntreprise: entreprise.idEntreprise, nom: nomSite, adresse: adresseSite }).returning().get();

    const { prenom, nom, identifiant, motDePasse } = saisie.administrateur;
    creerUtilisateur(db, { siteId: site.idSite, prenom, nom, identifiant, motDePasse, role: "ADMINISTRATEUR" });
  });
}
