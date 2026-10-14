# SOA + ESB + RabbitMQ + Frontend MVC

Reto 1 de Integración de Sistemas (Semana 5): cuatro piezas conectadas en un solo flujo end-to-end.

## Flujo

```
Frontend MVC (NestJS) --SOAP--> Servicio SOA + mini-ESB --evento--> RabbitMQ --> Consumidor
```

1. El frontend llama por SOAP a la operación `ObtenerProductos`.
2. El servicio SOA arma la respuesta y su capa mini-ESB (`evento-publisher.js`) publica el evento `ProductoConsultado` en RabbitMQ.
3. El servicio responde al frontend con la lista de productos.
4. El consumidor escucha la cola `productos.consultados.v2` e imprime cada evento.

## Proyectos

| Carpeta | Qué hace | Puerto |
|---|---|---|
| `soa-productos-service` | Servicio SOAP con contrato WSDL (`productos.wsdl`). Publica el evento en RabbitMQ | 3000 |
| `consumidor-eventos` | Consume la cola `productos.consultados.v2` | n/a |
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

Cada vez que se recarga el frontend, el consumidor imprime un nuevo evento. Si el consumidor está apagado, los eventos esperan en la cola y se procesan cuando vuelve a arrancar. La cola es durable y los mensajes son persistentes: sobreviven a un reinicio de RabbitMQ.

## Mensajería: cola, DLQ y reintentos

| Elemento | Valor |
|---|---|
| Cola principal | `productos.consultados.v2` (durable, mensajes persistentes) |
| Exchange de rechazados | `productos.dlx` (direct, durable) |
| Cola de rechazados (DLQ) | `productos.consultados.v2.dlq` (durable) |

- Un mensaje inválido (no es JSON o no cumple el esquema del evento) va directo a la DLQ. El consumidor sigue funcionando.
- Si el procesamiento de un evento falla, se reintenta una vez. Si vuelve a fallar, va a la DLQ.
- Los eventos repetidos (mismo `eventoId`) se ignoran. RabbitMQ entrega *at-least-once*, así que puede repetir.
- El productor usa una conexión reutilizable con confirmaciones y tiempos máximos. Si RabbitMQ falla, el servicio SOAP responde igual con los productos y registra el error.
- La cola se llama `.v2` porque RabbitMQ no permite cambiar una cola ya creada a durable ni agregarle una DLQ. La cola antigua `productos.consultados` ya no se usa y se puede borrar desde la consola de RabbitMQ.
- Productor y consumidor deben declarar la cola con los mismos parámetros (están escritos en `evento-publisher.js` y en `consumidor-eventos/index.js`).

## Protección del endpoint SOAP

`POST /wsdl` rechaza cuerpos de más de 16 KB (respuesta 413) y más de 120 peticiones por minuto desde una misma IP (respuesta 429). Es una defensa mínima para un servicio público de laboratorio. No reemplaza una autenticación.

## Pruebas automáticas

```bash
cd frontend-mvc
npm test        # pruebas del controlador (sin red)
npm run test:e2e
```

## Variables de entorno (despliegue en la nube)

Todas son opcionales. Sin ellas, el sistema corre en local como se describe arriba.

| Proyecto | Variable | Para qué sirve | Valor por defecto |
|---|---|---|---|
| `soa-productos-service` | `PORT` | Puerto del servicio (la plataforma lo asigna) | `3000` |
| `soa-productos-service` | `PUBLIC_URL` | URL pública del servicio, se escribe dentro del WSDL | `http://localhost:PORT` |
| `soa-productos-service` | `RABBITMQ_URL` | Dirección de RabbitMQ | `amqp://localhost` |
| `consumidor-eventos` | `RABBITMQ_URL` | Dirección de RabbitMQ | `amqp://localhost` |
| `consumidor-eventos` | `PORT` | Si existe, abre un mini servidor que responde `{"estado":"ok","cola":...,"eventosRecibidos":N,"eventosDuplicados":N,"eventosRechazados":N}` (las plataformas gratis solo aceptan servicios web) | desactivado |
| `frontend-mvc` | `PORT` | Puerto del frontend | `3001` |
| `frontend-mvc` | `SOA_URL` | URL pública del servicio SOA | `http://localhost:3000` |

## Despliegue en la nube (gratis, sin tarjeta)

| Pieza | URL pública | Plataforma |
|---|---|---|
| Frontend MVC | https://soa-frontend-mvc.onrender.com | Render (servicio web, plan gratis) |
| Servicio SOA | https://soa-productos-service-cirp.onrender.com (WSDL: `/wsdl?wsdl`, estado: `/health`) | Render (servicio web, plan gratis) |
| Consumidor | https://soa-consumidor-eventos.onrender.com (muestra `eventosRecibidos`) | Render (servicio web, plan gratis) |
| RabbitMQ | Sin página pública. Se conecta con `RABBITMQ_URL` (lleva contraseña, no se publica) | CloudAMQP, plan Little Lemur (gratis) |

```
Navegador --> Frontend (Render) --SOAP/HTTPS--> SOA + mini-ESB (Render)
                                                      |
                                                      | amqps (TLS)
                                                      v
                                         RabbitMQ (CloudAMQP) --> Consumidor (Render)
```

Configuración de cada servicio en Render (repositorio `main`, cada uno con su carpeta como *Root Directory*):

| Servicio | Root Directory | Build | Start | Variables de entorno |
|---|---|---|---|---|
| `soa-productos-service` | `soa-productos-service` | `npm install` | `node index.js` | `RABBITMQ_URL`, `PUBLIC_URL` |
| `soa-frontend-mvc` | `frontend-mvc` | `npm install && npm run build` | `npm run start:prod` | `SOA_URL` |
| `soa-consumidor-eventos` | `consumidor-eventos` | `npm install` | `node index.js` | `RABBITMQ_URL` |

Límites reales de usar planes gratis:

- Los servicios gratis de Render se duermen tras 15 minutos sin tráfico y la primera visita puede tardar cerca de 1 minuto.
- Un consumidor dormido no lee la cola. Los eventos esperan en RabbitMQ (la cola es durable) y se procesan cuando el servicio despierta.
- No hay garantía de disponibilidad. Para una demostración, abrir las tres URL unos minutos antes.
- La contraseña de RabbitMQ solo vive en las variables de entorno de Render. Nunca se sube al repositorio (`.env` está en `.gitignore`).

La auditoría técnica del sistema (mensajería, backend y despliegue) está en [`AUDITORIA_BACKEND.md`](AUDITORIA_BACKEND.md).

## Tecnologías

Node.js, Express, soap, amqplib, RabbitMQ, NestJS, Handlebars, Render y CloudAMQP (despliegue).

## Declaración de uso de IA

- Herramienta(s): Claude (Anthropic)
- Nivel de uso: 2–3 (guía paso a paso, interpretación de errores y revisión)
- Qué se le pidió: explicación de conceptos, guía de ejecución, ayuda con errores de Docker y puertos, revisión del código, guía de despliegue en la nube y una auditoría técnica
- Qué se modificó/verificó manualmente: levanté RabbitMQ con Docker, verifiqué la cola en la consola, probé cada pieza y el flujo completo
