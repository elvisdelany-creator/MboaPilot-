import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { trouverVerificationFacture } from "./verification.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idFacture: number;
let jeton: string;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test", devise: "XAF" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  const facture = db.insert(schema.facture).values({ siteId, statut: "VALIDEE", montantTotal: 5000, creePar: userId }).returning().get();
  idFacture = facture.idFacture;
  jeton = facture.jetonVerification;
});

// 13.1 : "QR code de vérification sur factures et tickets... renvoyant vers
// la fiche numérique de la facture (authenticité, état du dossier SAV)"
describe("trouverVerificationFacture (13.1)", () => {
  it("un jeton généré automatiquement à la création est bien un token non trivial", () => {
    expect(jeton).toMatch(/^[0-9a-f]{32}$/);
  });

  it("renvoie les informations minimales d'authenticité pour un jeton valide", () => {
    const resultat = trouverVerificationFacture(db, idFacture, jeton);

    expect(resultat?.facture.idFacture).toBe(idFacture);
    expect(resultat?.facture.montantTotal).toBe(5000);
    expect(resultat?.facture.statut).toBe("VALIDEE");
    expect(resultat?.facture.type).toBe("VENTE");
    expect(resultat?.entreprise.nom).toBe("Boutique Test");
    expect(resultat?.site.nom).toBe("Site A");
    expect(resultat?.dossierSav).toBeNull();
  });

  it("ne renvoie jamais les données personnelles du client (nom, téléphone)", () => {
    const resultat = trouverVerificationFacture(db, idFacture, jeton);

    expect(resultat).not.toHaveProperty("abonne");
    expect(JSON.stringify(resultat)).not.toContain("telephone");
  });

  it("renvoie undefined pour un jeton incorrect", () => {
    expect(trouverVerificationFacture(db, idFacture, "jeton-invalide")).toBeUndefined();
  });

  it("renvoie undefined pour une facture inconnue", () => {
    expect(trouverVerificationFacture(db, 999999, jeton)).toBeUndefined();
  });

  it("inclut le statut du dossier SAV quand la facture y est rattachée", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Client", prenom: "Test", telephone: "690000000" }).returning().get();
    db.insert(schema.savDossier).values({ siteId, idAbonne: abonne.idAbonne, descriptionPanne: "Panne", statut: "PRET", idFacture }).run();

    const resultat = trouverVerificationFacture(db, idFacture, jeton);

    expect(resultat?.dossierSav?.statut).toBe("PRET");
  });
});
