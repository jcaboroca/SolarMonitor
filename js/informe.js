// Informe diario: vista, ajustes y notificaciones push en el navegador.
// El servidor genera el informe a las 08:30 (Madrid) a partir del archivo de SolarMAN; aqui solo se
// lee con la clave maestra de siempre (misma puerta que el resto del Worker). El permiso de
// notificaciones se pide unicamente al pulsar "Activar".

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const SENALES = { solar: "Sol", casa: "Casa", compra: "Compra", venta: "Venta", carga: "Carga batería", descarga: "Descarga batería" };
const ESTADOS = { ok: ["ok", "Completo"], parcial: ["parcial", "Parcial"], sin_datos: ["fallo", "Sin datos"], error: ["fallo", "Error"] };
const ENTREGA = { enviado: "aviso enviado", pendiente: "aviso pendiente de reintento", fallido: "aviso no entregado", sin_vapid: "avisos sin configurar en el servidor", desactivado: "avisos desactivados", sin_suscripciones: "sin dispositivos suscritos", no_aplica: "" };

const escapar = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const numero = (t) => {
  const limpio = String(t ?? "").trim().replace(",", ".");
  return limpio === "" ? null : Number(limpio);
};

export function fechaDeHash(hash) {
  const m = /^#informe=(.+)$/.exec(hash || "");
  return m && FECHA.test(m[1]) ? m[1] : null;
}

const fechaLarga = (f) => (FECHA.test(f || "") ? new Date(`${f}T12:00:00Z`).toLocaleDateString("es-ES", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");

/** Estado de lo necesario para recibir push. En iPhone: iOS 16.4+ y app instalada en la pantalla de inicio. */
export function capacidadPush({ ua = "", standalone = false, seguro = true, serviceWorker = true, notification = true, pushManager = true, permiso = "default" } = {}) {
  const r = (estado, mensaje) => ({ estado, mensaje });
  const ios = /iPhone|iPad|iPod/.test(ua);
  if (ios) {
    const v = /OS (\d+)[_.](\d+)/.exec(ua);
    if (v && (Number(v[1]) < 16 || (Number(v[1]) === 16 && Number(v[2]) < 4))) return r("version", "Las notificaciones web en iPhone necesitan iOS 16.4 o posterior. Actualiza el iPhone para activarlas.");
    if (!standalone) return r("instalar", "En iPhone hay que instalar la web: abre esta página en Safari, pulsa Compartir y elige «Añadir a pantalla de inicio». Después abre Solar Monitor desde ese icono y vuelve aquí (iOS 16.4 o posterior).");
  }
  if (!seguro || !serviceWorker || !notification || !pushManager) return r("sin_soporte", "Este navegador no permite notificaciones push de una web (hace falta HTTPS, service worker, Notification y PushManager). El informe se puede leer igualmente aquí.");
  if (permiso === "denied") return r("denegado", "Las notificaciones están bloqueadas para esta web. En el iPhone: Ajustes › Notificaciones › Solar Monitor (o Ajustes › Apps › Safari › Avisos) y permítelas; luego vuelve aquí y pulsa Activar.");
  return r("ok", permiso === "granted" ? "Permiso concedido." : "Aún no se ha pedido permiso: se pedirá solo cuando pulses Activar.");
}

export function claveABytes(b64url) {
  const limpio = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(limpio.padEnd(Math.ceil(limpio.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
}

/** Convierte los valores crudos del formulario en el cuerpo que valida el servidor. */
export function configDeFormulario(v) {
  const consentimiento = v.consentimiento === true;
  const lat = numero(v.lat);
  const lon = numero(v.lon);
  const config = {
    consentimiento,
    activo: consentimiento && v.activo === true,
    pushActivo: consentimiento && v.pushActivo === true,
    ubicacion: lat === null && lon === null ? null : { lat, lon },
    tarifa: null,
  };
  if (v.tipo) {
    const t = { tipo: v.tipo, desde: v.desde || null, hasta: v.hasta || null, fuente: v.fuente || "" };
    if (v.tipo === "plana") t.precio = numero(v.precio);
    if (v.tipo === "periodos") Object.assign(t, { P1: numero(v.p1), P2: numero(v.p2), P3: numero(v.p3) });
    if (v.tipo === "indexada") {
      t.aceptaEstimacion = v.aceptaEstimacion === true;
      if (t.aceptaEstimacion) t.mediaHistorica = { P1: numero(v.p1), P2: numero(v.p2), P3: numero(v.p3) };
    }
    config.tarifa = t;
  }
  return config;
}

// ---------------------------------------------------------------- Pintado

const lista = (items) => (items.length ? `<ul>${items.map((i) => `<li>${escapar(i)}</li>`).join("")}</ul>` : "");

export function htmlInforme(i) {
  const [clase, rotulo] = ESTADOS[i.estado] || ["fallo", "Desconocido"];
  const cobertura = Object.entries(i.cobertura || {})
    .filter(([k]) => SENALES[k])
    .map(([k, c]) => `<li><span>${SENALES[k]}</span> <b>${Math.round((c ?? 0) * 100)} %</b></li>`)
    .join("");
  const coste = i.coste?.estado === "no_disponible" ? `Coste no disponible: ${i.coste.motivo ?? ""}` : i.coste ? `${i.coste.estado === "estimado" ? "Estimación del coste" : "Coste de la energía comprada"}: ≈ ${(i.coste.euros ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })} € (${i.coste.aviso ?? ""})` : "";
  const hoy = i.hoy;
  return `
<header class="informe-cabecera">
  <h3>Informe del ${escapar(fechaLarga(i.fecha) || i.fecha)}</h3>
  <p><span class="insignia insignia-${clase}">${rotulo}</span> <span class="insignia">${escapar(i.fuente?.nombre ?? "Fuente desconocida")}</span>${i.fuente?.datadis ? "" : ' <span class="insignia">Sin Datadis</span>'}</p>
  <p class="ayuda">Generado el ${escapar(i.generado ? new Date(i.generado).toLocaleString("es-ES") : "—")}${i.horasEsperadas ? ` · día de ${i.horasEsperadas} h` : ""}. ${escapar(i.fuente?.nota ?? "")}</p>
</header>
<section class="informe-bloque"><h4>Lo que pasó ayer</h4>
  ${(i.conclusiones || []).map((c) => `<p class="informe-${escapar(c.tipo)}">${escapar(c.texto)}</p>`).join("")}
  <p>${escapar(coste)}</p>
  ${i.mes?.aviso ? `<p class="ayuda">${escapar(i.mes.aviso)}</p>` : ""}
</section>
<section class="informe-bloque"><h4>Cobertura de datos</h4><ul class="informe-cobertura">${cobertura}</ul></section>
<section class="informe-bloque"><h4>Hoy</h4>
  ${hoy ? `<p>${escapar(hoy.texto ?? "")}</p>${lista(hoy.recomendaciones?.slice(1) ?? [])}` : "<p>Sin recomendación para hoy.</p>"}
</section>`;
}

export function htmlIndice(informes, seleccionada) {
  if (!informes?.length) return '<p class="ayuda">Aún no hay informes guardados.</p>';
  return informes
    .map((e) => {
      const [, rotulo] = ESTADOS[e.estado] || ["fallo", "Desconocido"];
      const entrega = ENTREGA[e.push?.estado] ?? "";
      const actual = e.fecha === seleccionada ? ' aria-current="true"' : "";
      return `<button type="button" class="btn chip" data-fecha="${escapar(e.fecha)}"${actual}>${escapar(e.fecha)} · ${rotulo}${entrega ? ` · ${entrega}` : ""}</button>`;
    })
    .join("");
}

// ---------------------------------------------------------------- Push (dependencias inyectadas)

const mensajeDe = async (r) => (await r.json().catch(() => ({}))).error || `Error ${r.status}`;

export async function activarPush({ notification, registro, pedir, clave }) {
  if (notification.permission === "denied") return { estado: "denegado", mensaje: "Las notificaciones están bloqueadas en los ajustes del dispositivo." };
  const permiso = notification.permission === "granted" ? "granted" : await notification.requestPermission();
  if (permiso !== "granted") return { estado: "denegado", mensaje: "No se ha concedido el permiso de notificaciones." };
  const previa = await registro.pushManager.getSubscription();
  const sub = previa || (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(clave) }));
  const r = await pedir("/informe/suscripcion", { method: "PUT", body: JSON.stringify({ suscripcion: sub.toJSON() }) });
  if (!r.ok) {
    const mensaje = await mensajeDe(r);
    if (!previa) await sub.unsubscribe();
    return { estado: "error", mensaje };
  }
  return { estado: "activo", mensaje: "Notificaciones activadas en este dispositivo." };
}

export async function desactivarPush({ registro, pedir }) {
  const sub = await registro.pushManager.getSubscription();
  if (!sub) return { estado: "inactivo", mensaje: "Este dispositivo no estaba suscrito." };
  const r = await pedir("/informe/suscripcion", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
  if (!r.ok) return { estado: "error", mensaje: `El servidor no ha podido quitar la suscripción: ${await mensajeDe(r)}` };
  await sub.unsubscribe();
  return { estado: "inactivo", mensaje: "Notificaciones desactivadas en este dispositivo." };
}

export async function probarPush({ registro, pedir }) {
  const sub = await registro.pushManager.getSubscription();
  if (!sub) return { estado: "sin_suscripcion", mensaje: "Primero activa las notificaciones en este dispositivo." };
  const r = await pedir("/informe/prueba", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
  return r.ok ? { estado: "enviada", mensaje: "Prueba enviada. La entrega depende del dispositivo y de la red; puede tardar." } : { estado: "error", mensaje: await mensajeDe(r) };
}

// ---------------------------------------------------------------- Enlace con la pagina

export function iniciarInforme({ $, pedirNube, hayNube, abrirPestana }) {
  let configCargada = null;
  let seleccionada = null;
  const pedir = (ruta, op) => pedirNube(ruta, op);
  const decir = (id, texto) => ($(id).textContent = texto);
  const valores = () => ({
    consentimiento: $("informeConsentimiento").checked,
    activo: $("informeActivo").checked,
    pushActivo: $("informePushActivo").checked,
    lat: $("informeLat").value,
    lon: $("informeLon").value,
    tipo: $("informeTipo").value,
    desde: $("informeDesde").value,
    hasta: $("informeHasta").value,
    fuente: $("informeFuente").value,
    precio: $("informePrecio").value,
    p1: $("informeP1").value,
    p2: $("informeP2").value,
    p3: $("informeP3").value,
    aceptaEstimacion: $("informeAcepta").checked,
  });

  function mostrarTipo() {
    const t = $("informeTipo").value;
    $("informeCampoPlana").hidden = t !== "plana";
    $("informeCampoPeriodos").hidden = t !== "periodos" && !(t === "indexada" && $("informeAcepta").checked);
    $("informeCampoIndexada").hidden = t !== "indexada";
    $("informeCampoTarifa").hidden = !t;
  }

  function rellenar(c) {
    $("informeConsentimiento").checked = c.consentimiento;
    $("informeActivo").checked = c.activo;
    $("informePushActivo").checked = c.pushActivo;
    $("informeLat").value = c.ubicacion?.lat ?? "";
    $("informeLon").value = c.ubicacion?.lon ?? "";
    const t = c.tarifa;
    $("informeTipo").value = t?.tipo ?? "";
    $("informeDesde").value = t?.desde ?? "";
    $("informeHasta").value = t?.hasta ?? "";
    $("informeFuente").value = t?.fuente ?? "";
    $("informePrecio").value = t?.precio ?? "";
    const p = t?.tipo === "indexada" ? t.mediaHistorica : t;
    $("informeP1").value = p?.P1 ?? "";
    $("informeP2").value = p?.P2 ?? "";
    $("informeP3").value = p?.P3 ?? "";
    $("informeAcepta").checked = t?.aceptaEstimacion === true;
    mostrarTipo();
  }

  const entornoPush = () => ({
    notification: globalThis.Notification,
    registro: null,
    pedir,
    clave: configCargada?.vapid?.publica,
  });
  const registro = () => navigator.serviceWorker.ready;

  function capacidad() {
    return capacidadPush({
      ua: navigator.userAgent,
      standalone: navigator.standalone === true || matchMedia("(display-mode: standalone)").matches,
      seguro: window.isSecureContext,
      serviceWorker: "serviceWorker" in navigator,
      notification: "Notification" in window,
      pushManager: "PushManager" in window,
      permiso: "Notification" in window ? Notification.permission : "default",
    });
  }

  function pintarCapacidad() {
    const c = capacidad();
    decir("informeCapacidad", c.mensaje);
    const puede = c.estado === "ok" && configCargada?.vapid?.disponible;
    for (const id of ["informeActivarPush", "informeProbarPush", "informeQuitarPush"]) $(id).disabled = !puede;
    if (c.estado === "ok" && configCargada && !configCargada.vapid.disponible) decir("informeCapacidad", `${c.mensaje} El servidor aún no tiene claves VAPID: ${configCargada.vapid.error}`);
  }

  async function abrirFecha(fecha) {
    seleccionada = fecha;
    const vista = $("informeVista");
    vista.setAttribute("aria-busy", "true");
    vista.innerHTML = '<p class="ayuda">Cargando informe…</p>';
    try {
      const r = await pedir(`/informe/ver?fecha=${encodeURIComponent(fecha)}`);
      if (r.status === 404) vista.innerHTML = `<p class="aviso">No hay informe del ${escapar(fecha)} todavía. Se genera cada día a las 08:30 (hora de Madrid) si el informe está activado; la entrega puede retrasarse.</p>`;
      else if (!r.ok) vista.innerHTML = `<p class="aviso">No se ha podido leer el informe: ${escapar(await mensajeDe(r))}</p>`;
      else vista.innerHTML = htmlInforme(await r.json());
    } catch (error) {
      vista.innerHTML = `<p class="aviso">No se ha podido leer el informe: ${escapar(error.message)}</p>`;
    }
    vista.removeAttribute("aria-busy");
    for (const b of $("informeIndice").querySelectorAll("[data-fecha]")) b.toggleAttribute("aria-current", b.dataset.fecha === fecha);
  }

  async function cargar() {
    if (!hayNube()) {
      $("informeVista").innerHTML = '<p class="aviso">Para ver los informes configura la dirección del Worker y la clave maestra en Ajustes (icono de la cabecera): es la misma puerta que usa el resto de la nube.</p>';
      $("informeIndice").innerHTML = "";
      $("informeAjustes").hidden = true;
      return;
    }
    $("informeAjustes").hidden = false;
    try {
      const [rc, ri] = await Promise.all([pedir("/informe/config"), pedir("/informe/indice")]);
      if (!rc.ok || !ri.ok) throw new Error(await mensajeDe(rc.ok ? ri : rc));
      configCargada = await rc.json();
      rellenar(configCargada.config);
      pintarCapacidad();
      const { informes } = await ri.json();
      const pedida = fechaDeHash(location.hash);
      const fecha = pedida || seleccionada || informes[0]?.fecha || null;
      $("informeIndice").innerHTML = htmlIndice(informes, fecha);
      if (fecha) await abrirFecha(fecha);
      else $("informeVista").innerHTML = `<p class="aviso">Todavía no hay ningún informe. ${configCargada.config.activo ? "El primero llegará tras las 08:30 (hora de Madrid)." : "El informe está desactivado: configúralo y actívalo abajo."}</p>`;
    } catch (error) {
      $("informeVista").innerHTML = `<p class="aviso">No se ha podido conectar con el servidor de informes: ${escapar(error.message)}</p>`;
    }
  }

  $("informeIndice").addEventListener("click", (e) => {
    const b = e.target.closest("[data-fecha]");
    if (b) abrirFecha(b.dataset.fecha);
  });
  $("informeTipo").addEventListener("change", mostrarTipo);
  $("informeAcepta").addEventListener("change", mostrarTipo);

  $("informeGuardar").addEventListener("click", async () => {
    decir("informeEstadoAjustes", "Guardando…");
    try {
      const r = await pedir("/informe/config", { method: "PUT", body: JSON.stringify(configDeFormulario(valores())) });
      decir("informeEstadoAjustes", r.ok ? "Configuración guardada en el servidor." : `No se ha guardado: ${await mensajeDe(r)}`);
      if (r.ok) await cargar();
    } catch (error) {
      decir("informeEstadoAjustes", `No se ha guardado: ${error.message}`);
    }
  });

  $("informeUsarUbicacion").addEventListener("click", () => {
    if (!navigator.geolocation) return decir("informeEstadoAjustes", "Este navegador no da la ubicación; escribe latitud y longitud a mano.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        $("informeLat").value = p.coords.latitude.toFixed(2);
        $("informeLon").value = p.coords.longitude.toFixed(2);
        decir("informeEstadoAjustes", "Ubicación aproximada rellenada (2 decimales, unos 1 km). Pulsa Guardar.");
      },
      () => decir("informeEstadoAjustes", "No se ha podido obtener la ubicación; escribe latitud y longitud a mano."),
      { maximumAge: 600000, timeout: 10000 }
    );
  });

  $("informeGenerar").addEventListener("click", async () => {
    decir("informeEstadoAjustes", "Generando el informe de ayer…");
    try {
      const r = await pedir("/informe/generar", { method: "POST", body: "{}" });
      decir("informeEstadoAjustes", r.ok ? "Informe generado." : `No se ha podido generar: ${await mensajeDe(r)}`);
      if (r.ok) await cargar();
    } catch (error) {
      decir("informeEstadoAjustes", `No se ha podido generar: ${error.message}`);
    }
  });

  const accionPush = (id, fn) =>
    $(id).addEventListener("click", async () => {
      decir("informeEstadoPush", "Un momento…");
      try {
        const r = await fn({ ...entornoPush(), registro: await registro() });
        decir("informeEstadoPush", r.mensaje);
      } catch (error) {
        decir("informeEstadoPush", `No se ha podido: ${error.message}`);
      }
      pintarCapacidad();
    });
  accionPush("informeActivarPush", activarPush);
  accionPush("informeQuitarPush", desactivarPush);
  accionPush("informeProbarPush", probarPush);

  navigator.serviceWorker?.addEventListener("message", (e) => {
    const fecha = e.data?.tipo === "abrir-informe" && FECHA.test(e.data.fecha || "") ? e.data.fecha : null;
    if (!fecha) return;
    abrirPestana("informe");
    seleccionada = fecha;
    cargar();
  });
  window.addEventListener("hashchange", () => {
    const fecha = fechaDeHash(location.hash);
    if (fecha) {
      seleccionada = fecha;
      cargar();
    }
  });
  mostrarTipo();
  return { cargar, mostrar: cargar };
}
