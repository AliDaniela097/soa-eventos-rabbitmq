import { Controller, Get, Render } from '@nestjs/common';
import * as soap from 'soap';

@Controller()
export class AppController {
  @Get()
  @Render('index')
  async index() {
    const client = await soap.createClientAsync('http://localhost:3000/wsdl?wsdl');
    const [result] = await client.ObtenerProductosAsync({});
    const productos = (result.productos || []).map((linea: string) => {
      const [id, nombre, precio] = linea.split('|');
      return { id, nombre, precio };
    });
    return { productos };
  }
}