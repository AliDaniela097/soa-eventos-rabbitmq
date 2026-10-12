const amqp = require("amqplib");
const http = require("http");

const QUEUE = "productos.consultados";
// En la nube la dirección de RabbitMQ viene de la variable RABBITMQ_URL. En tu PC se usa la local.
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
let eventosRecibidos = 0;

// Las plataformas gratis (como Render) solo aceptan servicios web.
// Este mini servidor responde "estoy vivo" y solo se activa cuando la plataforma define PORT.
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ estado: "ok", cola: QUEUE, eventosRecibidos }));
    })
    .listen(process.env.PORT, () => console.log("Consumidor visible en el puerto", process.env.PORT));
}

async function main() {
  const connection = await amqp.connect(RABBITMQ_URL);
  connection.on("error", (err) => console.error("Error de conexión con RabbitMQ:", err.message));
  connection.on("close", () => {
    console.error("Conexión con RabbitMQ cerrada. Saliendo para que la plataforma reinicie el consumidor.");
    process.exit(1);
  });

  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE, { durable: false });

  console.log("Escuchando eventos en la cola:", QUEUE);

  channel.consume(QUEUE, (msg) => {
    if (msg !== null) {
      const evento = JSON.parse(msg.content.toString());
      eventosRecibidos++;
      console.log("[Consumidor] Evento recibido:", evento);
      channel.ack(msg);
    }
  });
}

main().catch((err) => {
  console.error("Error en el consumidor:", err.message);
  process.exit(1);
});
