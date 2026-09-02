import { useEffect, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chargerApporteurs, rechercherAbonnes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Abonne, Apporteur, NouvelAbonne } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  siteId: number;
  abonneSelectionne: Abonne | NouvelAbonne | null;
  onSelectionner: (abonne: Abonne | NouvelAbonne | null) => void;
}

const AUCUN_APPORTEUR = "aucun";

export function RechercheAbonne({ siteId, abonneSelectionne, onSelectionner }: Props) {
  const { session } = useAuth();
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<Abonne[]>([]);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [nouveau, setNouveau] = useState({ nom: "", prenom: "", telephone: "" });
  const [idApporteur, setIdApporteur] = useState(AUCUN_APPORTEUR);
  const [apporteurs, setApporteurs] = useState<Apporteur[]>([]);

  // recherche unifiée (4.5) — débounce simple pour ne pas spammer l'API à chaque frappe
  useEffect(() => {
    if (!terme.trim() || abonneSelectionne || !session) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      rechercherAbonnes(session.token, siteId, terme)
        .then(setResultats)
        .catch(() => setResultats([]));
    }, 200);
    return () => clearTimeout(identifiant);
  }, [terme, siteId, abonneSelectionne, session]);

  // 6.3 : liste des apporteurs pour le lien permanent, renseigné à la création du client
  useEffect(() => {
    if (!formulaireOuvert || !session) return;
    chargerApporteurs(session.token)
      .then(setApporteurs)
      .catch(() => setApporteurs([]));
  }, [formulaireOuvert, session]);

  if (abonneSelectionne) {
    const libelle =
      "idAbonne" in abonneSelectionne
        ? `${abonneSelectionne.prenom} ${abonneSelectionne.nom} — n° ${abonneSelectionne.idAbonne}`
        : `${abonneSelectionne.prenom} ${abonneSelectionne.nom} (nouveau client)`;
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
        <span className="font-medium text-card-foreground">{libelle}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 cursor-pointer"
          aria-label="Changer d'abonné"
          onClick={() => {
            onSelectionner(null);
            setTerme("");
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex-1 max-w-xl">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
            placeholder="Rechercher un abonné (nom, téléphone, n° abonné)…"
            className="h-11 pl-9 text-base"
            aria-label="Rechercher un abonné"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer gap-2"
          onClick={() => setFormulaireOuvert((v) => !v)}
        >
          <UserPlus className="size-4" />
          Nouveau client
        </Button>
      </div>

      {resultats.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {resultats.map((abonne) => (
            <li key={abonne.idAbonne}>
              <button
                type="button"
                className="flex w-full cursor-pointer flex-col items-start px-4 py-2.5 text-left hover:bg-muted"
                onClick={() => {
                  onSelectionner(abonne);
                  setTerme("");
                  setResultats([]);
                }}
              >
                <span className="font-medium text-popover-foreground">
                  {abonne.prenom} {abonne.nom}
                </span>
                <span className="text-sm text-muted-foreground">
                  n° {abonne.idAbonne} · {abonne.telephone}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {formulaireOuvert && (
        <div className={cn("absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover p-4 shadow-lg")}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nouveau-nom">Nom</Label>
              <Input
                id="nouveau-nom"
                value={nouveau.nom}
                onChange={(e) => setNouveau((n) => ({ ...n, nom: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="nouveau-prenom">Prénom</Label>
              <Input
                id="nouveau-prenom"
                value={nouveau.prenom}
                onChange={(e) => setNouveau((n) => ({ ...n, prenom: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="nouveau-telephone">Téléphone</Label>
              <Input
                id="nouveau-telephone"
                value={nouveau.telephone}
                onChange={(e) => setNouveau((n) => ({ ...n, telephone: e.target.value }))}
                className="mt-1"
              />
            </div>
            {apporteurs.length > 0 && (
              <div className="col-span-2">
                <Label htmlFor="nouveau-apporteur">Apporteur d'affaires (optionnel)</Label>
                <Select value={idApporteur} onValueChange={setIdApporteur}>
                  <SelectTrigger id="nouveau-apporteur" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUCUN_APPORTEUR}>Aucun</SelectItem>
                    {apporteurs.map((a) => (
                      <SelectItem key={a.idApporteur} value={String(a.idApporteur)}>
                        {a.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">Lien définitif — non modifiable après création (6.3).</p>
              </div>
            )}
          </div>
          <Button
            type="button"
            className="mt-3 w-full cursor-pointer"
            disabled={!nouveau.nom || !nouveau.prenom || !nouveau.telephone}
            onClick={() => {
              onSelectionner({
                ...nouveau,
                apporteurId: idApporteur === AUCUN_APPORTEUR ? undefined : Number(idApporteur),
              });
              setFormulaireOuvert(false);
              setNouveau({ nom: "", prenom: "", telephone: "" });
              setIdApporteur(AUCUN_APPORTEUR);
            }}
          >
            Confirmer le nouveau client
          </Button>
        </div>
      )}
    </div>
  );
}
