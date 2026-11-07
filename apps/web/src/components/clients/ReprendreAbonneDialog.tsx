import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { jourDouala } from "@mboapilot/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RechercheAbonne } from "@/components/caisse/RechercheAbonne";
import { chargerComptesPartages, ErreurAuthentification, reprendreAbonneRequete } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Abonne, CatalogueFamille, ComptePartage, NouvelAbonne } from "@/lib/types";

interface Props {
  ouvert: boolean;
  catalogue: CatalogueFamille[];
  onFerme: () => void;
  onSucces: (idAbonne: number) => void;
}

const AUCUN_COMPTE = "aucun";
const JOURS_PASSE_MAX = 365;
const JOURS_FUTUR_MAX = 730;

function decalerJours(jour: string, jours: number): string {
  return new Date(Date.parse(`${jour}T00:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);
}

const formateurDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

// Jour 1 en boutique : les abonnés qui existaient avant l'application se reprennent avec leur VRAIE date de fin. Un recrutement
// inventerait une vente d'aujourd'hui (chiffre d'affaires, commission, stock) et ferait repartir l'abonnement d'aujourd'hui.
export function ReprendreAbonneDialog({ ouvert, catalogue, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const siteId = session!.utilisateur.siteId;

  const [abonne, setAbonne] = useState<Abonne | NouvelAbonne | null>(null);
  const [idFormule, setIdFormule] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [numeroSerie, setNumeroSerie] = useState("");
  const [idComptePartage, setIdComptePartage] = useState(AUCUN_COMPTE);
  const [comptes, setComptes] = useState<ComptePartage[]>([]);
  const [enCours, setEnCours] = useState(false);

  const aujourdHui = useMemo(() => jourDouala(), [ouvert]);
  const dateMin = decalerJours(aujourdHui, -JOURS_PASSE_MAX);
  const dateMax = decalerJours(aujourdHui, JOURS_FUTUR_MAX);

  useEffect(() => {
    if (!ouvert) return;
    setAbonne(null);
    setIdFormule("");
    setDateFin("");
    setNumeroSerie("");
    setIdComptePartage(AUCUN_COMPTE);
    chargerComptesPartages(token, siteId)
      .then(setComptes)
      .catch(() => setComptes([]));
  }, [ouvert, token, siteId]);

  const formules = catalogue.flatMap((f) => f.formules.map((fo) => ({ ...fo, famille: f.libelle })));
  const formule = formules.find((f) => String(f.idFormule) === idFormule);
  // un compte streaming n'accueille que sa famille ; le complet reste visible mais grisé, comme à la caisse
  const comptesDeLaFamille = formule ? comptes.filter((c) => c.idFamille === formule.idFamille && c.actif === 1) : [];

  useEffect(() => setIdComptePartage(AUCUN_COMPTE), [idFormule]);

  const dateValide = dateFin !== "" && dateFin >= dateMin && dateFin <= dateMax;
  const dejaExpiree = dateValide && dateFin < aujourdHui;
  const pret = abonne !== null && formule !== undefined && dateValide;

  async function confirmer() {
    if (!pret || !formule) return;
    setEnCours(true);
    try {
      const resultat = await reprendreAbonneRequete(token, {
        abonne: "idAbonne" in abonne ? { idAbonne: abonne.idAbonne } : abonne,
        idFormule: formule.idFormule,
        dateFin,
        numeroSerie: numeroSerie.trim() || undefined,
        idComptePartage: idComptePartage === AUCUN_COMPTE ? undefined : Number(idComptePartage),
      });
      toast.success(`Abonnement n° ${resultat.numeroAbonnement} repris — ${resultat.statut === "EXPIRE" ? "expiré depuis le" : "valable jusqu'au"} ${formateurDate.format(new Date(`${dateFin}T00:00:00Z`))}.`);
      onSucces(resultat.idAbonne);
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la reprise de l'abonné.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && !enCours && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reprendre un abonné existant</DialogTitle>
          <DialogDescription>
            Pour un client qui avait déjà un abonnement avant l'application. Rien n'est facturé ni encaissé : aucune vente, aucune commission.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Client</Label>
            <div className="mt-1">
              <RechercheAbonne siteId={siteId} abonneSelectionne={abonne} onSelectionner={setAbonne} />
            </div>
          </div>

          <div>
            <Label htmlFor="reprise-formule">Formule actuelle</Label>
            <Select value={idFormule} onValueChange={setIdFormule}>
              <SelectTrigger id="reprise-formule" className="mt-1 h-11 w-full text-base">
                <SelectValue placeholder="Choisir la formule du client" />
              </SelectTrigger>
              <SelectContent>
                {formules.map((f) => (
                  <SelectItem key={f.idFormule} value={String(f.idFormule)}>
                    {f.famille} — {f.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="reprise-date-fin">Date de fin de l'abonnement en cours</Label>
            <Input id="reprise-date-fin" type="date" value={dateFin} min={dateMin} max={dateMax} onChange={(e) => setDateFin(e.target.value)} className="mt-1 h-11 text-base" />
            <p className={dateFin !== "" && !dateValide ? "mt-1 text-xs text-destructive" : "mt-1 text-xs text-muted-foreground"}>
              {dateFin !== "" && !dateValide
                ? "Date improbable : entre un an en arrière et deux ans en avant. Vérifiez l'année."
                : dejaExpiree
                  ? "Cette date est passée : l'abonnement sera repris comme expiré, visible dans « Abonnements expirés » pour le reconquérir."
                  : "La date affichée sur le décodeur ou sur la dernière facture du client. Les rappels J-7, J-3 et J-1 partent de cette date."}
            </p>
          </div>

          <div>
            <Label htmlFor="reprise-serie">Numéro de série du décodeur (facultatif)</Label>
            <Input id="reprise-serie" value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} maxLength={100} className="mt-1 h-11 text-base" />
          </div>

          {comptesDeLaFamille.length > 0 && (
            <div>
              <Label htmlFor="reprise-compte">Écran sur un compte partagé (facultatif)</Label>
              <Select value={idComptePartage} onValueChange={setIdComptePartage}>
                <SelectTrigger id="reprise-compte" className="mt-1 h-11 w-full text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUCUN_COMPTE}>Aucun</SelectItem>
                  {comptesDeLaFamille.map((c) => (
                    <SelectItem key={c.idComptePartage} value={String(c.idComptePartage)} disabled={c.ecransOccupes >= c.nombreEcransMax}>
                      {c.libelle} ({c.ecransOccupes}/{c.nombreEcransMax} écrans)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" disabled={enCours} onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pret || enCours} onClick={confirmer}>
            {enCours ? "Enregistrement…" : "Reprendre cet abonné"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
