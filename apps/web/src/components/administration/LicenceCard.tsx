import { useEffect, useState } from "react";
import { toast } from "sonner";
import { appliquerCleLicenceRequete, chargerEtatLicence, ErreurAuthentification, prolongerLicenceRequete, type StatutLicence } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENEMENT_LICENCE_MISE_A_JOUR } from "@/lib/evenements";

const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const LIBELLES_PALIER: Record<string, string> = { ESSENTIEL: "Essentiel", PRO: "Pro", RESEAU: "Réseau" };

function demain(): string {
  return new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

// 10.4 : l'administrateur voit l'échéance de l'abonnement MboaPilot et la prolonge — avec la clé de renouvellement signée envoyée par
// l'éditeur quand sa clé publique est inscrite dans l'application, sinon (pilote) en saisissant une nouvelle date. Sans issue, l'application
// passait en lecture seule un an après le premier lancement.
export function LicenceCard() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [statut, setStatut] = useState<StatutLicence | null>(null);
  const [nouvelleDate, setNouvelleDate] = useState("");
  const [cle, setCle] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    chargerEtatLicence(token)
      .then(setStatut)
      .catch(() => setStatut(null));
  }, [token]);

  async function prolonger() {
    setEnCours(true);
    try {
      setStatut(statut?.renouvellementParCle ? await appliquerCleLicenceRequete(token, cle) : await prolongerLicenceRequete(token, nouvelleDate));
      setNouvelleDate("");
      setCle("");
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

  async function copierIdentifiant() {
    try {
      await navigator.clipboard.writeText(statut!.empreinteInstallation);
      toast.success("Identifiant copié.");
    } catch {
      // sans presse-papiers (poste ancien, page non sécurisée) : le texte reste sélectionnable à la main
      toast.error("Copie impossible : sélectionnez l'identifiant et copiez-le.");
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
        et vous pouvez la prolonger ici{statut.renouvellementParCle ? " avec la clé envoyée par votre éditeur" : ""}.
      </p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-heading text-lg font-semibold text-card-foreground">Échéance : {echeance}</span>
        <span className={jours < 0 ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>{resume}</span>
      </div>
      {statut.renouvellementParCle ? (
        <>
          <div>
            <p className="text-sm font-medium text-card-foreground">Identifiant de cette installation</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-border px-3 py-2 text-sm break-all text-card-foreground select-all">{statut.empreinteInstallation}</code>
              <Button type="button" variant="outline" className="h-11 cursor-pointer" onClick={copierIdentifiant}>
                Copier
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Envoyez-le à votre éditeur pour recevoir une clé de renouvellement : elle ne fonctionne que sur cette installation.</p>
          </div>
          <div>
            <Label htmlFor="licence-cle">Clé de renouvellement</Label>
            <textarea
              id="licence-cle"
              value={cle}
              onChange={(e) => setCle(e.target.value)}
              placeholder="MBOA1.…"
              rows={4}
              spellCheck={false}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm break-all shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <Button className="h-11 w-fit cursor-pointer" disabled={enCours || cle.trim() === ""} onClick={prolonger}>
            {enCours ? "Vérification…" : "Appliquer la clé"}
          </Button>
        </>
      ) : (
        <>
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
        </>
      )}
    </Card>
  );
}
