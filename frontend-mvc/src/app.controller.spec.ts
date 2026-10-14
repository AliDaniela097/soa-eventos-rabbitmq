import * as soap from "soap";
import { AppController } from "./app.controller";

// Pruebas del controlador sin red: se reemplaza la librería soap por un cliente simulado.
describe("AppController", () => {
  let controller: AppController;
  let crearCliente: jest.SpyInstance;

  const clienteCon = (productos: string[]) =>
    ({
      ObtenerProductosAsync: jest.fn().mockResolvedValue([{ productos }]),
    }) as unknown as soap.Client;

  beforeEach(() => {
    controller = new AppController();
    crearCliente = jest.spyOn(soap, "createClientAsync");
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("separa id|nombre|precio y muestra el precio con dos decimales", async () => {
    crearCliente.mockResolvedValue(
      clienteCon([
        "1|Teclado mecánico|45.9",
        "2|Mouse inalámbrico|19.5",
        '3|Monitor 24"|129.99',
      ]),
    );

    const vista = await controller.index();

    expect(vista).toEqual({
      productos: [
        { id: "1", nombre: "Teclado mecánico", precio: "45.90" },
        { id: "2", nombre: "Mouse inalámbrico", precio: "19.50" },
        { id: "3", nombre: 'Monitor 24"', precio: "129.99" },
      ],
    });
  });

  it("deja el precio tal cual si no es un número", async () => {
    crearCliente.mockResolvedValue(clienteCon(["9|Sin precio|abc"]));

    const vista = await controller.index();

    expect(vista).toEqual({
      productos: [{ id: "9", nombre: "Sin precio", precio: "abc" }],
    });
  });

  it("muestra un mensaje amable si el servicio SOA no responde", async () => {
    crearCliente.mockRejectedValue(new Error("ECONNREFUSED"));

    const vista = (await controller.index()) as {
      productos: unknown[];
      error?: string;
    };

    expect(vista.productos).toEqual([]);
    expect(vista.error).toContain("No se pudo consultar el servicio SOA");
  });

  it("reutiliza el cliente SOAP entre visitas", async () => {
    crearCliente.mockResolvedValue(clienteCon(["1|Teclado mecánico|45.9"]));

    await controller.index();
    await controller.index();

    expect(crearCliente).toHaveBeenCalledTimes(1);
  });

  it("vuelve a intentar crear el cliente después de un fallo", async () => {
    crearCliente.mockRejectedValueOnce(new Error("dormido"));
    crearCliente.mockResolvedValueOnce(clienteCon(["1|Teclado mecánico|45.9"]));

    const primera = (await controller.index()) as { error?: string };
    const segunda = (await controller.index()) as { productos: unknown[] };

    expect(primera.error).toBeDefined();
    expect(segunda.productos).toHaveLength(1);
    expect(crearCliente).toHaveBeenCalledTimes(2);
  });
});
