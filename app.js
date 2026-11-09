// App de gestión del mantenimiento de instalaciones deportivas.
// Lee las incidencias de la hoja de respuestas del Google Forms "Manteniment"
// a través del Apps Script (con contraseña) y guarda la gestión
// (estado, responsable, notas) en este navegador.

// Misma aplicación web de Apps Script que usa la app de incidencias.
const URL_SCRIPT = "https://script.google.com/macros/s/AKfycbxn6rjNWgXenYdckn-A8qU3bfoZO3ALz6nmbTxRUdlYSSQ3HgaIUJ51YJsHLHx0gL1IEA/exec";
const CLAVE_GESTION = "mantenimiento-gestion-v1";
const CLAVE_ACCESO = "mantenimiento-clave-v1";

// Orden de las columnas del formulario (A–P)
const COLUMNAS = [
  "marca", "instalacion", "fecha", "hora", "comunica", "tipo", "tipoOtro",
  "urgencia", "zona", "descripcion", "riesgo", "afectaActividades",
  "medida", "medidaDescripcion", "adjuntos", "reiteracion",
];

let incidencias = [];
let gestion = leerGestion();
let actualAbierta = null;
let clave = leerClave();

const $ = (id) => document.getElementById(id);

/* ---------- Utilidades ---------- */

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function esSi(valor) {
  return /^s[ií]/i.test(String(valor).trim());
}

// "Date(2026,8,8,20,9,13)" -> Date
function fechaGviz(v) {
  const m = /Date\(([^)]+)\)/.exec(v || "");
  if (!m) return null;
  const p = m[1].split(",").map(Number);
  return new Date(p[0], p[1], p[2] || 1, p[3] || 0, p[4] || 0, p[5] || 0);
}

// Nivel 1–4 a partir del texto de urgencia del formulario
function nivelUrgencia(texto) {
  const t = String(texto).toLowerCase();
  if (/cr[ií]tic|molt alta|urgent/.test(t)) return 4;
  if (/^alt/.test(t)) return 3;
  if (/mitj|mitg|mitjana|media/.test(t)) return 2;
  if (/baix|baja/.test(t)) return 1;
  return 0;
}

function leerGestion() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_GESTION)) || {};
  } catch {
    return {};
  }
}

function guardarGestion() {
  try {
    localStorage.setItem(CLAVE_GESTION, JSON.stringify(gestion));
    return true;
  } catch {
    return false;
  }
}

function leerClave() {
  try {
    return localStorage.getItem(CLAVE_ACCESO) || "";
  } catch {
    return "";
  }
}

function recordarClave(valor) {
  try {
    if (valor) localStorage.setItem(CLAVE_ACCESO, valor);
    else localStorage.removeItem(CLAVE_ACCESO);
  } catch { /* sin almacenamiento: se pedirá cada vez */ }
}

function estadoDe(inc) {
  return gestion[inc.id]?.estado || "Pendiente";
}

/* ---------- Acceso ---------- */

function mostrarAcceso(error = "") {
  $("panel").hidden = true;
  $("acceso").hidden = false;
  $("accesoError").textContent = error;
  $("accesoError").hidden = !error;
  $("ultimaCarga").textContent = "Sin cargar";
  $("btnActualizar").hidden = true;
  $("inClave").focus();
}

function mostrarPanel() {
  $("acceso").hidden = true;
  $("panel").hidden = false;
  $("btnActualizar").hidden = false;
}

/* ---------- Carga desde Google Sheets (vía Apps Script) ---------- */

async function pedirIncidencias(valorClave) {
  const control = new AbortController();
  const espera = setTimeout(() => control.abort(), 30000);
  try {
    const respuesta = await fetch(URL_SCRIPT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ accio: "incidencies", clau: valorClave }),
      signal: control.signal,
    });
    return await respuesta.json();
  } finally {
    clearTimeout(espera);
  }
}

async function cargar() {
  if (!clave) {
    mostrarAcceso();
    return;
  }
  const boton = $("btnActualizar");
  boton.disabled = true;
  $("ultimaCarga").textContent = "Cargando…";

  try {
    const datos = await pedirIncidencias(clave);
    if (!datos.ok) {
      if (datos.error === "clau") {
        clave = "";
        recordarClave("");
        mostrarAcceso("Contraseña incorrecta.");
      } else if (datos.error === "config") {
        mostrarPanel();
        mostrarAviso("El Apps Script no tiene contraseña configurada (falta la propiedad CLAU_PANELL).");
        $("ultimaCarga").textContent = "Error al cargar";
      } else {
        mostrarPanel();
        mostrarAviso("El Apps Script respondió con un error: " + (datos.missatge || datos.error || "desconocido"));
        $("ultimaCarga").textContent = "Error al cargar";
      }
      return;
    }
    mostrarPanel();
    incidencias = convertir(datos.files || []);
    ocultarAviso();
    $("ultimaCarga").textContent = "Actualizado " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    rellenarFiltros();
    pintar();
  } catch {
    mostrarPanel();
    mostrarAviso("No se ha podido conectar con el Apps Script. Revisa la conexión a internet y que la implementación esté actualizada.");
    $("ultimaCarga").textContent = "Error al cargar";
  } finally {
    boton.disabled = false;
  }
}

function convertir(filas) {
  return filas
    .map((fila) => {
      const inc = {};
      COLUMNAS.forEach((nombre, i) => {
        inc[nombre] = fila.valors[i] ?? "";
      });
      const marcaCruda = fila.marca;
      inc.momento = fechaGviz(marcaCruda);
      inc.id = `${marcaCruda || inc.marca}|${inc.comunica}`.trim();
      inc.nivel = nivelUrgencia(inc.urgencia);
      inc.tipoTexto = inc.tipoOtro ? `${inc.tipo} (${inc.tipoOtro})` : inc.tipo;
      return inc;
    })
    .filter((inc) => inc.marca || inc.descripcion);
}

/* ---------- Filtros ---------- */

function rellenarSelect(select, valores, textoTodos) {
  const actual = select.value;
  const unicos = [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  select.innerHTML = `<option value="">${textoTodos}</option>` +
    unicos.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if (unicos.includes(actual)) select.value = actual;
}

function rellenarFiltros() {
  rellenarSelect($("fInstalacion"), incidencias.map((i) => i.instalacion), "Todas las instalaciones");
  rellenarSelect($("fTipo"), incidencias.map((i) => i.tipo), "Todos los tipos");
  rellenarSelect($("fUrgencia"), incidencias.map((i) => i.urgencia), "Todas las urgencias");
}

function filtradas() {
  const texto = $("fBuscar").value.trim().toLowerCase();
  const inst = $("fInstalacion").value;
  const est = $("fEstado").value;
  const tipo = $("fTipo").value;
  const urg = $("fUrgencia").value;

  return incidencias
    .filter((i) => !inst || i.instalacion === inst)
    .filter((i) => !tipo || i.tipo === tipo)
    .filter((i) => !urg || i.urgencia === urg)
    .filter((i) => {
      const e = estadoDe(i);
      if (est === "abiertas") return e !== "Resuelta";
      return !est || e === est;
    })
    .filter((i) => {
      if (!texto) return true;
      const g = gestion[i.id] || {};
      return [i.descripcion, i.zona, i.comunica, i.instalacion, i.tipoTexto, g.responsable, g.notas]
        .join(" ").toLowerCase().includes(texto);
    })
    .sort((a, b) => {
      const ra = estadoDe(a) === "Resuelta", rb = estadoDe(b) === "Resuelta";
      if (ra !== rb) return ra ? 1 : -1;
      const riesgo = esSi(b.riesgo) - esSi(a.riesgo);
      if (riesgo) return riesgo;
      if (b.nivel !== a.nivel) return b.nivel - a.nivel;
      return (b.momento || 0) - (a.momento || 0);
    });
}

/* ---------- Pintar ---------- */

function pintarResumen() {
  const cuenta = { Pendiente: 0, "En curso": 0, Resuelta: 0 };
  let riesgo = 0;
  incidencias.forEach((i) => {
    const e = estadoDe(i);
    cuenta[e] = (cuenta[e] || 0) + 1;
    if (e !== "Resuelta" && esSi(i.riesgo)) riesgo++;
  });
  $("nTotal").textContent = incidencias.length;
  $("nPendiente").textContent = cuenta.Pendiente;
  $("nCurso").textContent = cuenta["En curso"];
  $("nResuelta").textContent = cuenta.Resuelta;
  $("nRiesgo").textContent = riesgo;
}

function chipEstado(estado) {
  return `<span class="estado estado--${estado.replace(" ", "-")}">${esc(estado)}</span>`;
}

function pintar() {
  pintarResumen();
  const lista = filtradas();

  if (!incidencias.length) {
    $("lista").innerHTML = `<p class="vacio">Todavía no hay incidencias en la hoja.</p>`;
    return;
  }
  if (!lista.length) {
    $("lista").innerHTML = `<p class="vacio">No hay incidencias con estos filtros.</p>`;
    return;
  }

  $("lista").innerHTML = lista.map((i) => {
    const g = gestion[i.id] || {};
    const chips = [
      i.tipoTexto && `<span class="chip">${esc(i.tipoTexto)}</span>`,
      i.urgencia && `<span class="chip">${esc(i.urgencia)}</span>`,
      esSi(i.riesgo) && `<span class="chip chip--riesgo">⚠ Riesgo para personas</span>`,
      esSi(i.afectaActividades) && `<span class="chip chip--actividad">Afecta a actividades</span>`,
      esSi(i.reiteracion) && `<span class="chip chip--reiteracion">Reiterada</span>`,
      g.responsable && `<span class="chip">👤 ${esc(g.responsable)}</span>`,
    ].filter(Boolean).join("");

    return `
      <button class="tarjeta u${i.nivel}" data-id="${esc(i.id)}">
        <span class="tarjeta__franja"></span>
        <span class="tarjeta__cuerpo">
          <span class="tarjeta__titulo" style="display:block">${esc(i.descripcion || "(sin descripción)")}</span>
          <span class="tarjeta__meta" style="display:block">${esc(i.instalacion)} · ${esc(i.zona)}</span>
          <span class="tarjeta__chips">${chips}</span>
        </span>
        <span class="tarjeta__lado">
          ${chipEstado(estadoDe(i))}
          <span class="tarjeta__fecha">${esc(i.fecha)} ${esc(String(i.hora).slice(0, 5))}</span>
        </span>
      </button>`;
  }).join("");
}

function campo(etiqueta, valor, ancho = false) {
  if (!valor) return "";
  return `<div class="${ancho ? "ancho" : ""}"><dt>${esc(etiqueta)}</dt><dd>${valor}</dd></div>`;
}

function enlacesAdjuntos(texto) {
  return String(texto).split(/,\s*/).filter(Boolean)
    .map((url, n) => /^https:\/\//.test(url)
      ? `<a href="${esc(url)}" target="_blank" rel="noopener">Ver adjunto ${n + 1} ↗</a>`
      : esc(url))
    .join("<br>");
}

function abrir(id) {
  const i = incidencias.find((x) => x.id === id);
  if (!i) return;
  actualAbierta = i;
  const g = gestion[i.id] || {};

  $("detalleContenido").innerHTML = `
    <h2>${esc(i.descripcion || "(sin descripción)")}</h2>
    <p class="detalle__meta">${esc(i.instalacion)} · ${esc(i.zona)} · ${chipEstado(estadoDe(i))}</p>
    <dl class="campos">
      ${campo("Fecha y hora", esc(`${i.fecha} ${i.hora}`))}
      ${campo("Comunica", esc(i.comunica))}
      ${campo("Tipo", esc(i.tipoTexto))}
      ${campo("Urgencia", esc(i.urgencia))}
      ${campo("Riesgo para personas", esc(i.riesgo))}
      ${campo("Afecta a actividades", esc(i.afectaActividades))}
      ${campo("Medida inmediata", esc(i.medida))}
      ${campo("Reiteración", esc(i.reiteracion))}
      ${campo("Medida adoptada", esc(i.medidaDescripcion), true)}
      ${campo("Fotos / vídeo", enlacesAdjuntos(i.adjuntos), true)}
      ${campo("Registrada", esc(i.marca), true)}
    </dl>`;

  const f = $("formGestion");
  f.estado.value = g.estado || "Pendiente";
  f.responsable.value = g.responsable || "";
  f.fecha.value = g.fecha || "";
  f.notas.value = g.notas || "";
  $("gestionInfo").textContent = g.actualizado
    ? "Última modificación: " + new Date(g.actualizado).toLocaleString("es-ES")
    : "";

  $("detalle").showModal();
}

/* ---------- Avisos ---------- */

function mostrarAviso(texto) {
  $("aviso").textContent = texto;
  $("aviso").hidden = false;
}

function ocultarAviso() {
  $("aviso").hidden = true;
}

/* ---------- Exportar / copias ---------- */

function descargar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportarCSV() {
  const cabecera = ["Registrada", "Instalación", "Fecha", "Hora", "Comunica", "Tipo", "Urgencia",
    "Zona", "Descripción", "Riesgo personas", "Afecta actividades", "Reiteración", "Adjuntos",
    "Estado", "Responsable", "Fecha prevista/resolución", "Notas"];
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = incidencias.map((i) => {
    const g = gestion[i.id] || {};
    return [i.marca, i.instalacion, i.fecha, i.hora, i.comunica, i.tipoTexto, i.urgencia, i.zona,
      i.descripcion, i.riesgo, i.afectaActividades, i.reiteracion, i.adjuntos,
      estadoDe(i), g.responsable, g.fecha, g.notas].map(celda).join(";");
  });
  const hoy = new Date().toISOString().slice(0, 10);
  descargar(`mantenimiento-${hoy}.csv`, "﻿" + [cabecera.map(celda).join(";"), ...filas].join("\n"), "text/csv;charset=utf-8");
}

function guardarCopia() {
  const hoy = new Date().toISOString().slice(0, 10);
  descargar(`gestion-mantenimiento-${hoy}.json`, JSON.stringify(gestion, null, 2), "application/json");
}

function restaurarCopia(archivo) {
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const datos = JSON.parse(lector.result);
      if (typeof datos !== "object" || Array.isArray(datos)) throw new Error();
      if (!confirm("Se sustituirá la gestión guardada en este navegador por la de la copia. ¿Continuar?")) return;
      gestion = datos;
      guardarGestion();
      pintar();
    } catch {
      alert("El archivo no es una copia válida.");
    }
  };
  lector.readAsText(archivo);
}

/* ---------- Eventos ---------- */

$("btnActualizar").addEventListener("click", cargar);
["fBuscar", "fInstalacion", "fEstado", "fTipo", "fUrgencia"].forEach((id) =>
  $(id).addEventListener("input", pintar));

$("lista").addEventListener("click", (e) => {
  const tarjeta = e.target.closest(".tarjeta");
  if (tarjeta) abrir(tarjeta.dataset.id);
});

$("formGestion").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!actualAbierta) return;
  const f = e.target;
  gestion[actualAbierta.id] = {
    estado: f.estado.value,
    responsable: f.responsable.value.trim(),
    fecha: f.fecha.value,
    notas: f.notas.value.trim(),
    actualizado: new Date().toISOString(),
  };
  if (!guardarGestion()) {
    alert("No se ha podido guardar en este navegador (¿modo privado?). Usa «Guardar copia de la gestión».");
  }
  $("detalle").close();
  pintar();
});

$("formAcceso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const valor = $("inClave").value;
  if (!valor) return;
  const boton = $("btnEntrar");
  boton.disabled = true;
  boton.textContent = "Comprobando…";
  clave = valor;
  if ($("inRecordar").checked) recordarClave(valor);
  $("inClave").value = "";
  await cargar();
  boton.disabled = false;
  boton.textContent = "Entrar";
});

$("btnSalir").addEventListener("click", () => {
  clave = "";
  recordarClave("");
  incidencias = [];
  mostrarAcceso();
});

$("btnExportar").addEventListener("click", exportarCSV);
$("btnCopia").addEventListener("click", guardarCopia);
$("inCopia").addEventListener("change", (e) => {
  if (e.target.files[0]) restaurarCopia(e.target.files[0]);
  e.target.value = "";
});

cargar();
