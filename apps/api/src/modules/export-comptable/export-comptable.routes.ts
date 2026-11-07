import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";
import { apercuExportComptable, exporterJournalEncaissementsCsv, exporterJournalVentesCsv, type PeriodeExport } from "./export-comptable.service.js";

type Requete = { Querystring: { du?: string; au?: string } };

// Export comptable : le comptable, la gérance et l'administration (comme le pilotage financier). Le site est celui du jeton : une
// requête ne désigne jamais la boutique d'un autre.
export function registerExportComptableRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; pilotage: Guard }) {
  const preHandler = [guards.authRequis, guards.pilotage];
  const periode = (q: Requete["Querystring"]) => ({ du: q.du, au: q.au }) as PeriodeExport;

  app.get<Requete>("/api/v1/export-comptable/apercu", { preHandler }, async (request, reply) => {
    try {
      reply.code(200).send(apercuExportComptable(db, request.user.siteId, periode(request.query)));
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  for (const [chemin, nom, exporter] of [
    ["ventes", "journal-ventes", exporterJournalVentesCsv],
    ["encaissements", "journal-encaissements", exporterJournalEncaissementsCsv],
  ] as const) {
    app.get<Requete>(`/api/v1/export-comptable/${chemin}`, { preHandler }, async (request, reply) => {
      try {
        const p = periode(request.query);
        const { csv } = exporter(db, request.user.siteId, p);
        reply
          .code(200)
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", `attachment; filename=${nom}-${p.du}-${p.au}.csv`)
          .send(csv);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    });
  }
}
