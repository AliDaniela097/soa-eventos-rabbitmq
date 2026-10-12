const express = require("express");
const soap = require("soap");
const fs = require("fs");
const { PRODUCTOS } = require("./productos");
const { publicarProductoConsultado } = require("./evento-publisher");

const app = express();
app.use(express.raw({ type: () => true, limit: "2mb" }));

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

const wsdlXml = fs.readFileSync("productos.wsdl", "utf8");

const server = app.listen(3000, () => {
  console.log("Servicio SOA escuchando en http://localhost:3000");
});

soap.listen(server, "/wsdl", service, wsdlXml);