const amqp = require("amqplib");
const http = require("http");

// --- Topología de RabbitMQ -------------------------------------------------
// Estos nombres y argumentos deben ser IDÉNTICOS en soa-productos-service/evento-publisher.js.
// Ver allí por qué la cola se llama ".v2".
const QUEUE = "productos.consultados.v2";
const DLX = "productos.dlx"; // exchange de mensajes rechazados
const DLQ = "productos.consultados.v2.dlq"; // cola de mensajes rechazados (Dead Letter Queue)

// En la nube la dirección de RabbitMQ viene de la variable RABBITMQ_URL. En tu PC se usa la local.
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";

// Cuántos mensajes sin confirmar (ack) puede tener el consumidor a la vez.
const PREFETCH = 10;
// Cuántos eventoId recientes se recuerdan para descartar repetidos (entrega at-least-once).
const MAX_IDS_RECORDADOS = 1000;

let eventosRecibidos = 0;
let eventosDuplicados = 0;
let eventosRechazados = 0;
let cerrando = false;
const idsVistos = new Set();

// Las plataformas gratis (como Render) solo aceptan servicios web.
// Este mini servidor responde "estoy vivo" y solo se activa cuando la plataforma define PORT.
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({ estado: "ok", cola: QUEUE, eventosRecibidos, eventosDuplicados, eventosRechazados })
      );
    })
    .listen(process.env.PORT, () => console.log("Consumidor visible en el puerto", process.env.PORT));
}

// Comprueba que el mensaje cumple el contrato EventoProductoConsultado (ver contrato.yaml).
function validarEvento(evento) {
  if (evento === null || typeof evento !== "object" || Array.isArray(evento)) {
    throw new Error("el mensaje no es un objeto JSON");
  }
  for (const campo of ["eventoId", "tipo", "fecha", "origen"]) {
    if (typeof evento[campo] !== "string" || evento[campo] === "") {
      throw new Error(`falta el campo "${campo}" o no es texto`);
    }
  }
  if (evento.tipo !== "ProductoConsultado") {
    throw new Error(`tipo de evento no soportado: ${evento.tipo}`);
  }
  if (!Number.isInteger(evento.totalProductosDevueltos) || evento.totalProductosDevueltos < 0) {
    throw new Error('el campo "totalProductosDevueltos" debe ser un entero mayor o igual a 0');
  }
}

function recordarId(id) {
  idsVistos.add(id);
  if (idsVistos.size > MAX_IDS_RECORDADOS) {
    idsVistos.delete(idsVistos.values().next().value);
  }
}

// Lógica de negocio del consumidor (igual que antes: registrar el evento).
function procesarEvento(evento) {
  console.log("[Consumidor] Evento recibido:", evento);
}

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  connection.on("error", (err) => console.error("Error de conexión con RabbitMQ:", err.message));
  connection.on("close", () => {
    if (cerrando) return;
    console.error("Conexión con RabbitMQ cerrada. Saliendo para que la plataforma reinicie el consumidor.");
    process.exit(1);
  });

  const channel = await connection.createChannel();
  channel.on("error", (err) => console.error("Error en el canal de RabbitMQ:", err.message));
  channel.on("close", () => {
    if (cerrando) return;
    console.error("Canal con RabbitMQ cerrado. Saliendo para que la plataforma reinicie el consumidor.");
    process.exit(1);
  });

  // Declaración idéntica a la del productor: mensajes rechazados van a la DLQ.
  await channel.assertExchange(DLX, "direct", { durable: true });
  await channel.assertQueue(DLQ, { durable: true });
  await channel.bindQueue(DLQ, DLX, DLQ);
  await channel.assertQueue(QUEUE, {
    durable: true,
    arguments: { "x-dead-letter-exchange": DLX, "x-dead-letter-routing-key": DLQ },
  });
  await channel.prefetch(PREFETCH);

  console.log("Escuchando eventos en la cola:", QUEUE);

  const { consumerTag } = await channel.consume(QUEUE, (msg) => {
    if (msg === null) {
      // El broker canceló el consumidor (por ejemplo, borraron la cola).
      console.error("RabbitMQ canceló el consumidor. Saliendo para que la plataforma reinicie el consumidor.");
      process.exit(1);
      return;
    }

    // 1) Mensaje inválido (no es JSON o no cumple el contrato): no tiene arreglo reintentando,
    //    se manda directo a la DLQ y el consumidor sigue vivo.
    let evento;
    try {
      evento = JSON.parse(msg.content.toString());
      validarEvento(evento);
    } catch (err) {
      eventosRechazados++;
      console.error(`[Consumidor] Mensaje inválido enviado a la DLQ (${DLQ}): ${err.message}`);
      channel.nack(msg, false, false);
      return;
    }

    // 2) Evento repetido (RabbitMQ entrega at-least-once): se confirma y se ignora.
    if (idsVistos.has(evento.eventoId)) {
      eventosDuplicados++;
      console.warn("[Consumidor] Evento repetido ignorado:", evento.eventoId);
      channel.ack(msg);
      return;
    }

    // 3) Procesamiento. Si falla, se reintenta una vez; si vuelve a fallar, va a la DLQ.
    try {
      procesarEvento(evento);
      recordarId(evento.eventoId);
      eventosRecibidos++;
      channel.ack(msg);
    } catch (err) {
      const reintentar = !msg.fields.redelivered;
      console.error(
        `[Consumidor] Error procesando el evento ${evento.eventoId}: ${err.message}. ` +
          (reintentar ? "Se reintentará una vez." : `Enviado a la DLQ (${DLQ}).`)
      );
      if (!reintentar) eventosRechazados++;
      channel.nack(msg, false, reintentar);
    }
  });

  // Apagado ordenado (la plataforma envía SIGTERM al redesplegar): deja de recibir,
  // termina lo que tiene en curso y cierra la conexión.
  const apagar = async () => {
    if (cerrando) return;
    cerrando = true;
    console.log("[Consumidor] Apagando: dejando de consumir y cerrando la conexión");
    setTimeout(() => process.exit(0), 5000).unref();
    try {
      await channel.cancel(consumerTag);
      await connection.close();
    } catch (_) {
      // ya estaba cerrada
    }
    process.exit(0);
  };
  process.on("SIGTERM", apagar);
  process.on("SIGINT", apagar);
}

main().catch((err) => {
  console.error("Error en el consumidor:", err.message);
  process.exit(1);
});
