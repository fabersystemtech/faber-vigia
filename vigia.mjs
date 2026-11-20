// Vigía de Faber System: revisa sitios y avisa por Telegram. Sin dependencias. Corre en GitHub Actions cada 5 minutos.
//
// REPOSITORIO PÚBLICO: aquí no hay datos de nadie. La lista de sitios llega por el secreto SITIOS y el token
// de Telegram por TELEGRAM_TOKEN. Los registros (logs) de Actions también son públicos, así que este programa
// imprime SOLO cantidades, nunca nombres, direcciones ni respuestas.
//
// SITIOS: arreglo JSON  [{ "nombre": "Mi sitio", "url": "https://...", "encabezados": { "apikey": "..." } }]
// Reglas: se reintenta una vez; se avisa cuando falla dos revisiones seguidas (unos 10 min) y cuando vuelve.
// Cada lunes (8:00 Ecuador) manda un "sigo activo" con el resumen: si ese mensaje deja de llegar, el vigía se paró.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SITIOS = (() => { try { return JSON.parse(process.env.SITIOS || "[]"); } catch { return []; } })();
const TOKEN = process.env.TELEGRAM_TOKEN || "";
const CHAT = process.env.TELEGRAM_CHAT || "";
const API = process.env.TELEGRAM_API || "https://api.telegram.org";
const ARCHIVO = process.env.ESTADO_ARCHIVO || "estado.json";
const AHORA = process.env.AHORA ? new Date(process.env.AHORA) : new Date();
const ESPERA_MS = Number(process.env.ESPERA_MS || 20000);
const PAUSA_REINTENTO_MS = Number(process.env.PAUSA_REINTENTO_MS || 3000);

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Revisa un sitio. Devuelve { ok, ms, motivo }. */
async function revisar(sitio) {
  let motivo = "";
  for (let intento = 0; intento < 2; intento++) {
    const t0 = Date.now();
    try {
      const r = await fetch(sitio.url, { headers: sitio.encabezados || {}, redirect: "follow", signal: AbortSignal.timeout(ESPERA_MS) });
      await r.arrayBuffer().catch(() => {});
      if (r.ok) return { ok: true, ms: Date.now() - t0, motivo: "" };
      motivo = `respondió ${r.status}`;
    } catch (e) {
      motivo = e && e.name === "TimeoutError" ? "no respondió a tiempo" : "sin conexión";
    }
    if (intento === 0) await pausa(PAUSA_REINTENTO_MS);
  }
  return { ok: false, ms: 0, motivo };
}

async function avisar(texto) {
  if (!TOKEN || !CHAT) throw new Error("falta configurar Telegram");
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(`${API}/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) return;
    } catch { /* se reintenta */ }
    await pausa(2000);
  }
  throw new Error("no se pudo avisar por Telegram");
}

const leerEstado = () => { try { return existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, "utf8")) : {}; } catch { return {}; } };

const enEcuador = (d) => new Date(d.getTime() - 5 * 3600 * 1000); // UTC-5, sin horario de verano
const semanaIso = (d) => {
  const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  f.setUTCDate(f.getUTCDate() + 4 - (f.getUTCDay() || 7));
  return `${f.getUTCFullYear()}-S${Math.ceil(((f - new Date(Date.UTC(f.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7)}`;
};
const duracion = (desde, hasta) => {
  const min = Math.max(1, Math.round((hasta - new Date(desde)) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};

async function main() {
  if (!SITIOS.length) { console.log("Sin sitios configurados."); process.exit(1); }
  const estado = leerEstado();
  estado.sitios ||= {};

  if (process.env.PRUEBA === "1") {
    await avisar(`✅ Prueba del Vigía de Faber System: el aviso por Telegram funciona. Vigilo ${SITIOS.length} sitios.`);
    console.log("Mensaje de prueba enviado.");
  }

  const resultados = await Promise.all(SITIOS.map(async (s) => ({ s, r: await revisar(s) })));
  let conProblemas = 0;
  const mensajes = [];

  for (const { s, r } of resultados) {
    const st = (estado.sitios[s.nombre] ||= { fallas: 0, caido: false });
    if (!r.ok) {
      conProblemas++;
      st.fallas++;
      if (st.fallas >= 2 && !st.caido) {
        st.caido = true;
        st.desde = AHORA.toISOString();
        mensajes.push(`🔴 ${s.nombre} NO responde (${r.motivo}). Lo sigo revisando cada 5 minutos.`);
      }
    } else {
      if (st.caido) mensajes.push(`🟢 ${s.nombre} volvió a responder (estuvo caído ${duracion(st.desde, AHORA)}).`);
      st.fallas = 0;
      st.caido = false;
      delete st.desde;
    }
  }
  // Sitios que ya no están en la lista dejan de ocupar memoria.
  for (const k of Object.keys(estado.sitios)) if (!SITIOS.some((s) => s.nombre === k)) delete estado.sitios[k];

  // Cada lunes desde las 8:00 (Ecuador): "sigo activo".
  const ec = enEcuador(AHORA);
  if (ec.getUTCDay() === 1 && ec.getUTCHours() >= 8 && estado.ultimaSemana !== semanaIso(ec)) {
    const caidos = SITIOS.filter((s) => estado.sitios[s.nombre]?.caido).map((s) => s.nombre);
    mensajes.push(`🛡️ Vigía activo: reviso ${SITIOS.length} sitios cada 5 minutos. ${caidos.length ? `Caídos ahora: ${caidos.join(", ")}.` : "Todos responden."}`);
    estado.ultimaSemana = semanaIso(ec);
  }

  for (const m of mensajes) await avisar(m);
  writeFileSync(ARCHIVO, JSON.stringify(estado));
  console.log(`Revisados ${SITIOS.length}; con problemas ${conProblemas}; avisos enviados ${mensajes.length}.`);
}

main().catch((e) => {
  console.log("Error del vigía:", e && e.message ? String(e.message).replace(/https?:\/\/\S+/g, "[dirección]") : "desconocido");
  process.exit(1);
});
