import * as React from "react"

import { cn } from "@/lib/utils"

// Un champ numérique est « entier » par défaut : montants en FCFA, quantités,
// durées en jours… n'ont pas de décimales, et l'API les refuse (« doit être un
// nombre entier »). Plutôt que de laisser saisir « 1500,5 » puis de refuser à
// l'enregistrement, la saisie des séparateurs décimaux et de l'exposant est bloquée.
// Un champ qui attend des décimales le déclare par un pas non entier (step="0.01").
const TOUCHES_NON_ENTIERES = [".", ",", "e", "E", "+"]
const CONTIENT_NON_ENTIER = /[.,eE+]/

function Input({ className, type, onKeyDown, onPaste, inputMode, step, ...props }: React.ComponentProps<"input">) {
  const entier = type === "number" && step !== "any" && (step === undefined || Number.isInteger(Number(step)))

  return (
    <input
      type={type}
      step={step}
      inputMode={inputMode ?? (entier ? "numeric" : undefined)}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      onKeyDown={(e) => {
        if (entier && TOUCHES_NON_ENTIERES.includes(e.key)) e.preventDefault()
        onKeyDown?.(e)
      }}
      onPaste={(e) => {
        if (entier && CONTIENT_NON_ENTIER.test(e.clipboardData.getData("text"))) e.preventDefault()
        onPaste?.(e)
      }}
      {...props}
    />
  )
}

export { Input }
