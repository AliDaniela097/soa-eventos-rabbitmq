import { Controller, Get, Render } from '@nestjs/common';
import * as soap from 'soap';

// En la nube la dirección del servicio SOA viene de la variable SOA_URL. En tu PC se usa la local.
const SOA_URL = (process.env.SOA_URL ?? 'http://localhost:3000').replace(/\/$/, '');
// En planes gratis el servicio puede tardar cerca de un minuto en despertar.
const ESPERA_MS = 90000;

@Controller()
export class AppController {
  @Get()
  @Render('index')
  async index() {
    try {
      const client = await soap.createClientAsync(`${SOA_URL}/wsdl?wsdl`, {
        endpoint: `${SOA_URL}/wsdl`,
        wsdl_options: { timeout: ESPERA_MS },
      });
      const [result] = await client.ObtenerProductosAsync({}, { timeout: ESPERA_MS });
      const productos = (result.productos || []).map((linea: string) => {
        const [id, nombre, precio] = linea.split('|');
        return { id, nombre, precio };
      });
      return { productos };
    } catch (error) {
      console.error('[Frontend] No se pudo consultar el servicio SOA:', (error as Error).message);
      return {
        productos: [],
        error: 'No se pudo consultar el servicio SOA. Si está iniciando, espera un minuto y recarga la página.',
      };
    }
  }
}
