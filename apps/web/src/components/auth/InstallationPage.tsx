import { useState, type FormEvent } from "react";
import { AIDE_IDENTIFIANT_CONNEXION, erreurIdentifiantConnexion, normaliserIdentifiant, POLITIQUE_MDP_PAR_DEFAUT, validerMotDePasse } from "@mboapilot/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { installerRequete } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const EXIGENCES_MOT_DE_PASSE = [
  `${POLITIQUE_MDP_PAR_DEFAUT.longueurMin} caractères minimum`,
  ...(POLITIQUE_MDP_PAR_DEFAUT.exigerMajuscule ? ["une majuscule"] : []),
  ...(POLITIQUE_MDP_PAR_DEFAUT.exigerChiffre ? ["un chiffre"] : []),
  ...(POLITIQUE_MDP_PAR_DEFAUT.exigerCaractereSpecial ? ["un caractère spécial"] : []),
].join(", ");

// Première installation d'une boutique : une base neuve n'a ni entreprise, ni site, ni compte. Cet écran remplace la
// page de connexion tant qu'aucun compte n'existe ; il crée l'entreprise, la boutique et le premier administrateur,
// avec un mot de passe choisi ici (aucun compte de démonstration), puis ouvre directement sa session.
export function InstallationPage() {
  const { ouvrirSession } = useAuth();
  const [nomEntreprise, setNomEntreprise] = useState("");
  const [nomSite, setNomSite] = useState("Boutique principale");
  const [adresseSite, setAdresseSite] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const identifiantNormalise = normaliserIdentifiant(identifiant);
  const erreurIdentifiant = identifiantNormalise ? erreurIdentifiantConnexion(identifiantNormalise) : null;
  const motDePasseValide = validerMotDePasse(motDePasse, POLITIQUE_MDP_PAR_DEFAUT).length === 0;
  const confirmationDifferente = confirmation !== "" && confirmation !== motDePasse;
  const pret =
    nomEntreprise.trim() !== "" &&
    nomSite.trim() !== "" &&
    prenom.trim() !== "" &&
    nom.trim() !== "" &&
    identifiantNormalise !== "" &&
    erreurIdentifiant === null &&
    motDePasseValide &&
    confirmation === motDePasse;

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (!pret) return;
    setErreur(null);
    setEnCours(true);
    try {
      const { token, utilisateur } = await installerRequete({
        nomEntreprise,
        nomSite,
        adresseSite: adresseSite.trim() || undefined,
        administrateur: { prenom, nom, identifiant, motDePasse },
      });
      ouvrirSession(token, utilisateur);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Échec de l'installation.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-start justify-center bg-background p-4 sm:items-center">
      <Card className="w-full max-w-xl p-6">
        <h1 className="mb-1 font-heading text-xl font-semibold text-foreground">Bienvenue dans MboaPilot</h1>
        <p className="mb-6 text-sm text-muted-foreground">Installation de votre boutique : quelques informations suffisent pour commencer.</p>

        <form onSubmit={soumettre} className="space-y-6">
          <section className="space-y-4" aria-labelledby="installation-boutique">
            <h2 id="installation-boutique" className="font-heading text-base font-semibold text-foreground">
              Votre boutique
            </h2>
            <div>
              <Label htmlFor="installation-entreprise">Nom de l'entreprise</Label>
              <Input id="installation-entreprise" value={nomEntreprise} onChange={(e) => setNomEntreprise(e.target.value)} maxLength={150} className="mt-1 h-11 text-base" required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="installation-site">Nom de la boutique</Label>
                <Input id="installation-site" value={nomSite} onChange={(e) => setNomSite(e.target.value)} maxLength={100} className="mt-1 h-11 text-base" required />
              </div>
              <div>
                <Label htmlFor="installation-adresse">Adresse (facultatif)</Label>
                <Input id="installation-adresse" value={adresseSite} onChange={(e) => setAdresseSite(e.target.value)} maxLength={300} className="mt-1 h-11 text-base" />
              </div>
            </div>
          </section>

          <section className="space-y-4 border-t border-border pt-6" aria-labelledby="installation-admin">
            <div>
              <h2 id="installation-admin" className="font-heading text-base font-semibold text-foreground">
                Votre compte administrateur
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ce compte crée les autres comptes (caissiers, gérants…). Notez bien son mot de passe : l'application ne peut pas le retrouver. Vous pourrez ensuite
                créer un second administrateur par précaution.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="installation-prenom">Prénom</Label>
                <Input id="installation-prenom" autoComplete="given-name" value={prenom} onChange={(e) => setPrenom(e.target.value)} maxLength={100} className="mt-1 h-11 text-base" required />
              </div>
              <div>
                <Label htmlFor="installation-nom">Nom</Label>
                <Input id="installation-nom" autoComplete="family-name" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={100} className="mt-1 h-11 text-base" required />
              </div>
            </div>
            <div>
              <Label htmlFor="installation-identifiant">Identifiant de connexion</Label>
              <Input
                id="installation-identifiant"
                autoComplete="username"
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
                className="mt-1 h-11 text-base"
                aria-describedby="installation-identifiant-aide"
                required
              />
              <p id="installation-identifiant-aide" className={erreurIdentifiant ? "mt-1 text-sm text-destructive" : "mt-1 text-sm text-muted-foreground"}>
                {erreurIdentifiant ?? AIDE_IDENTIFIANT_CONNEXION}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="installation-mot-de-passe">Mot de passe</Label>
                <Input
                  id="installation-mot-de-passe"
                  type="password"
                  autoComplete="new-password"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  className="mt-1 h-11 text-base"
                  aria-describedby="installation-mot-de-passe-aide"
                  required
                />
                <p id="installation-mot-de-passe-aide" className="mt-1 text-sm text-muted-foreground">
                  Exigé : {EXIGENCES_MOT_DE_PASSE}.
                </p>
              </div>
              <div>
                <Label htmlFor="installation-confirmation">Confirmer le mot de passe</Label>
                <Input
                  id="installation-confirmation"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className="mt-1 h-11 text-base"
                  required
                />
                {confirmationDifferente && <p className="mt-1 text-sm text-destructive">Les deux saisies sont différentes.</p>}
              </div>
            </div>
          </section>

          {erreur && (
            <p role="alert" className="rounded-md bg-alert-j1-bg px-3 py-2 text-sm text-alert-j1-fg">
              {erreur}
            </p>
          )}

          <Button type="submit" className="h-11 w-full cursor-pointer text-base" disabled={!pret || enCours}>
            {enCours ? "Installation…" : "Installer et commencer"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
