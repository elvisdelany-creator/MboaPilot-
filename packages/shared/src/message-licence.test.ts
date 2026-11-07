import { describe, expect, it } from "vitest";
import { DELAI_GRACE_LICENCE_JOURS, causeModeDegrade, messageModeDegrade } from "./message-licence.js";

// 10.3, 10.4 : en mode dégradé, l'action à mener dépend de la cause. Une échéance d'abonnement se prolonge (administrateur) ; un délai de
// grâce hors ligne dépassé se lève par une revalidation. Dire « expirée » dans les deux cas envoyait l'utilisateur vers la mauvaise action.
describe("causeModeDegrade", () => {
  it("distingue l'échéance de l'abonnement du délai de grâce hors ligne dépassé", () => {
    expect(causeModeDegrade({ joursRestantsAbonnement: -3 })).toBe("ECHEANCE");
    expect(causeModeDegrade({ joursRestantsAbonnement: -1 })).toBe("ECHEANCE");
    expect(causeModeDegrade({ joursRestantsAbonnement: 0 })).toBe("REVALIDATION");
    expect(causeModeDegrade({ joursRestantsAbonnement: 200 })).toBe("REVALIDATION");
  });
});

describe("messageModeDegrade", () => {
  it("échéance : dit « expirée » et renvoie l'administrateur vers la prolongation", () => {
    const message = messageModeDegrade({ joursRestantsAbonnement: -3 });

    expect(message).toMatch(/expirée/i);
    expect(message).toMatch(/mode dégradé \(lecture seule\)/);
    expect(message).toMatch(/prolonger l'abonnement dans Administration → Paramètres/);
  });

  it("délai de grâce : ne dit pas « expirée », annonce la durée et demande une revalidation", () => {
    const message = messageModeDegrade({ joursRestantsAbonnement: 120 });

    expect(message).not.toMatch(/expirée/i);
    expect(message).toContain(`plus de ${DELAI_GRACE_LICENCE_JOURS} jours`);
    expect(message).toMatch(/Revalidez la licence/);
    expect(message).toMatch(/mode dégradé \(lecture seule\)/);
  });
});
