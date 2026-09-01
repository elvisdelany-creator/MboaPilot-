// Jeu de données de développement : entreprise/site de démo, un compte
// ADMINISTRATEUR, catalogue CANAL+/DStv minimal. Jamais utilisé en production
// (10.4) — sert uniquement à démarrer rapidement en local.
import { db } from "./client.js";
import * as schema from "./schema.js";
import { creerUtilisateur } from "../modules/utilisateurs/utilisateur.repository.js";

const ent = db.insert(schema.entreprise).values({ nom: "Boutique Demo" }).returning().get();
const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site principal" }).returning().get();

creerUtilisateur(db, {
  siteId: site.idSite,
  nom: "Démo",
  prenom: "Admin",
  identifiant: "admin",
  motDePasse: "admin1234",
  role: "ADMINISTRATEUR",
});

const canal = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
const dstv = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();

const access = db.insert(schema.formule).values({ idFamille: canal.idFamille, libelle: "ACCESS", prix: 5000, rang: 1 }).returning().get();
const evasion = db.insert(schema.formule).values({ idFamille: canal.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
const tout = db.insert(schema.formule).values({ idFamille: canal.idFamille, libelle: "TOUT CANAL+", prix: 28000, rang: 4 }).returning().get();
db.insert(schema.formule).values({ idFamille: dstv.idFamille, libelle: "YANGA", prix: 5000, rang: 1 }).run();
db.insert(schema.formule).values({ idFamille: dstv.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 }).run();

const globalz = db
  .insert(schema.kit)
  .values({
    idFamille: canal.idFamille,
    libelle: "KIT CANAL+ GLOBALZ",
    reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE",
    prixParaboleAccessoires: 0,
  })
  .returning()
  .get();
db.insert(schema.kitPrixDecodeur).values({ idKit: globalz.idKit, idFormule: access.idFormule, prixDecodeur: 8000 }).run();
db.insert(schema.kitPrixDecodeur).values({ idKit: globalz.idKit, idFormule: evasion.idFormule, prixDecodeur: 5000 }).run();
db.insert(schema.kitPrixDecodeur).values({ idKit: globalz.idKit, idFormule: tout.idFormule, prixDecodeur: 1000 }).run();

console.log("Jeu de données de développement créé.");
console.log("Connexion : identifiant \"admin\", mot de passe \"admin1234\"");
