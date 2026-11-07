import { useEffect, useState } from "react";
import { toast } from "sonner";
import { causeModeDegrade, messageModeDegrade } from "@mboapilot/shared";
import { chargerEtatLicence, revaliderLicence as revaliderLicenceRequete, type StatutLicence } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EVENEMENT_LICENCE_MISE_A_JOUR } from "@/lib/evenements";

const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const SEUIL_AVERTISSEMENT_JOURS = 5;
// l'échéance de l'abonnement est annoncée un mois à l'avance, pour qu'elle ne tombe jamais par surprise
const SEUIL_ECHEANCE_ABONNEMENT_JOURS = 30;

// 10.3, 10.4 : visible de tout utilisateur connecté — au-delà du délai de
// grâce hors ligne (21 j sans revalidation réussie, ou abonnement éditeur
// expiré), l'application bascule en mode dégradé (lecture seule côté API) ;
// ce bandeau explique la situation et permet de retenter la revalidation
// dès qu'une connexion est disponible, sans jamais bloquer la consultation.
export function LicenceBanner({ token }: { token: string }) {
  const [statut, setStatut] = useState<StatutLicence | null>(null);
  const [revalidationEnCours, setRevalidationEnCours] = useState(false);

  useEffect(() => {
    const charger = () =>
      chargerEtatLicence(token)
        .then(setStatut)
        .catch(() => setStatut(null));
    charger();
    // la prolongation depuis Paramètres doit faire disparaître le bandeau tout de suite, sans rechargement de la page
    window.addEventListener(EVENEMENT_LICENCE_MISE_A_JOUR, charger);
    return () => window.removeEventListener(EVENEMENT_LICENCE_MISE_A_JOUR, charger);
  }, [token]);

  if (!statut) return null;
  const echeanceProche = statut.etat === "ACTIVE" && statut.joursRestantsAbonnement <= SEUIL_ECHEANCE_ABONNEMENT_JOURS;
  if (statut.etat === "ACTIVE" && statut.joursRestantsGrace > SEUIL_AVERTISSEMENT_JOURS && !echeanceProche) return null;

  async function revalider() {
    setRevalidationEnCours(true);
    try {
      const apres = await revaliderLicenceRequete(token);
      setStatut(apres);
      // la revalidation ne repousse pas l'échéance : elle peut réussir sans sortir du mode dégradé, et le dire serait faux
      if (apres.etat === "DEGRADE") toast.warning(messageModeDegrade(apres));
      else toast.success("Licence revalidée.");
    } catch {
      toast.error("Revalidation impossible — vérifiez la connexion.");
    } finally {
      setRevalidationEnCours(false);
    }
  }

  const degradee = statut.etat === "DEGRADE";
  // revalider ne lève que le délai de grâce hors ligne, jamais une échéance d'abonnement (qui se prolonge)
  const revalidationUtile = degradee ? causeModeDegrade(statut) === "REVALIDATION" : !echeanceProche;

  return (
    <div
      className={`no-print flex items-center justify-between gap-4 px-4 py-2 text-sm ${
        degradee ? "bg-destructive-fond text-white" : "bg-amber-500 text-amber-950"
      }`}
    >
      <span>
        {degradee
          ? messageModeDegrade(statut)
          : echeanceProche
            ? `Votre abonnement MboaPilot expire dans ${statut.joursRestantsAbonnement} jour(s) (le ${formateurDate.format(new Date(`${statut.dateExpirationAbonnement.slice(0, 10)}T00:00:00`))}). Un administrateur peut le prolonger dans Administration → Paramètres.`
            : `Licence éditeur : ${statut.joursRestantsGrace} jour(s) restant(s) avant bascule en mode dégradé sans revalidation.`}
      </span>
      {revalidationUtile && (
        <Button size="sm" variant={degradee ? "secondary" : "outline"} disabled={revalidationEnCours} onClick={revalider}>
          Revalider maintenant
        </Button>
      )}
    </div>
  );
}
