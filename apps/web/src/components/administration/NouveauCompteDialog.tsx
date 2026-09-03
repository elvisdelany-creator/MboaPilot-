import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { creerCompteUtilisateurRequete, ErreurAuthentification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Role, Site } from "@/lib/types";

interface Props {
  ouvert: boolean;
  sites: Site[];
  onFerme: () => void;
  onSucces: () => void;
}

const LIBELLES_ROLES: Record<Role, string> = {
  ADMINISTRATEUR: "Administrateur",
  GERANT: "Gérant",
  CAISSIER: "Caissier",
  TECHNICIEN_SAV: "Technicien SAV",
  COMPTABLE: "Comptable",
  APPORTEUR: "Apporteur d'affaires",
};
const ROLES: Role[] = ["ADMINISTRATEUR", "GERANT", "CAISSIER", "TECHNICIEN_SAV", "COMPTABLE", "APPORTEUR"];

// 8.7, 2.5.1 : création d'un compte — authentification individuelle
// obligatoire, un rôle et un site rattaché (celui de l'administrateur par
// défaut si l'entreprise n'a qu'un seul site).
export function NouveauCompteDialog({ ouvert, sites, onFerme, onSucces }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [role, setRole] = useState<Role>("CAISSIER");
  const [siteId, setSiteId] = useState<string>("");
  const [enCours, setEnCours] = useState(false);

  function reinitialiser() {
    setNom("");
    setPrenom("");
    setIdentifiant("");
    setMotDePasse("");
    setRole("CAISSIER");
    setSiteId("");
  }

  const pretAValider = nom.trim() && prenom.trim() && identifiant.trim() && motDePasse.length >= 8;

  async function valider() {
    if (!pretAValider) return;
    setEnCours(true);
    try {
      await creerCompteUtilisateurRequete(token, {
        nom: nom.trim(),
        prenom: prenom.trim(),
        identifiant: identifiant.trim(),
        motDePasse,
        role,
        siteId: siteId ? Number(siteId) : undefined,
      });
      toast.success(`Compte « ${identifiant.trim()} » créé.`);
      reinitialiser();
      onSucces();
    } catch (erreur) {
      if (erreur instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(erreur instanceof Error ? erreur.message : "Échec de la création du compte.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Dialog open={ouvert} onOpenChange={(v) => !v && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau compte utilisateur</DialogTitle>
          <DialogDescription>Authentification individuelle obligatoire — pas de compte générique partagé (2.5.1).</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="compte-nom">Nom</Label>
              <Input id="compte-nom" value={nom} onChange={(e) => setNom(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="compte-prenom">Prénom</Label>
              <Input id="compte-prenom" value={prenom} onChange={(e) => setPrenom(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="compte-identifiant">Identifiant de connexion</Label>
            <Input id="compte-identifiant" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="compte-mot-de-passe">Mot de passe (8 caractères minimum)</Label>
            <Input id="compte-mot-de-passe" type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="compte-role">Rôle</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="compte-role" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {LIBELLES_ROLES[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sites.length > 1 && (
            <div>
              <Label htmlFor="compte-site">Site rattaché</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger id="compte-site" className="mt-1 w-full">
                  <SelectValue placeholder="Votre site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.idSite} value={String(s.idSite)}>
                      {s.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onFerme}>
            Annuler
          </Button>
          <Button className="cursor-pointer" disabled={!pretAValider || enCours} onClick={valider}>
            {enCours ? "Création…" : "Créer le compte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
