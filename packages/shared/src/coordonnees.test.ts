import { describe, it, expect } from "vitest";
import { erreurEmail, erreurSiteWeb, lignesContactBoutique, texteContactMessage } from "./coordonnees.js";

describe("erreurEmail", () => {
  it.each(["contact@boutique.cm", "a.b-c_d@sous.domaine.cm", "ventes+akwa@boutique.com"])("accepte %s", (valeur) => {
    expect(erreurEmail(valeur)).toBeNull();
  });

  it.each(["", "   ", "sans-arobase", "a@b", "a b@c.cm", "@x.cm", "x@.cm", "x@@y.cm", `${"a".repeat(250)}@x.cm`])("refuse %j", (valeur) => {
    expect(erreurEmail(valeur)).not.toBeNull();
  });
});

describe("erreurSiteWeb", () => {
  it.each(["www.boutique.cm", "boutique.cm", "https://boutique.cm", "http://boutique.cm/accueil", "https://www.sous.boutique.cm/a/b?x=1"])("accepte %s", (valeur) => {
    expect(erreurSiteWeb(valeur)).toBeNull();
  });

  it.each(["", "   ", "boutique", "mon site.cm", "javascript:alert(1)", "ftp://boutique.cm", "https://", "https://.cm", `https://${"a".repeat(200)}.cm`])("refuse %j", (valeur) => {
    expect(erreurSiteWeb(valeur)).not.toBeNull();
  });
});

describe("lignesContactBoutique", () => {
  it("une ligne pour les téléphones, une pour l'e-mail, une pour le site web, dans cet ordre", () => {
    expect(lignesContactBoutique({ telephone: "677 00 00 00", telephoneWhatsapp: "699 11 22 33", email: "contact@boutique.cm", siteWeb: "www.boutique.cm" })).toEqual([
      "Tél : 677 00 00 00 · WhatsApp : 699 11 22 33",
      "contact@boutique.cm",
      "www.boutique.cm",
    ]);
  });

  it("n'écrit que ce qui est renseigné", () => {
    expect(lignesContactBoutique({ telephone: "677 00 00 00" })).toEqual(["Tél : 677 00 00 00"]);
    expect(lignesContactBoutique({ telephoneWhatsapp: "699 11 22 33" })).toEqual(["WhatsApp : 699 11 22 33"]);
    expect(lignesContactBoutique({ email: "contact@boutique.cm", siteWeb: null })).toEqual(["contact@boutique.cm"]);
  });

  it("ne dit rien quand rien n'est renseigné (champs absents, nuls ou vides)", () => {
    expect(lignesContactBoutique({})).toEqual([]);
    expect(lignesContactBoutique({ telephone: null, telephoneWhatsapp: "", email: "  ", siteWeb: null })).toEqual([]);
  });

  it("le même numéro pour l'appel et WhatsApp ne s'écrit qu'une fois", () => {
    expect(lignesContactBoutique({ telephone: "677 00 00 00", telephoneWhatsapp: "+237 677000000" })).toEqual(["Tél et WhatsApp : 677 00 00 00"]);
  });
});

// utilisé dans les SMS de relance : court, sans e-mail ni site web
describe("texteContactMessage", () => {
  it("téléphone et WhatsApp différents : les deux, courts", () => {
    expect(texteContactMessage({ telephone: "677 00 00 00", telephoneWhatsapp: "699 11 22 33" })).toBe("Contact : 677 00 00 00 ou WhatsApp 699 11 22 33.");
  });

  it("un seul numéro, ou le même pour les deux", () => {
    expect(texteContactMessage({ telephone: "677 00 00 00" })).toBe("Contact : 677 00 00 00.");
    expect(texteContactMessage({ telephoneWhatsapp: "699 11 22 33" })).toBe("Contact WhatsApp : 699 11 22 33.");
    expect(texteContactMessage({ telephone: "677 00 00 00", telephoneWhatsapp: "677000000" })).toBe("Contact (appel et WhatsApp) : 677 00 00 00.");
  });

  it("chaîne vide quand aucun numéro n'est renseigné : le message reste inchangé", () => {
    expect(texteContactMessage({})).toBe("");
    expect(texteContactMessage({ email: "contact@boutique.cm", siteWeb: "www.boutique.cm" })).toBe("");
  });
});
