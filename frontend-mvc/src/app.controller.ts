import { Controller, Get, Render } from "@nestjs/common";
import * as soap from "soap";

// En la nube la dirección del servicio SOA viene de la variable SOA_URL. En tu PC se usa la local.
const SOA_URL = (process.env.SOA_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
// En planes gratis el servicio puede tardar cerca de un minuto en despertar.
const ESPERA_MS = 90000;

@Controller()
export class AppController {
  // El cliente SOAP (descarga y análisis del WSDL) se crea una sola vez y se reutiliza.
  // Si falla (por ejemplo, el SOA está dormido), se descarta para volver a intentarlo en la próxima visita.
  private clienteSoap: Promise<soap.Client> | null = null;

  private obtenerCliente(): Promise<soap.Client> {
    if (!this.clienteSoap) {
      this.clienteSoap = soap
        .createClientAsync(`${SOA_URL}/wsdl?wsdl`, {
          endpoint: `${SOA_URL}/wsdl`,
          wsdl_options: { timeout: ESPERA_MS },
        })
        .catch((error: unknown) => {
          this.clienteSoap = null;
          throw error;
        });
    }
    return this.clienteSoap;
  }

  @Get()
  @Render("index")
  async index() {
    try {
      const client = await this.obtenerCliente();
      const [result] = await client.ObtenerProductosAsync(
        {},
        { timeout: ESPERA_MS },
      );
      const productos = (result.productos || []).map((linea: string) => {
        const [id, nombre, precio] = linea.split("|");
        // Siempre con dos decimales ($45.90). Si no fuera un número, se muestra tal cual.
        const valor = Number(precio);
        return {
          id,
          nombre,
          precio: Number.isFinite(valor) ? valor.toFixed(2) : precio,
        };
      });
      return { productos };
    } catch (error) {
      console.error(
        "[Frontend] No se pudo consultar el servicio SOA:",
        (error as Error).message,
      );
      return {
        productos: [],
        error:
          "No se pudo consultar el servicio SOA. Si está iniciando, espera un minuto y recarga la página.",
      };
    }
  }
}
