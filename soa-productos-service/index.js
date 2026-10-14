const express = require("express");
const soap = require("soap");
const fs = require("fs");
const path = require("path");
const { PRODUCTOS } = require("./productos");
const { publicarProductoConsultado, cerrarEsb } = require("./evento-publisher");

// En la nube el puerto lo asigna la plataforma (variable PORT). En tu PC se usa el 3000.
const PORT = process.env.PORT || 3000;
// URL pública del servicio. Se escribe dentro del WSDL (soap:address).
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

// Protección básica del endpoint SOAP (ver authorizeConnection más abajo).
const LIMITE_CUERPO_BYTES = 16 * 1024; // un sobre SOAP de esta operación pesa menos de 1 KB
const LIMITE_PETICIONES_POR_MINUTO = 120; // por dirección IP

const app = express();
// Nota: las peticiones a /wsdl las atiende directamente la librería soap (soap.listen),
// por eso este middleware no aplica a SOAP. El límite de tamaño de SOAP está en authorizeConnection.
app.use(express.raw({ type: () => true, limit: "2mb" }));

// Ruta simple para comprobar que el servicio está despierto
app.get("/health", (req, res) => res.json({ estado: "ok" }));

const service = {
  ProductoService: {
    ProductoServicePort: {
      ObtenerProductos: function (args, callback) {
        console.log("[SOA] ObtenerProductos invocado");
        const respuesta = { productos: PRODUCTOS.map((p) => `${p.id}|${p.nombre}|${p.precio}`) };
        // Si RabbitMQ falla, se registra el error y el servicio responde igual con los productos.
        publicarProductoConsultado(PRODUCTOS.length)
          .catch((err) => console.error("[ESB] Error publicando evento:", err.message))
          .finally(() => callback(null, respuesta));
      },
    },
  },
};

const wsdlXml = fs
  .readFileSync(path.join(__dirname, "productos.wsdl"), "utf8")
  .replace("http://localhost:3000/wsdl", `${PUBLIC_URL}/wsdl`);

const server = app.listen(PORT, () => {
  console.log(`Servicio SOA escuchando en el puerto ${PORT} (URL pública: ${PUBLIC_URL})`);
});

const soapServer = soap.listen(server, "/wsdl", service, wsdlXml);

// --- Protección básica contra abuso del endpoint público -------------------
// authorizeConnection se ejecuta antes de leer el cuerpo de cada petición. Aquí solo se vigila
// POST /wsdl: tamaño máximo del cuerpo y máximo de peticiones por minuto por IP.
// No reemplaza a una autenticación real; es una defensa mínima para un servicio público de laboratorio.
const contadores = new Map(); // ip -> { inicio, total }

function ipDe(req) {
  const reenviada = req.headers["x-forwarded-for"];
  return (reenviada ? String(reenviada).split(",")[0].trim() : req.socket.remoteAddress) || "desconocida";
}

soapServer.authorizeConnection = (req, res) => {
  let ruta = "";
  try {
    ruta = new URL(req.url, "http://localhost").pathname.replace(/\/$/, "");
  } catch (_) {
    return true;
  }
  if (req.method !== "POST" || ruta !== "/wsdl") return true;

  const declarado = Number(req.headers["content-length"] || 0);
  if (declarado > LIMITE_CUERPO_BYTES) {
    res.statusCode = 413;
    res.end();
    return false;
  }
  // Cuerpos sin Content-Length (chunked): se corta la conexión si se pasan del límite.
  let recibidos = 0;
  req.on("data", (trozo) => {
    recibidos += trozo.length;
    if (recibidos > LIMITE_CUERPO_BYTES) req.destroy();
  });

  const ip = ipDe(req);
  const ahora = Date.now();
  let c = contadores.get(ip);
  if (!c || ahora - c.inicio >= 60000) {
    c = { inicio: ahora, total: 0 };
    contadores.set(ip, c);
  }
  c.total++;
  if (c.total > LIMITE_PETICIONES_POR_MINUTO) {
    console.warn(`[SOA] Límite de peticiones superado por ${ip}`);
    res.statusCode = 429;
    res.setHeader("Retry-After", "60");
    res.end();
    return false;
  }
  return true;
};

// Limpia los contadores viejos para que el mapa no crezca sin límite.
setInterval(() => {
  const limite = Date.now() - 60000;
  for (const [ip, c] of contadores) if (c.inicio < limite) contadores.delete(ip);
}, 60000).unref();

// --- Apagado ordenado (la plataforma envía SIGTERM al redesplegar) ---------
function apagar() {
  console.log("[SOA] Apagando: cerrando el servidor y la conexión con RabbitMQ");
  setTimeout(() => process.exit(0), 5000).unref();
  server.close(() => cerrarEsb().finally(() => process.exit(0)));
}
process.on("SIGTERM", apagar);
process.on("SIGINT", apagar);
