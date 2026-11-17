import { dateHeureDouala, formaterValeurEtat, libellePeriodeEtat, type EtatImprimable, type SectionEtat } from "@mboapilot/shared";
import { cn } from "@/lib/utils";

// Affiche n'importe quel état (`EtatImprimable`) en feuille blanche : à l'écran comme à l'impression A4. Quand un nouvel état s'ajoute côté serveur,
// aucun écran n'est à écrire. Les tableaux répètent leur en-tête à chaque page imprimée et ne coupent pas une ligne en deux.

function TableauEtat({ section }: { section: SectionEtat }) {
  const { colonnes } = section;
  const alignement = (a: "gauche" | "droite") => (a === "droite" ? "text-right tabular-nums" : "text-left");
  return (
    <section className="space-y-1.5">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-700 print:break-after-avoid">{section.titre}</h3>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-xs leading-snug">
          <thead className="print:table-header-group">
            <tr className="bg-neutral-200">
              {colonnes.map((c) => (
                <th key={c.cle} scope="col" className={cn("px-2 py-1 font-semibold", alignement(c.alignement))}>
                  {c.libelle}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.lignes.length === 0 && (
              <tr>
                <td colSpan={colonnes.length} className="px-2 py-2 italic text-neutral-700">
                  {section.messageVide ?? "Aucune donnée"}
                </td>
              </tr>
            )}
            {section.lignes.map((ligne, i) => (
              <tr key={i} className="border-b border-neutral-300 print:break-inside-avoid">
                {ligne.map((valeur, j) => (
                  <td key={colonnes[j].cle} className={cn("px-2 py-1 align-top", alignement(colonnes[j].alignement))}>
                    {formaterValeurEtat(valeur, colonnes[j].type)}
                  </td>
                ))}
              </tr>
            ))}
            {section.totaux && (
              <tr className="border-t-2 border-neutral-800 font-semibold print:break-inside-avoid">
                {section.totaux.map((valeur, j) => (
                  <td key={colonnes[j].cle} className={cn("px-2 py-1 align-top", alignement(colonnes[j].alignement))}>
                    {formaterValeurEtat(valeur, colonnes[j].type)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EtatImprime({ etat }: { etat: EtatImprimable }) {
  return (
    <article className="mx-auto w-full max-w-4xl space-y-6 bg-white p-6 text-neutral-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <header className="etat-entete space-y-0.5">
        <p className="font-heading text-lg font-bold">{etat.entete.nomBoutique}</p>
        {etat.entete.lignesContact.map((ligne) => (
          <p key={ligne} className="text-xs text-neutral-700">
            {ligne}
          </p>
        ))}
        <h2 className="pt-3 font-heading text-xl font-bold">{etat.titre}</h2>
        <p className="text-sm">Période : {libellePeriodeEtat(etat.periode)}</p>
        <p className="text-xs text-neutral-700">Généré le {dateHeureDouala(etat.genereLe)}</p>
        {etat.avertissements.map((avertissement) => (
          <p key={avertissement} role="status" className="pt-1 text-sm font-semibold text-red-800">
            Attention : {avertissement}
          </p>
        ))}
      </header>
      {etat.sections.map((section) => (
        <TableauEtat key={section.titre} section={section} />
      ))}
    </article>
  );
}
