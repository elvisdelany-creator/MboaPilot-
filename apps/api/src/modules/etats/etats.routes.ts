import type { FastifyInstance } from "fastify";
import { etatVersCsv, nomFichierEtat } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";
import type { PeriodeExport } from "../export-comptable/export-comptable.service.js";
import { construireEtatVentesCedant } from "./etat-ventes.service.js";
import { rendreEtatPdf } from "./etat-pdf.js";

type Requete = { Querystring: { du?: string; au?: string } };

// États de gestion : l'administration, la gérance et le comptable (comme le pilotage financier et l'export comptable). La boutique est celle de la
// session : une requête ne désigne jamais celle d'une autre, et un éventuel siteId dans l'adresse est ignoré.
export function registerEtatsRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; pilotage: Guard }) {
  const preHandler = [guards.authRequis, guards.pilotage];
  const periode = (q: Requete["Querystring"]) => ({ du: q.du, au: q.au }) as PeriodeExport;

  app.get<Requete>("/api/v1/etats/ventes", { preHandler }, async (request, reply) => {
    try {
      reply.code(200).send(await construireEtatVentesCedant(db, request.user.siteId, periode(request.query)));
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  app.get<Requete>("/api/v1/etats/ventes/csv", { preHandler }, async (request, reply) => {
    try {
      // Le CSV n'est jamais limité : c'est le recours que l'avertissement des autres formes propose (« …ou utilisez le CSV »). Une limite infinie
      // garde donc toutes les factures du détail, sans avertissement, avec la ligne de totaux du détail.
      const etat = await construireEtatVentesCedant(db, request.user.siteId, periode(request.query), { limiteDetail: Number.POSITIVE_INFINITY });
      reply
        .code(200)
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename=${nomFichierEtat(etat, "csv")}`)
        .send(etatVersCsv(etat));
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  app.get<Requete>("/api/v1/etats/ventes/pdf", { preHandler }, async (request, reply) => {
    try {
      const etat = await construireEtatVentesCedant(db, request.user.siteId, periode(request.query));
      const pdf = await rendreEtatPdf(etat);
      reply
        .code(200)
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename=${nomFichierEtat(etat, "pdf")}`)
        .send(pdf);
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });
}
