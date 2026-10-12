const express = require("express");
const soap = require("soap");
const fs = require("fs");
const path = require("path");
const { PRODUCTOS } = require("./productos");
const { publicarProductoConsultado } = require("./evento-publisher");

// En la nube el puerto lo asigna la plataforma (variable PORT). En tu PC se usa el 3000.
const PORT = process.env.PORT || 3000;
// URL pública del servicio. Se escribe dentro del WSDL (soap:address).
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();
app.use(express.raw({ type: () => true, limit: "2mb" }));

// Ruta simple para comprobar que el servicio está despierto
app.get("/health", (req, res) => res.json({ estado: "ok" }));

const service = {
  ProductoService: {
    ProductoServicePort: {
      ObtenerProductos: function (args, callback) {
        console.log("[SOA] ObtenerProductos invocado");
        const respuesta = { productos: PRODUCTOS.map((p) => `${p.id}|${p.nombre}|${p.precio}`) };
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

soap.listen(server, "/wsdl", service, wsdlXml);
