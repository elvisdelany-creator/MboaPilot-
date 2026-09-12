import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ouvrirDossierSav, rechercherAbonnes, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Abonne } from "@/lib/types";

interface Props {
  ouvert: boolean;
  onFerme: () => void;
  onSucces: () => void;
}

// 5.10, 8.4 : ouverture de dossier, avec ou sans rattachement à un abonné existant
export function NouveauDossierDialog({ ouvert, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [termeAbonne, setTermeAbonne] = useState("");
  const [resultatsAbonne, setResultatsAbonne] = useState<Abonne[]>([]);
  const [abonneSelectionne, setAbonneSelectionne] = useState<Abonne | null>(null);
  // 5.10, 8.4 : identité du client ponctuel — pour la restitution et la
  // notification au passage en « Prêt », faute d'abonné rattaché
  const [clientNom, setClientNom] = useState("");
  const [clientTelephone, setClientTelephone] = useState("");
  const [descriptionPanne, setDescriptionPanne] = useState("");
  const [etatReception, setEtatReception] = useState("");
  const [sousGarantie, setSousGarantie] = useState(false);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!termeAbonne.trim() || abonneSelectionne) {
      setResultatsAbonne([]);
      return;
    }
    const id = setTimeout(() => {
      rechercherAbonnes(token, utilisateur.siteId, termeAbonne).then(setResultatsAbonne).catch(() => setResultatsAbonne([]));
    }, 200);
    return () => clearTimeout(id);
  }, [termeAbonne, abonneSelectionne, token, utilisateur.siteId]);

  function reinitialiser() {
    setTermeAbonne("");
    setResultatsAbonne([]);
    setAbonneSelectionne(null);
    setClientNom("");
    setClientTelephone("");
    setDescriptionPanne("");
    setEtatReception("");
    setSousGarantie(false);
  }

  async function valider() {
    if (!descriptionPanne.trim()) return;
    setEnCours(true);
    try {
      await ouvrirDossierSav(token, {
        siteId: utilisateur.siteId,
        idAbonne: abonneSelectionne?.idAbonne,
        clientNom: abonneSelectionne ? undefined : clientNom.trim() || undefined,
        clientTelephone: abonneSelectionne ? undefined : clientTelephone.trim() || undefined,
        descriptionPanne,
        etatReception: etatReception || undefined,
        sousGarantie,
        userId: utilisateur.idUser,
      });
      toast.success("Dossier SAV ouvert.");
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'ouverture du dossier.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau dossier SAV</DialogTitle>
          <DialogDescription>Réception d'un appareil — rattachement à un abonné optionnel.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Label htmlFor="sav-abonne">Abonné (optionnel — laisser vide pour un client ponctuel)</Label>
            {abonneSelectionne ? (
              <div className="mt-1 flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>
                  {abonneSelectionne.prenom} {abonneSelectionne.nom} — {abonneSelectionne.telephone}
                </span>
                <button
                  type="button"
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => setAbonneSelectionne(null)}
                >
                  Changer
                </button>
              </div>
            ) : (
              <>
                <Input
                  id="sav-abonne"
                  value={termeAbonne}
                  onChange={(e) => setTermeAbonne(e.target.value)}
                  placeholder="Nom, téléphone, n° abonné…"
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Un téléphone de client ponctuel permet de le notifier quand l'appareil sera prêt.
                </p>
              </>
            )}
            {resultatsAbonne.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                {resultatsAbonne.map((a) => (
                  <li key={a.idAbonne}>
                    <button
                      type="button"
                      className="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setAbonneSelectionne(a);
                        setResultatsAbonne([]);
                      }}
                    >
                      {a.prenom} {a.nom} — {a.telephone}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 5.10, 8.4 : identité du client ponctuel, pour la restitution et sa
              notification au passage en « Prêt » — sans objet si un abonné est rattaché */}
          {!abonneSelectionne && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sav-client-nom">Nom du client (optionnel)</Label>
                <Input id="sav-client-nom" value={clientNom} onChange={(e) => setClientNom(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="sav-client-telephone">Téléphone du client (optionnel)</Label>
                <Input id="sav-client-telephone" value={clientTelephone} onChange={(e) => setClientTelephone(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="sav-panne">Panne annoncée par le client</Label>
            <Input id="sav-panne" value={descriptionPanne} onChange={(e) => setDescriptionPanne(e.target.value)} className="mt-1" required />
          </div>

          <div>
            <Label htmlFor="sav-etat">État à la réception (accessoires, esthétique)</Label>
            <Input id="sav-etat" value={etatReception} onChange={(e) => setEtatReception(e.target.value)} className="mt-1" />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={sousGarantie} onCheckedChange={(v) => setSousGarantie(v === true)} />
            Sous garantie
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!descriptionPanne.trim() || enCours} onClick={valider}>
            {enCours ? "Ouverture…" : "Ouvrir le dossier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
