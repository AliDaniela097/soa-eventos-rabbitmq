const crypto = require("crypto");
const amqp = require("amqplib");

const QUEUE = "productos.consultados";
// En la nube la dirección de RabbitMQ viene de la variable RABBITMQ_URL. En tu PC se usa la local.
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";

async function publicarProductoConsultado(cantidadProductos) {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: false });

  const evento = {
    eventoId: crypto.randomUUID(),
    tipo: "ProductoConsultado",
    fecha: new Date().toISOString(),
    origen: "soa-productos-service",
    totalProductosDevueltos: cantidadProductos,
  };

  channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(evento)));
  console.log("[ESB] Evento ProductoConsultado publicado en RabbitMQ:", evento);

  await channel.close();
  await connection.close();
}

module.exports = { publicarProductoConsultado };