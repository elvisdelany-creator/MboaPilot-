import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { creerComptePartageRequete, modifierComptePartageRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { ComptePartage, Famille } from "@/lib/types";

interface Props {
  ouvert: boolean;
  familles: Famille[];
  compte: ComptePartage | null; // non-null = édition, null = création
  onFerme: () => void;
  onSucces: () => void;
}

// 5.9 : création/édition d'un compte fournisseur mutualisé — identifiants
// stockés en clair (mode local, 2.2), visibilité déjà restreinte par le rôle
// requis pour accéder à cet écran (11.2).
export function NouveauComptePartageDialog({ ouvert, familles, compte, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;
  const edition = compte !== null;

  const [idFamille, setIdFamille] = useState("");
  const [libelle, setLibelle] = useState("");
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [nombreEcransMax, setNombreEcransMax] = useState("4");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setIdFamille(compte ? String(compte.idFamille) : "");
    setLibelle(compte?.libelle ?? "");
    setIdentifiant(compte?.identifiant ?? "");
    setMotDePasse(compte?.motDePasse ?? "");
    setNombreEcransMax(compte ? String(compte.nombreEcransMax) : "4");
  }, [ouvert, compte]);

  const pretAValider = idFamille && libelle.trim() && Number(nombreEcransMax) > 0;

  async function valider() {
    if (!pretAValider) return;
    setEnCours(true);
    try {
      if (edition && compte) {
        await modifierComptePartageRequete(token, compte.idComptePartage, {
          libelle: libelle.trim(),
          identifiant: identifiant.trim() || undefined,
          motDePasse: motDePasse || undefined,
          nombreEcransMax: Number(nombreEcransMax),
        });
        toast.success(`Compte « ${libelle.trim()} » modifié.`);
      } else {
        await creerComptePartageRequete(token, {
          siteId: utilisateur.siteId,
          idFamille: Number(idFamille),
          libelle: libelle.trim(),
          identifiant: identifiant.trim() || undefined,
          motDePasse: motDePasse || undefined,
          nombreEcransMax: Number(nombreEcransMax),
        });
        toast.success(`Compte « ${libelle.trim()} » créé.`);
      }
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de l'enregistrement du compte.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{edition ? "Modifier le compte partagé" : "Nouveau compte partagé"}</DialogTitle>
          <DialogDescription>Compte fournisseur mutualisé (Netflix, Prime Vidéo, IPTV…) — plusieurs abonnés occupent chacun un écran.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="compte-partage-famille">Famille (service)</Label>
            <Select value={idFamille} onValueChange={setIdFamille} disabled={edition}>
              <SelectTrigger id="compte-partage-famille" className="mt-1 w-full">
                <SelectValue placeholder="Choisir un service" />
              </SelectTrigger>
              <SelectContent>
                {familles.map((f) => (
                  <SelectItem key={f.idFamille} value={String(f.idFamille)}>
                    {f.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="compte-partage-libelle">Libellé</Label>
            <Input id="compte-partage-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Compte Netflix Premium #1" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="compte-partage-identifiant">Identifiant</Label>
              <Input id="compte-partage-identifiant" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="compte-partage-mot-de-passe">Mot de passe / code d'accès</Label>
              <Input id="compte-partage-mot-de-passe" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="compte-partage-ecrans">Nombre d'écrans simultanés autorisés</Label>
            <Input
              id="compte-partage-ecrans"
              type="number"
              min={1}
              value={nombreEcransMax}
              onChange={(e) => setNombreEcransMax(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pretAValider || enCours} onClick={valider}>
            {enCours ? "Enregistrement…" : edition ? "Enregistrer" : "Créer le compte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
