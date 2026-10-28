/*
 * Service worker de los avisos push al personal. Solo hace dos cosas: mostrar el aviso cuando llega y abrir la cita
 * al tocarlo. No guarda nada en caché: la app siempre lee lo último.
 */
self.addEventListener("push", (evento) => {
  let datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch {
    datos = {};
  }
  evento.waitUntil(
    self.registration.showNotification(datos.titulo || "Barberías", {
      body: datos.cuerpo || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: datos.tag,
      data: { url: datos.url || "/agenda" },
    })
  );
});

/** Solo se abren direcciones de esta misma app: cualquier otra cosa cae en la agenda. */
function direccionSegura(url) {
  try {
    const destino = new URL(url, self.location.origin);
    return destino.origin === self.location.origin ? destino.href : "/agenda";
  } catch {
    return "/agenda";
  }
}

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const url = direccionSegura((evento.notification.data && evento.notification.data.url) || "/agenda");
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ("focus" in v) {
          v.navigate(url);
          return v.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
