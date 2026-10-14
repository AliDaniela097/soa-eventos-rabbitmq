const crypto = require("crypto");
const amqp = require("amqplib");

// --- Topología de RabbitMQ -------------------------------------------------
// Estos nombres y argumentos deben ser IDÉNTICOS en consumidor-eventos/index.js.
// Si difieren, RabbitMQ rechaza la declaración (PRECONDITION_FAILED).
//
// La cola se llama ".v2" porque RabbitMQ no permite cambiar una cola existente de
// "no durable" a "durable" ni agregarle una DLQ. Con un nombre nuevo no hace falta borrar nada
// a mano y el despliegue puede hacerse en cualquier orden. La cola antigua (productos.consultados)
// queda sin uso y se puede borrar desde la consola de RabbitMQ.
const QUEUE = "productos.consultados.v2";
const DLX = "productos.dlx"; // exchange de mensajes rechazados
const DLQ = "productos.consultados.v2.dlq"; // cola de mensajes rechazados (Dead Letter Queue)

// En la nube la dirección de RabbitMQ viene de la variable RABBITMQ_URL. En tu PC se usa la local.
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";

// Tiempos máximos: la respuesta SOAP nunca debe quedar colgada por culpa de RabbitMQ.
const TIEMPO_CONEXION_MS = 5000;
const TIEMPO_PUBLICACION_MS = 3000;
// Si RabbitMQ falla, durante este tiempo no se vuelve a intentar conectar (así las peticiones
// siguientes no esperan el tiempo máximo cada una).
const PAUSA_TRAS_FALLO_MS = 10000;

let canal = null; // canal con confirmaciones, listo para publicar
let abriendo = null; // promesa mientras se abre (evita abrir dos conexiones a la vez)
let pausadoHasta = 0;

function conTiempo(promesa, ms, mensaje) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

async function declararTopologia(channel) {
  await channel.assertExchange(DLX, "direct", { durable: true });
  await channel.assertQueue(DLQ, { durable: true });
  await channel.bindQueue(DLQ, DLX, DLQ);
  await channel.assertQueue(QUEUE, {
    durable: true,
    arguments: { "x-dead-letter-exchange": DLX, "x-dead-letter-routing-key": DLQ },
  });
}

async function abrirCanal() {
  let connection = null;

  const trabajo = (async () => {
    try {
      connection = await amqp.connect(RABBITMQ_URL);
      connection.on("error", (err) => console.error("[ESB] Error de conexión con RabbitMQ:", err.message));

      // Canal con confirmaciones: el broker avisa cuando aceptó (y guardó) cada mensaje.
      const channel = await connection.createConfirmChannel();
      channel.on("error", (err) => console.error("[ESB] Error en el canal de RabbitMQ:", err.message));
      channel.on("close", () => {
        if (canal === channel) canal = null;
        connection.close().catch(() => {});
      });
      connection.on("close", () => {
        if (canal === channel) canal = null;
      });

      await declararTopologia(channel);
      return channel;
    } catch (err) {
      if (connection) connection.close().catch(() => {});
      throw err;
    }
  })();

  try {
    return await conTiempo(trabajo, TIEMPO_CONEXION_MS, "tiempo agotado al conectar con RabbitMQ");
  } catch (err) {
    // Si el intento termina después del tiempo máximo, la conexión se cierra para no dejarla abierta.
    trabajo.then(
      () => connection && connection.close().catch(() => {}),
      () => {}
    );
    throw err;
  }
}

async function obtenerCanal() {
  if (canal) return canal;
  if (Date.now() < pausadoHasta) {
    throw new Error("RabbitMQ no disponible; reintento en pausa unos segundos");
  }
  if (!abriendo) {
    abriendo = abrirCanal().then(
      (channel) => {
        canal = channel;
        abriendo = null;
        return channel;
      },
      (err) => {
        abriendo = null;
        pausadoHasta = Date.now() + PAUSA_TRAS_FALLO_MS;
        throw err;
      }
    );
  }
  return abriendo;
}

// Descarta el canal actual si dejó de ser confiable; la próxima publicación abre uno nuevo.
function descartarCanal(channel) {
  if (canal === channel) canal = null;
  channel.connection.close().catch(() => {});
}

async function publicarProductoConsultado(cantidadProductos) {
  const evento = {
    eventoId: crypto.randomUUID(),
    tipo: "ProductoConsultado",
    fecha: new Date().toISOString(),
    origen: "soa-productos-service",
    totalProductosDevueltos: cantidadProductos,
  };

  const channel = await obtenerCanal();
  const opciones = {
    persistent: true, // el mensaje se guarda en disco: sobrevive a un reinicio del broker
    contentType: "application/json",
    messageId: evento.eventoId,
    type: evento.tipo,
    timestamp: Math.floor(Date.now() / 1000),
  };

  try {
    await conTiempo(
      new Promise((resolver, rechazar) => {
        channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(evento)), opciones, (err) =>
          err ? rechazar(err) : resolver()
        );
      }),
      TIEMPO_PUBLICACION_MS,
      "tiempo agotado esperando la confirmación de RabbitMQ"
    );
  } catch (err) {
    descartarCanal(channel);
    throw err;
  }

  console.log("[ESB] Evento ProductoConsultado publicado y confirmado por RabbitMQ:", evento);
}

// Cierra la conexión de forma ordenada (se usa al apagar el servicio).
async function cerrarEsb() {
  const actual = canal;
  canal = null;
  if (actual) {
    try {
      await actual.connection.close();
    } catch (_) {
      // ya estaba cerrada
    }
  }
}

module.exports = { publicarProductoConsultado, cerrarEsb };
