import "server-only";
import { usarBdLocal } from "@/lib/supabase/servidor";

/**
 * ¿Esta instalación ofrece «Probar la demo»? Solo si tiene la cuenta de la demo configurada (DEMO_EMAIL y
 * DEMO_PASSWORD, variables del servidor) o corre en modo local. Una instalación de un cliente de verdad no las lleva,
 * así su pantalla de entrada no ofrece una demo que no existe.
 */
export function demoDisponible(): boolean {
  return usarBdLocal() || Boolean(process.env.DEMO_EMAIL?.trim() && process.env.DEMO_PASSWORD);
}
