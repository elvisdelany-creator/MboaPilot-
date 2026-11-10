import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth-context";
import { useEtatDemo } from "@/lib/demo";
import type { CompteDemo } from "@/lib/api";

// ce que chaque compte de démonstration permet de voir, en une ligne
const DESCRIPTION_COMPTE_DEMO: Record<string, string> = {
  GERANT: "Tableau de bord, catalogue, stock, clients",
  CAISSIER: "Caisse, ventes, encaissements, clients",
  TECHNICIEN_SAV: "Dossiers de réparation",
};

// 2.5.1 : authentification individuelle obligatoire — pas de compte générique partagé (sauf la démo publique, dont les comptes sont
// affichés ici : la boutique est fictive)
export function LoginPage() {
  const { connecter } = useAuth();
  const demo = useEtatDemo();
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function ouvrirSession(id: string, mdp: string) {
    setErreur(null);
    setEnCours(true);
    try {
      await connecter(id, mdp);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Échec de la connexion.");
    } finally {
      setEnCours(false);
    }
  }

  function soumettre(e: FormEvent) {
    e.preventDefault();
    void ouvrirSession(identifiant, motDePasse);
  }

  function seConnecterEnDemo(compte: CompteDemo) {
    void ouvrirSession(compte.identifiant, compte.motDePasse);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-center font-heading text-xl font-semibold text-foreground">MboaPilot</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">Connexion à la caisse</p>

        {demo?.actif && demo.comptes && (
          <>
            <section aria-labelledby="demo-titre">
              <h2 id="demo-titre" className="font-heading text-base font-semibold text-foreground">
                Démo publique
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Boutique fictive, remise à zéro régulièrement. Choisissez un rôle pour l'essayer en un clic.</p>
              <div className="mt-3 grid gap-2">
                {demo.comptes.map((c) => (
                  <Button
                    key={c.identifiant}
                    type="button"
                    variant="outline"
                    className="h-auto w-full cursor-pointer flex-col items-start gap-0 py-2"
                    disabled={enCours}
                    onClick={() => seConnecterEnDemo(c)}
                  >
                    <span className="text-base font-semibold">{c.libelle}</span>
                    <span className="text-xs font-normal text-muted-foreground">{DESCRIPTION_COMPTE_DEMO[c.role] ?? ""}</span>
                  </Button>
                ))}
              </div>
            </section>
            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              <span>ou avec un identifiant</span>
              <Separator className="flex-1" />
            </div>
          </>
        )}

        <form onSubmit={soumettre} className="space-y-4">
          <div>
            <Label htmlFor="identifiant">Identifiant</Label>
            <Input
              id="identifiant"
              autoComplete="username"
              value={identifiant}
              onChange={(e) => setIdentifiant(e.target.value)}
              className="mt-1 h-11 text-base"
              required
            />
          </div>
          <div>
            <Label htmlFor="mot-de-passe">Mot de passe</Label>
            <Input
              id="mot-de-passe"
              type="password"
              autoComplete="current-password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              className="mt-1 h-11 text-base"
              required
            />
          </div>

          {erreur && (
            <p role="alert" className="rounded-md bg-alert-j1-bg px-3 py-2 text-sm text-alert-j1-fg">
              {erreur}
            </p>
          )}

          <Button type="submit" className="h-11 w-full cursor-pointer text-base" disabled={enCours}>
            {enCours ? "Connexion…" : "Se connecter"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
