import { useEffect, useState } from "react";
import { toast } from "sonner";
import { chargerEtatLicence, ErreurAuthentification, prolongerLicenceRequete, type StatutLicence } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENEMENT_LICENCE_MISE_A_JOUR } from "@/lib/evenements";

const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const LIBELLES_PALIER: Record<string, string> = { ESSENTIEL: "Essentiel" };

function demain(): string {
  return new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

// 10.4 (pilote) : l'administrateur voit l'échéance de l'abonnement MboaPilot et la prolonge en saisissant une nouvelle
// date. Sans cela, un an après le premier lancement, l'application passait en lecture seule sans aucune issue.
export function LicenceCard() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [statut, setStatut] = useState<StatutLicence | null>(null);
  const [nouvelleDate, setNouvelleDate] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    chargerEtatLicence(token)
      .then(setStatut)
      .catch(() => setStatut(null));
  }, [token]);

  async function prolonger() {
    setEnCours(true);
    try {
      setStatut(await prolongerLicenceRequete(token, nouvelleDate));
      setNouvelleDate("");
      window.dispatchEvent(new Event(EVENEMENT_LICENCE_MISE_A_JOUR));
      toast.success("Abonnement prolongé.");
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la prolongation.");
    } finally {
      setEnCours(false);
    }
  }

  if (!statut) return null;

  const echeance = formateurDate.format(new Date(`${statut.dateExpirationAbonnement.slice(0, 10)}T00:00:00`));
  const jours = statut.joursRestantsAbonnement;
  const resume = jours < 0 ? `expiré depuis ${-jours} jour(s)` : jours === 0 ? "expire aujourd'hui" : `${jours} jour(s) restant(s)`;

  return (
    <Card className="max-w-xl gap-4 p-4">
      <p className="text-sm text-muted-foreground">
        Abonnement MboaPilot — formule {LIBELLES_PALIER[statut.palier] ?? statut.palier}. Une fois l'échéance dépassée, l'application passe en lecture seule : rien n'est supprimé,
        et vous pouvez la prolonger ici.
      </p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-heading text-lg font-semibold text-card-foreground">Échéance : {echeance}</span>
        <span className={jours < 0 ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>{resume}</span>
      </div>
      <div>
        <Label htmlFor="licence-nouvelle-date">Prolonger jusqu'au</Label>
        <Input
          id="licence-nouvelle-date"
          type="date"
          min={demain()}
          value={nouvelleDate}
          onChange={(e) => setNouvelleDate(e.target.value)}
          className="mt-1 h-10 max-w-52"
        />
      </div>
      <Button className="w-fit cursor-pointer" disabled={enCours || nouvelleDate === ""} onClick={prolonger}>
        {enCours ? "Enregistrement…" : "Prolonger l'abonnement"}
      </Button>
    </Card>
  );
}
