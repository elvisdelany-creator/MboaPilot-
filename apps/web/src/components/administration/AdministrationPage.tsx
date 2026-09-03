import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, ShieldCheck } from "lucide-react";
import {
  chargerJournalAudit,
  chargerSites,
  chargerUtilisateurs,
  ErreurAuthentification,
  modifierCompteUtilisateurRequete,
  modifierSiteRequete,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NouveauCompteDialog } from "./NouveauCompteDialog";
import { NouveauSiteDialog } from "./NouveauSiteDialog";
import type { CompteUtilisateur, EntreeJournalAudit, Role, Site } from "@/lib/types";

interface Props {
  onNaviguer: (vue: Vue) => void;
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
const LIBELLES_ACTION: Record<string, string> = { CREATION: "Création", MODIFICATION: "Modification", SUPPRESSION: "Suppression" };
const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

// 8.7 : gestion des comptes utilisateurs, des sites de l'entreprise et
// consultation du journal d'audit (11.5) — réservé à l'Administrateur. La
// bascule de supervision entre plusieurs sites (2.5.2) est différée en V2
// (12.1) ; ici chaque administrateur gère le site auquel il est rattaché.
export function AdministrationPage({ onNaviguer }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;
  const utilisateur = session!.utilisateur;

  const [comptes, setComptes] = useState<CompteUtilisateur[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [journal, setJournal] = useState<EntreeJournalAudit[] | null>(null);
  const [filtreTable, setFiltreTable] = useState("");
  const [nouveauCompteOuvert, setNouveauCompteOuvert] = useState(false);
  const [nouveauSiteOuvert, setNouveauSiteOuvert] = useState(false);

  function gererErreur(erreur: unknown, messageParDefaut: string) {
    if (erreur instanceof ErreurAuthentification) {
      toast.error("Session expirée — veuillez vous reconnecter.");
      deconnecter();
      return;
    }
    toast.error(erreur instanceof Error ? erreur.message : messageParDefaut);
  }

  function rechargerComptes() {
    chargerUtilisateurs(token)
      .then(setComptes)
      .catch((e) => gererErreur(e, "Impossible de charger les comptes utilisateurs."));
  }

  function rechargerSites() {
    chargerSites(token)
      .then(setSites)
      .catch((e) => gererErreur(e, "Impossible de charger les sites."));
  }

  function rechargerJournal() {
    chargerJournalAudit(token, filtreTable.trim() || undefined)
      .then(setJournal)
      .catch((e) => gererErreur(e, "Impossible de charger le journal d'audit."));
  }

  useEffect(rechargerComptes, [token]);
  useEffect(rechargerSites, [token]);
  useEffect(() => {
    const identifiant = setTimeout(rechargerJournal, 200);
    return () => clearTimeout(identifiant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filtreTable]);

  async function changerRole(compte: CompteUtilisateur, role: Role) {
    try {
      await modifierCompteUtilisateurRequete(token, compte.idUser, { role });
      rechargerComptes();
    } catch (erreur) {
      gererErreur(erreur, "Échec du changement de rôle.");
    }
  }

  async function basculerActifCompte(compte: CompteUtilisateur) {
    try {
      await modifierCompteUtilisateurRequete(token, compte.idUser, { actif: compte.actif !== 1 });
      toast.success(compte.actif === 1 ? `Compte « ${compte.identifiant} » désactivé.` : `Compte « ${compte.identifiant} » réactivé.`);
      rechargerComptes();
    } catch (erreur) {
      gererErreur(erreur, "Échec de la mise à jour du compte.");
    }
  }

  async function basculerActifSite(site: Site) {
    try {
      await modifierSiteRequete(token, site.idSite, { actif: site.actif !== 1 });
      rechargerSites();
    } catch (erreur) {
      gererErreur(erreur, "Échec de la mise à jour du site.");
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <AppHeader vueActive="administration" onNaviguer={onNaviguer} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <h1 className="font-heading text-lg font-semibold text-foreground">Administration</h1>
              <p className="text-sm text-muted-foreground">Comptes utilisateurs, sites et journal d'audit (8.7).</p>
            </div>
          </div>

          <Tabs defaultValue="utilisateurs">
            <TabsList>
              <TabsTrigger value="utilisateurs">Utilisateurs</TabsTrigger>
              <TabsTrigger value="sites">Sites</TabsTrigger>
              <TabsTrigger value="audit">Journal d'audit</TabsTrigger>
            </TabsList>

            <TabsContent value="utilisateurs" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comptes ({comptes?.length ?? 0})</p>
                <Button size="sm" className="cursor-pointer gap-1" onClick={() => setNouveauCompteOuvert(true)}>
                  <Plus className="size-4" />
                  Nouveau compte
                </Button>
              </div>
              <ul className="space-y-2">
                {comptes?.map((c) => {
                  const soiMeme = c.idUser === utilisateur.idUser;
                  return (
                    <li key={c.idUser}>
                      <Card className="flex-row items-center justify-between gap-3 p-3">
                        <div>
                          <p className="font-medium text-card-foreground">
                            {c.prenom} {c.nom} {soiMeme && <span className="text-muted-foreground">(vous)</span>}
                          </p>
                          <p className="text-sm text-muted-foreground">@{c.identifiant}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Select value={c.role} onValueChange={(v) => changerRole(c, v as Role)}>
                            <SelectTrigger className="h-9 w-44" aria-label={`Rôle de ${c.prenom} ${c.nom}`}>
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
                          <Badge variant={c.actif === 1 ? "default" : "outline"}>{c.actif === 1 ? "Actif" : "Inactif"}</Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            className="cursor-pointer"
                            disabled={soiMeme && c.actif === 1}
                            title={soiMeme && c.actif === 1 ? "Impossible de désactiver votre propre compte" : undefined}
                            onClick={() => basculerActifCompte(c)}
                          >
                            {c.actif === 1 ? "Désactiver" : "Réactiver"}
                          </Button>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>

            <TabsContent value="sites" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sites ({sites.length})</p>
                <Button size="sm" className="cursor-pointer gap-1" onClick={() => setNouveauSiteOuvert(true)}>
                  <Plus className="size-4" />
                  Nouveau site
                </Button>
              </div>
              <ul className="space-y-2">
                {sites.map((s) => (
                  <li key={s.idSite}>
                    <Card className="flex-row items-center justify-between gap-3 p-3">
                      <div>
                        <p className="font-medium text-card-foreground">{s.nom}</p>
                        {s.adresse && <p className="text-sm text-muted-foreground">{s.adresse}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={s.actif === 1 ? "default" : "outline"}>{s.actif === 1 ? "Actif" : "Inactif"}</Badge>
                        <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => basculerActifSite(s)}>
                          {s.actif === 1 ? "Désactiver" : "Réactiver"}
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </TabsContent>

            <TabsContent value="audit" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entrées ({journal?.length ?? 0})</p>
                <Input
                  value={filtreTable}
                  onChange={(e) => setFiltreTable(e.target.value)}
                  placeholder="Filtrer par table cible (ex. abonne, produit)…"
                  className="h-9 w-72"
                />
              </div>
              {journal?.length === 0 && <p className="text-sm text-muted-foreground">Aucune entrée.</p>}
              <ul className="space-y-1.5">
                {journal?.map((entree) => (
                  <li key={entree.idAudit}>
                    <Card className="gap-1 p-3">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-card-foreground">
                          {LIBELLES_ACTION[entree.action]} — {entree.tableCible} n° {entree.idCible}
                        </span>
                        <span className="text-xs text-muted-foreground">{formateurDateHeure.format(new Date(entree.dateAction))}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Par {entree.utilisateurPrenom} {entree.utilisateurNom}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <NouveauCompteDialog
        ouvert={nouveauCompteOuvert}
        sites={sites}
        onFerme={() => setNouveauCompteOuvert(false)}
        onSucces={() => { setNouveauCompteOuvert(false); rechargerComptes(); }}
      />

      <NouveauSiteDialog
        ouvert={nouveauSiteOuvert}
        onFerme={() => setNouveauSiteOuvert(false)}
        onSucces={() => { setNouveauSiteOuvert(false); rechargerSites(); }}
      />
    </div>
  );
}
