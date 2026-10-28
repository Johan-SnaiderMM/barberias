import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Campo de texto: 48 px de alto y 16 px de letra (más pequeño, iOS hace zoom al enfocar). */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-12 w-full rounded-xl border border-borde-campo bg-white px-3 text-base text-tinta placeholder:text-tinta-2",
        "focus-visible:border-tinta focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tinta",
        "disabled:border-dashed disabled:border-zinc-300 disabled:bg-hueso",
        className
      )}
      {...props}
    />
  );
}
