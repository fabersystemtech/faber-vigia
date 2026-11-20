// Prueba del vigía con sitios y Telegram de mentira (todo local, sin internet). Uso: node prueba-vigia.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ok = (t) => console.log(`  ok  ${t}`);
const dir = mkdtempSync(join(tmpdir(), "vigia-"));
const ESTADO = join(dir, "estado.json");
const TOKEN = "123456:TOKEN-SECRETO-DE-PRUEBA";

// --- Sitios de mentira ---
let sitioCaido = true;
let telegramRoto = false;
const avisos = [];
const sitios = http.createServer((req, res) => {
  if (req.url === "/con-llave") {
    if (req.headers.apikey !== "llave-de-prueba") { res.writeHead(401); return res.end("no"); }
    res.writeHead(200); return res.end("[]");
  }
  if (req.url === "/variable") { res.writeHead(sitioCaido ? 503 : 200); return res.end("x"); }
  res.writeHead(200); res.end("hola");
}).listen(0);
const telegram = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (c) => (cuerpo += c));
  req.on("end", () => {
    if (telegramRoto) { res.writeHead(500); return res.end("{}"); }
    assert.equal(req.url, `/bot${TOKEN}/sendMessage`);
    avisos.push(JSON.parse(cuerpo));
    res.writeHead(200); res.end('{"ok":true}');
  });
}).listen(0);
await Promise.all([new Promise((r) => sitios.on("listening", r)), new Promise((r) => telegram.on("listening", r))]);
const base = `http://127.0.0.1:${sitios.address().port}`;
const apiTelegram = `http://127.0.0.1:${telegram.address().port}`;

const LISTA = [
  { nombre: "Sitio sano", url: `${base}/ok` },
  { nombre: "Sitio variable", url: `${base}/variable`, ayuda: "Mira el hosting y la base de datos de ese sitio." },
  { nombre: "Base con llave", url: `${base}/con-llave`, encabezados: { apikey: "llave-de-prueba" } },
];

function correr(extra = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["vigia.mjs"], {
      cwd: new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/%20/g, " "),
      env: {
        ...process.env, SITIOS: JSON.stringify(LISTA), TELEGRAM_TOKEN: TOKEN, TELEGRAM_CHAT: "777", TELEGRAM_API: apiTelegram,
        ESTADO_ARCHIVO: ESTADO, ESPERA_MS: "2000", PAUSA_REINTENTO_MS: "30", AHORA: "2026-11-24T15:00:00Z", ...extra,
      },
    });
    let salida = "";
    p.stdout.on("data", (c) => (salida += c));
    p.stderr.on("data", (c) => (salida += c));
    p.on("close", (codigo) => resolve({ codigo, salida }));
  });
}
const sinFugas = (salida) => {
  for (const prohibido of ["Sitio sano", "Sitio variable", "Base con llave", "127.0.0.1", "http", TOKEN, "llave-de-prueba"]) {
    assert.ok(!salida.includes(prohibido), `el registro público no debe mostrar: ${prohibido}`);
  }
};

try {
  // 1) Primera falla: todavía no avisa
  let r = await correr();
  assert.equal(r.codigo, 0);
  assert.equal(avisos.length, 0);
  assert.match(r.salida, /Revisados 3; con problemas 1; avisos enviados 0/);
  sinFugas(r.salida);
  ok("una sola falla no avisa (evita falsas alarmas)");

  // 2) Segunda falla seguida: avisa
  r = await correr();
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].text, /^🔴 Sitio variable NO responde/);
  assert.equal(avisos[0].chat_id, "777");
  assert.match(avisos[0].text, /👉 Qué hacer: Mira el hosting y la base de datos de ese sitio\./);
  assert.match(avisos[0].text, /Hola Claude, el vigía avisó que "Sitio variable" no responde \(respondió 503\) desde las 10:00/);
  assert.deepEqual(avisos[0].reply_markup.inline_keyboard[0][0], { text: "🌐 Abrir sitio", url: `${base}/variable` });
  sinFugas(r.salida);
  ok("dos fallas seguidas (unos 10 min): avisa, dice qué hacer, trae el texto listo para pegarle a Claude y un botón para abrir el sitio");

  // 3) Sigue caído: no repite
  await correr();
  await correr();
  assert.equal(avisos.length, 1);
  ok("mientras sigue caído no repite el aviso cada 5 minutos");

  // 4) Vuelve: avisa
  sitioCaido = false;
  r = await correr({ AHORA: "2026-11-24T15:20:00Z" });
  assert.equal(avisos.length, 2);
  assert.match(avisos[1].text, /^🟢 Sitio variable volvió a responder \(estuvo caído/);
  sinFugas(r.salida);
  ok("cuando vuelve, avisa y dice cuánto estuvo caído");

  // 5) Resumen del lunes
  r = await correr({ AHORA: "2026-11-23T14:00:00Z" }); // lunes 09:00 en Ecuador
  assert.equal(avisos.length, 3);
  assert.match(avisos[2].text, /^🛡️ Vigía activo: reviso 3 sitios cada 5 minutos\. Todos responden\./);
  await correr({ AHORA: "2026-11-23T14:05:00Z" });
  assert.equal(avisos.length, 3);
  ok("el lunes manda un 'sigo activo' una sola vez por semana");
  await correr({ AHORA: "2026-11-25T14:00:00Z" }); // miércoles
  assert.equal(avisos.length, 3);
  ok("otros días de la semana no manda resumen");

  // 6) Mensaje de prueba
  r = await correr({ PRUEBA: "1" });
  assert.equal(avisos.length, 4);
  assert.match(avisos[3].text, /^✅ Prueba del Vigía/);
  ok("el mensaje de prueba funciona");

  // 7) Telegram caído: el vigía falla a la vista (GitHub lo marca en rojo y te escribe)
  sitioCaido = true;
  await correr(); await correr();
  telegramRoto = true;
  sitioCaido = true;
  rmSync(ESTADO, { force: true });
  await correr();
  r = await correr();
  assert.equal(r.codigo, 1);
  sinFugas(r.salida);
  ok("si Telegram no responde, el vigía termina con error visible (no falla en silencio)");

  // 8) Sin configuración
  r = await correr({ SITIOS: "[]" });
  assert.equal(r.codigo, 1);
  ok("sin lista de sitios no corre en vacío");

  console.log("\nVigía: todas las comprobaciones superadas.");
} finally {
  sitios.close(); telegram.close();
  rmSync(dir, { recursive: true, force: true });
}
