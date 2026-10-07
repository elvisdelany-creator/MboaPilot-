import { describe, expect, it } from "vitest";
import { decrireEntreeAudit } from "./description-audit.js";

const base = { action: "MODIFICATION", tableCible: "formule", idCible: "1", valeurAvant: null, valeurApres: null };

// 11.5 : le journal d'audit sert de « preuve en cas de litige » — il doit montrer
// la valeur avant/après (constaté : l'écran n'affichait que « Modification —
// formule n° 1 », sans le contenu du changement, pourtant renvoyé par l'API).
describe("decrireEntreeAudit (11.5)", () => {
  it("nomme l'objet en français et décrit un changement de prix avant/après", () => {
    const d = decrireEntreeAudit({ ...base, valeurAvant: '{"prix":5000}', valeurApres: '{"prix":5500}' });
    expect(d.objet).toBe("Formule");
    expect(d.reference).toBe("1");
    expect(d.changements).toEqual([{ champ: "Prix", avant: "5 000 FCFA", apres: "5 500 FCFA" }]);
  });

  it("une création n'a pas de valeur avant", () => {
    const d = decrireEntreeAudit({ ...base, action: "CREATION", valeurApres: '{"libelle":"COMPAQ","prix":13000}' });
    expect(d.changements).toEqual([
      { champ: "Libellé", avant: null, apres: "COMPAQ" },
      { champ: "Prix", avant: null, apres: "13 000 FCFA" },
    ]);
  });

  it("une suppression n'a pas de valeur après", () => {
    const d = decrireEntreeAudit({ ...base, action: "SUPPRESSION", tableCible: "formule_option_compat", idCible: "1:2", valeurAvant: '{"prixSurcharge":1500}' });
    expect(d.objet).toBe("Option / formule");
    expect(d.reference).toBe("1:2");
    expect(d.changements).toEqual([{ champ: "Surcharge", avant: "1 500 FCFA", apres: null }]);
  });

  it("réunit les champs des deux états (clôture de caisse)", () => {
    const d = decrireEntreeAudit({ ...base, tableCible: "cloture_caisse", valeurAvant: '{"statut":"OUVERTE"}', valeurApres: '{"statut":"FERMEE","ecartTotal":-200}' });
    expect(d.objet).toBe("Clôture de caisse");
    expect(d.changements).toEqual([
      { champ: "Statut", avant: "OUVERTE", apres: "FERMEE" },
      { champ: "Écart total", avant: null, apres: "-200 FCFA" },
    ]);
  });

  it("formate les booléens 0/1 et les taux du paramétrage", () => {
    const actif = decrireEntreeAudit({ ...base, valeurAvant: '{"actif":1}', valeurApres: '{"actif":0}' });
    expect(actif.changements).toEqual([{ champ: "Actif", avant: "oui", apres: "non" }]);

    const tva = decrireEntreeAudit({ ...base, tableCible: "entreprise", valeurAvant: '{"tauxTva":1925,"tauxGarantiePourcent":50}', valeurApres: '{"tauxTva":1800,"tauxGarantiePourcent":70}' });
    expect(tva.objet).toBe("Paramètres de l'entreprise");
    expect(tva.changements).toEqual([
      { champ: "Taux de TVA", avant: "19,25 %", apres: "18 %" },
      { champ: "Taux de garantie", avant: "50 %", apres: "70 %" },
    ]);
  });

  it("affiche une liste de champs (anonymisation) et une valeur nulle", () => {
    const d = decrireEntreeAudit({ ...base, tableCible: "abonne", action: "SUPPRESSION", valeurAvant: '{"champsEffaces":["nom","prenom"],"email":null}' });
    expect(d.objet).toBe("Abonné");
    expect(d.changements).toEqual([
      { champ: "Champs effacés", avant: "nom, prenom", apres: null },
      { champ: "Email", avant: "—", apres: null },
    ]);
  });

  it("traduit les champs d'un abonné ou d'un paiement supprimé (fusion, annulation)", () => {
    const abonne = decrireEntreeAudit({ ...base, tableCible: "abonne", action: "SUPPRESSION", valeurAvant: '{"idAbonne":69,"nom":"Mvondo","prenom":"Paul","numeroCni":null,"apporteurId":null,"dateCreation":"2026-10-01 15:35:13"}' });
    expect(abonne.changements.map((c) => c.champ)).toEqual(["N° d'abonné", "Nom", "Prénom", "N° CNI", "Apporteur", "Créé le"]);

    const paiement = decrireEntreeAudit({ ...base, tableCible: "paiement", action: "SUPPRESSION", valeurAvant: '{"idPaiement":24,"idFacture":27,"mode":"CASH","montant":5000,"datePaiement":"2026-09-12 19:12:45","statutRapprochement":"EN_ATTENTE"}' });
    expect(paiement.changements.map((c) => c.champ)).toEqual(["N° de paiement", "N° de facture", "Mode", "Montant", "Payé le", "Rapprochement bancaire"]);
  });

  it("garde le nom brut d'une table inconnue et un champ inconnu tel quel", () => {
    const d = decrireEntreeAudit({ ...base, tableCible: "table_future", valeurApres: '{"nouveauChamp":"x"}' });
    expect(d.objet).toBe("table_future");
    expect(d.changements).toEqual([{ champ: "nouveauChamp", avant: null, apres: "x" }]);
  });

  it("tolère un JSON absent, vide ou invalide : aucun changement détaillé, pas d'exception", () => {
    expect(decrireEntreeAudit(base).changements).toEqual([]);
    expect(decrireEntreeAudit({ ...base, valeurApres: "pas du json" }).changements).toEqual([]);
    expect(decrireEntreeAudit({ ...base, valeurApres: "[1,2]" }).changements).toEqual([]);
  });
});
