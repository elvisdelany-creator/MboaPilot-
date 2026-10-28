import { useEffect, useState } from "react";
import { LIMITE_RESULTATS_RECHERCHE_ABONNES, MESSAGE_FORME_TELEPHONE, memeTelephone, telephoneValide } from "@mboapilot/shared";
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
  const telephoneInvalide = nouveau.telephone.trim() !== "" && !telephoneValide(nouveau.telephone);
  // 7.1 : « si le client existe déjà (recherche par téléphone…), sa fiche existante est sélectionnée » — avant de créer, on cherche un client
  // qui a ce numéro et on le propose ; un numéro peut être partagé (famille), donc on ne bloque jamais
  const [doublons, setDoublons] = useState<Abonne[]>([]);
  const [verificationEnCours, setVerificationEnCours] = useState(false);
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

  function fermerFormulaire() {
    setFormulaireOuvert(false);
    setNouveau({ nom: "", prenom: "", telephone: "" });
    setIdApporteur(AUCUN_APPORTEUR);
    setDoublons([]);
  }

  function creerClient() {
    onSelectionner({
      nom: nouveau.nom.trim(),
      prenom: nouveau.prenom.trim(),
      telephone: nouveau.telephone.trim(),
      apporteurId: idApporteur === AUCUN_APPORTEUR ? undefined : Number(idApporteur),
    });
    fermerFormulaire();
  }

  async function confirmerNouveauClient() {
    if (!session) return;
    setVerificationEnCours(true);
    try {
      const memeNumero = (await rechercherAbonnes(session.token, siteId, nouveau.telephone.trim())).filter((a) => memeTelephone(a.telephone, nouveau.telephone));
      if (memeNumero.length > 0) {
        setDoublons(memeNumero);
        return;
      }
    } catch {
      // la vérification est une aide : si elle échoue, elle ne doit pas empêcher la vente
    } finally {
      setVerificationEnCours(false);
    }
    creerClient();
  }

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
          {resultats.length >= LIMITE_RESULTATS_RECHERCHE_ABONNES && (
            <li role="status" className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {LIMITE_RESULTATS_RECHERCHE_ABONNES} premiers résultats — précisez le nom ou le téléphone pour affiner.
            </li>
          )}
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
                maxLength={100}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="nouveau-prenom">Prénom</Label>
              <Input
                id="nouveau-prenom"
                value={nouveau.prenom}
                onChange={(e) => setNouveau((n) => ({ ...n, prenom: e.target.value }))}
                maxLength={100}
                className="mt-1"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="nouveau-telephone">Téléphone</Label>
              <Input
                id="nouveau-telephone"
                type="tel"
                value={nouveau.telephone}
                onChange={(e) => {
                  setNouveau((n) => ({ ...n, telephone: e.target.value }));
                  setDoublons([]);
                }}
                maxLength={30}
                aria-invalid={telephoneInvalide ? true : undefined}
                aria-describedby={telephoneInvalide ? "nouveau-telephone-erreur" : undefined}
                className="mt-1"
              />
              {/* vérifié pendant la saisie : l'API ne le refusait qu'à la fin de la vente, après le paiement */}
              {telephoneInvalide && (
                <p id="nouveau-telephone-erreur" className="mt-1 text-xs text-destructive">
                  Le téléphone {MESSAGE_FORME_TELEPHONE}.
                </p>
              )}
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
          {doublons.length > 0 && (
            <div role="alert" className="mt-3 rounded-lg border border-alert-j3-fg/40 bg-alert-j3-bg/25 p-3">
              <p className="text-sm font-medium text-card-foreground">
                {doublons.length === 1 ? "Ce numéro est déjà celui d'un client :" : "Ce numéro est déjà celui de plusieurs clients :"}
              </p>
              <ul className="mt-2 space-y-2">
                {doublons.slice(0, 3).map((a) => (
                  <li key={a.idAbonne} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 text-sm text-card-foreground">
                      {a.prenom} {a.nom} — n° {a.idAbonne}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="cursor-pointer"
                      onClick={() => {
                        onSelectionner(a);
                        fermerFormulaire();
                      }}
                    >
                      Utiliser cette fiche
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-card-foreground">Un numéro peut être partagé (famille) : vous pouvez aussi créer un nouveau client.</p>
            </div>
          )}
          <Button
            type="button"
            className="mt-3 w-full cursor-pointer"
            disabled={!nouveau.nom.trim() || !nouveau.prenom.trim() || !telephoneValide(nouveau.telephone) || verificationEnCours}
            onClick={doublons.length > 0 ? creerClient : confirmerNouveauClient}
          >
            {verificationEnCours ? "Vérification…" : doublons.length > 0 ? "Créer un nouveau client quand même" : "Confirmer le nouveau client"}
          </Button>
        </div>
      )}
    </div>
  );
}
