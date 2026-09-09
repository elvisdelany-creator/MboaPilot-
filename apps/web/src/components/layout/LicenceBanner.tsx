import { useEffect, useState } from "react";
import { toast } from "sonner";
import { chargerEtatLicence, revaliderLicence as revaliderLicenceRequete, type StatutLicence } from "@/lib/api";
import { Button } from "@/components/ui/button";

const SEUIL_AVERTISSEMENT_JOURS = 5;

// 10.3, 10.4 : visible de tout utilisateur connecté — au-delà du délai de
// grâce hors ligne (21 j sans revalidation réussie, ou abonnement éditeur
// expiré), l'application bascule en mode dégradé (lecture seule côté API) ;
// ce bandeau explique la situation et permet de retenter la revalidation
// dès qu'une connexion est disponible, sans jamais bloquer la consultation.
export function LicenceBanner({ token }: { token: string }) {
  const [statut, setStatut] = useState<StatutLicence | null>(null);
  const [revalidationEnCours, setRevalidationEnCours] = useState(false);

  useEffect(() => {
    chargerEtatLicence(token)
      .then(setStatut)
      .catch(() => setStatut(null));
  }, [token]);

  if (!statut) return null;
  if (statut.etat === "ACTIVE" && statut.joursRestantsGrace > SEUIL_AVERTISSEMENT_JOURS) return null;

  async function revalider() {
    setRevalidationEnCours(true);
    try {
      setStatut(await revaliderLicenceRequete(token));
      toast.success("Licence revalidée.");
    } catch {
      toast.error("Revalidation impossible — vérifiez la connexion.");
    } finally {
      setRevalidationEnCours(false);
    }
  }

  const degradee = statut.etat === "DEGRADE";

  return (
    <div
      className={`no-print flex items-center justify-between gap-4 px-4 py-2 text-sm ${
        degradee ? "bg-destructive text-white" : "bg-amber-500 text-amber-950"
      }`}
    >
      <span>
        {degradee
          ? "Licence éditeur expirée : application en mode dégradé (lecture seule). Contactez votre éditeur pour réactiver l'abonnement."
          : `Licence éditeur : ${statut.joursRestantsGrace} jour(s) restant(s) avant bascule en mode dégradé sans revalidation.`}
      </span>
      <Button size="sm" variant={degradee ? "secondary" : "outline"} disabled={revalidationEnCours} onClick={revalider}>
        Revalider maintenant
      </Button>
    </div>
  );
}
