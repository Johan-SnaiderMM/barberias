import { redirect } from "next/navigation";

/** La portada pública (la reserva) llega en la Fase 2; por ahora la raíz lleva al personal. Sin sesión, /inicio manda a /entrar. */
export default function Raiz() {
  redirect("/inicio");
}
