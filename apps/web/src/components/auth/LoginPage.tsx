import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";

// 2.5.1 : authentification individuelle obligatoire — pas de compte générique partagé
export function LoginPage() {
  const { connecter } = useAuth();
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await connecter(identifiant, motDePasse);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Échec de la connexion.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-center font-heading text-xl font-semibold text-foreground">MboaPilot</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">Connexion à la caisse</p>

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
