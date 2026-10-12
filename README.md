# SOA + ESB + RabbitMQ + Frontend MVC

Reto 1 de Integración de Sistemas (Semana 5): cuatro piezas conectadas en un solo flujo end-to-end.

## Flujo

```
Frontend MVC (NestJS) --SOAP--> Servicio SOA + mini-ESB --evento--> RabbitMQ --> Consumidor
```

1. El frontend llama por SOAP a la operación `ObtenerProductos`.
2. El servicio SOA arma la respuesta y su capa mini-ESB (`evento-publisher.js`) publica el evento `ProductoConsultado` en RabbitMQ.
3. El servicio responde al frontend con la lista de productos.
4. El consumidor escucha la cola `productos.consultados` e imprime cada evento.

## Proyectos

| Carpeta | Qué hace | Puerto |
|---|---|---|
| `soa-productos-service` | Servicio SOAP con contrato WSDL (`productos.wsdl`). Publica el evento en RabbitMQ | 3000 |
| `consumidor-eventos` | Consume la cola `productos.consultados` | n/a |
| `frontend-mvc` | NestJS + Handlebars. Consume el servicio por SOAP y muestra los productos | 3001 |

## Contratos

- `soa-productos-service/productos.wsdl`: contrato formal del servicio SOAP (operación `ObtenerProductos`).
- `contrato.yaml`: el mismo servicio documentado en OpenAPI 3.0.3, más el esquema del evento `ProductoConsultado` y los datos de la cola de RabbitMQ (`x-mensajeria`). Si hay diferencias, manda el WSDL.

## Requisitos

- Node.js 18 o superior
- Docker Desktop (para RabbitMQ)

## Cómo ejecutarlo

1. Levantar RabbitMQ (solo la primera vez; luego `docker start rabbitmq-integracion`):

   ```bash
   docker run -d --name rabbitmq-integracion -p 5672:5672 -p 15672:15672 rabbitmq:3-management
   ```

2. Instalar dependencias en cada proyecto:

   ```bash
   cd soa-productos-service && npm install
   cd ../consumidor-eventos && npm install
   cd ../frontend-mvc && npm install
   ```

3. Arrancar cada pieza en su propia terminal:

   ```bash
   # soa-productos-service
   node index.js

   # consumidor-eventos
   node index.js

   # frontend-mvc
   npm run start
   ```

4. Abrir:
   - Frontend: http://localhost:3001
   - Contrato WSDL: http://localhost:3000/wsdl?wsdl
   - Consola de RabbitMQ: http://localhost:15672 (usuario `guest`, contraseña `guest`)

Cada vez que se recarga el frontend, el consumidor imprime un nuevo evento. Si el consumidor está apagado, los eventos esperan en la cola y se procesan cuando vuelve a arrancar.

## Variables de entorno (despliegue en la nube)

Todas son opcionales. Sin ellas, el sistema corre en local como se describe arriba.

| Proyecto | Variable | Para qué sirve | Valor por defecto |
|---|---|---|---|
| `soa-productos-service` | `PORT` | Puerto del servicio (la plataforma lo asigna) | `3000` |
| `soa-productos-service` | `PUBLIC_URL` | URL pública del servicio, se escribe dentro del WSDL | `http://localhost:PORT` |
| `soa-productos-service` | `RABBITMQ_URL` | Dirección de RabbitMQ | `amqp://localhost` |
| `consumidor-eventos` | `RABBITMQ_URL` | Dirección de RabbitMQ | `amqp://localhost` |
| `consumidor-eventos` | `PORT` | Si existe, abre un mini servidor que responde `{"estado":"ok"}` (las plataformas gratis solo aceptan servicios web) | desactivado |
| `frontend-mvc` | `PORT` | Puerto del frontend | `3001` |
| `frontend-mvc` | `SOA_URL` | URL pública del servicio SOA | `http://localhost:3000` |

## Tecnologías

Node.js, Express, soap, amqplib, RabbitMQ, NestJS, Handlebars.

## Declaración de uso de IA

- Herramienta(s): Claude (Anthropic)
- Nivel de uso: 2–3 (guía paso a paso, interpretación de errores y revisión)
- Qué se le pidió: explicación de conceptos, guía de ejecución, ayuda con errores de Docker y puertos, y revisión del código
- Qué se modificó/verificó manualmente: levanté RabbitMQ con Docker, verifiqué la cola en la consola, probé cada pieza y el flujo completo
