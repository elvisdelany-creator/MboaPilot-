import { describe, it, expect } from "vitest";
import { peutSuivreEcheances, type RoleUtilisateur } from "@mboapilot/shared";
import { creerDbTest } from "./test-utils/db.js";
import * as schema from "./db/schema.js";
import { buildApp } from "./app.js";
import { creerUtilisateur } from "./modules/utilisateurs/utilisateur.repository.js";

// 2.5.1 : le tableau de bord ne demande que ce que le serveur accordera. La règle partagée avec l'interface doit rester celle des gardes de
// l'API, sinon un rôle reçoit « Rôle non autorisé » à l'ouverture, ou se voit masquer une liste qui lui est ouverte.
describe("tableau de bord : les listes d'échéances demandées correspondent aux droits du serveur", () => {
  const roles: RoleUtilisateur[] = ["ADMINISTRATEUR", "GERANT", "CAISSIER", "COMPTABLE", "TECHNICIEN_SAV", "APPORTEUR"];

  it.each(roles)("%s", async (role) => {
    const db = creerDbTest();
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
    const idApporteur = db.insert(schema.sousDistributeur).values({ nom: "Apporteur", tauxCommissionDefaut: 100 }).returning().get().idApporteur;
    creerUtilisateur(db, { siteId, nom: "N", prenom: "P", identifiant: "essai", motDePasse: "motdepasse-secret", role, ...(role === "APPORTEUR" && { idApporteur }) });
    const app = buildApp(db, { jwtSecret: "secret-de-test" });
    const token = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "essai", motDePasse: "motdepasse-secret" } })).json().token;

    for (const url of ["/api/v1/alertes-echeance", "/api/v1/abonnements-expires"]) {
      const reponse = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
      expect(reponse.statusCode, url).toBe(peutSuivreEcheances(role) ? 200 : 403);
    }
  });
});
