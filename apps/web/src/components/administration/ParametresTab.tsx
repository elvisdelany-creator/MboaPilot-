import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import {
  chargerInfosEntreprise,
  chargerSauvegardes,
  exporterDonneesRequete,
  ErreurAuthentification,
  modifierEntrepriseRequete,
  type Sauvegarde,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InfosEntreprise } from "@/lib/types";

const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const formateurTaille = (octets: number) => `${(octets / 1024).toFixed(0)} Ko`;

// 6.1, 6.2, 4.4, 8.8 : paramétrage des taxes applicables (le cas échéant),
// des mentions légales figurant sur les documents commerciaux (6.7), du
// taux de commission vendeur par défaut (6.2) et des jalons d'alerte
// d'échéance (4.4, par défaut 1/3/7 jours).
export function ParametresTab() {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [entreprise, setEntreprise] = useState<InfosEntreprise["entreprise"] | null>(null);
  const [tauxTva, setTauxTva] = useState("");
  const [mentionsLegales, setMentionsLegales] = useState("");
  const [tauxCommission, setTauxCommission] = useState("");
  const [jalonUrgent, setJalonUrgent] = useState("1");
  const [jalonModere, setJalonModere] = useState("3");
  const [jalonAnticipe, setJalonAnticipe] = useState("7");
  const [dureeRetentionExpires, setDureeRetentionExpires] = useState("90");
  const [enCours, setEnCours] = useState(false);
  const [enCoursJalons, setEnCoursJalons] = useState(false);
  const [sauvegardes, setSauvegardes] = useState<Sauvegarde[]>([]);
  const [exportEnCours, setExportEnCours] = useState(false);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function rechargerEntreprise() {
    chargerInfosEntreprise(token)
      .then((infos) => {
        setEntreprise(infos.entreprise);
        setTauxTva(infos.entreprise.tauxTva !== null ? String(infos.entreprise.tauxTva / 100) : "");
        setMentionsLegales(infos.entreprise.mentionsLegales ?? "");
        setTauxCommission(infos.entreprise.tauxCommissionVendeurDefaut !== null ? String(infos.entreprise.tauxCommissionVendeurDefaut) : "");
        setJalonUrgent(String(infos.entreprise.jalonAlerteUrgent));
        setJalonModere(String(infos.entreprise.jalonAlerteModere));
        setJalonAnticipe(String(infos.entreprise.jalonAlerteAnticipe));
        setDureeRetentionExpires(String(infos.entreprise.dureeRetentionExpiresJours));
      })
      .catch((e) => gererErreur(e, "Impossible de charger les paramètres de l'entreprise."));
  }

  useEffect(rechargerEntreprise, [token]);

  function rechargerSauvegardes() {
    chargerSauvegardes(token)
      .then(setSauvegardes)
      .catch(() => setSauvegardes([]));
  }

  useEffect(rechargerSauvegardes, [token]);

  // 2.6 : « Exporter mes données » — sauvegarde à la demande, téléchargée immédiatement
  async function exporterDonnees() {
    setExportEnCours(true);
    try {
      const { blob, nomFichier } = await exporterDonneesRequete(token);
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nomFichier;
      lien.click();
      URL.revokeObjectURL(url);
      toast.success("Export généré et téléchargé.");
      rechargerSauvegardes();
    } catch (erreur) {
      gererErreur(erreur, "Échec de l'export des données.");
    } finally {
      setExportEnCours(false);
    }
  }

  async function enregistrer() {
    setEnCours(true);
    try {
      // saisie en % courant (ex. 19,25), stocké en centièmes de % (1925)
      const tauxCentiemes = tauxTva.trim() === "" ? null : Math.round(Number(tauxTva.replace(",", ".")) * 100);
      const tauxCommissionPourMille = tauxCommission.trim() === "" ? null : Number(tauxCommission);
      await modifierEntrepriseRequete(token, {
        tauxTva: tauxCentiemes,
        mentionsLegales: mentionsLegales.trim() || null,
        tauxCommissionVendeurDefaut: tauxCommissionPourMille,
      });
      toast.success("Paramètres enregistrés.");
      rechargerEntreprise();
    } catch (erreur) {
      gererErreur(erreur, "Échec de l'enregistrement des paramètres.");
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrerJalons() {
    setEnCoursJalons(true);
    try {
      await modifierEntrepriseRequete(token, {
        jalonAlerteUrgent: Number(jalonUrgent),
        jalonAlerteModere: Number(jalonModere),
        jalonAlerteAnticipe: Number(jalonAnticipe),
        dureeRetentionExpiresJours: Number(dureeRetentionExpires),
      });
      toast.success("Jalons d'alerte enregistrés.");
      rechargerEntreprise();
    } catch (erreur) {
      gererErreur(erreur, "Échec de l'enregistrement des jalons.");
    } finally {
      setEnCoursJalons(false);
    }
  }

  if (!entreprise) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Taxes, mentions légales et commissions</p>
      <Card className="max-w-xl gap-4 p-4">
        <div>
          <Label htmlFor="parametres-taux-tva">Taux de TVA applicable (%, optionnel)</Label>
          <Input
            id="parametres-taux-tva"
            type="number"
            min={0}
            step={0.01}
            value={tauxTva}
            onChange={(e) => setTauxTva(e.target.value)}
            placeholder="Aucune taxe si laissé vide"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Ajouté au total du ticket de caisse et de la facture pro-forma. Laisser vide si aucune taxe n'est applicable.
          </p>
        </div>
        <div>
          <Label htmlFor="parametres-mentions">Mentions légales (ticket de caisse, pro-forma)</Label>
          <textarea
            id="parametres-mentions"
            value={mentionsLegales}
            onChange={(e) => setMentionsLegales(e.target.value)}
            placeholder="Ex. RC/DLA/2024/B/1234 — NIU M012345678901"
            rows={3}
            className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <div>
          <Label htmlFor="parametres-commission">Taux de commission vendeur par défaut (‰, optionnel)</Label>
          <Input
            id="parametres-commission"
            type="number"
            min={0}
            value={tauxCommission}
            onChange={(e) => setTauxCommission(e.target.value)}
            placeholder="Aucune commission par défaut si laissé vide"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Appliqué lors d'un recrutement CANAL+ (6.2) quand aucun apporteur d'affaires référent n'est renseigné — sinon le taux de
            l'apporteur prévaut.
          </p>
        </div>

        <Button className="w-fit cursor-pointer" disabled={enCours} onClick={enregistrer}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </Card>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jalons d'alerte d'échéance</p>
      <Card className="max-w-xl gap-4 p-4">
        <p className="text-sm text-muted-foreground">
          Nombre de jours avant l'échéance d'un abonnement déclenchant une alerte (4.4) — par défaut 1, 3 et 7 jours. Doivent être
          strictement croissants.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="parametres-jalon-urgent">Urgent (rouge)</Label>
            <Input id="parametres-jalon-urgent" type="number" min={1} value={jalonUrgent} onChange={(e) => setJalonUrgent(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="parametres-jalon-modere">Modéré (orange)</Label>
            <Input id="parametres-jalon-modere" type="number" min={1} value={jalonModere} onChange={(e) => setJalonModere(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="parametres-jalon-anticipe">Anticipé (ambre)</Label>
            <Input id="parametres-jalon-anticipe" type="number" min={1} value={jalonAnticipe} onChange={(e) => setJalonAnticipe(e.target.value)} className="mt-1" />
          </div>
        </div>
        <div>
          <Label htmlFor="parametres-duree-retention">Durée de rétention des abonnements expirés (jours)</Label>
          <Input
            id="parametres-duree-retention"
            type="number"
            min={1}
            value={dureeRetentionExpires}
            onChange={(e) => setDureeRetentionExpires(e.target.value)}
            className="mt-1 max-w-32"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Durée pendant laquelle un abonnement expiré reste visible dans la liste « Abonnements expirés » du tableau de bord, pour les
            campagnes de reconquête — 90 jours par défaut.
          </p>
        </div>
        <Button className="w-fit cursor-pointer" disabled={enCoursJalons} onClick={enregistrerJalons}>
          {enCoursJalons ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </Card>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sauvegarde et export des données</p>
      <Card className="max-w-xl gap-4 p-4">
        <p className="text-sm text-muted-foreground">
          Une sauvegarde automatique du fichier de données est effectuée chaque jour (conservation glissante sur 30 jours). Le bouton
          ci-dessous déclenche une sauvegarde immédiate et la télécharge.
        </p>
        <Button variant="outline" className="w-fit cursor-pointer gap-2" disabled={exportEnCours} onClick={exporterDonnees}>
          <Download className="size-4" />
          {exportEnCours ? "Export en cours…" : "Exporter mes données"}
        </Button>

        {sauvegardes.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sauvegardes récentes</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {sauvegardes.slice(0, 5).map((s) => (
                <li key={s.nomFichier} className="flex items-center justify-between gap-3">
                  <span>{formateurDateHeure.format(new Date(s.dateCreation))}</span>
                  <span className="tabular-nums">{formateurTaille(s.tailleOctets)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
