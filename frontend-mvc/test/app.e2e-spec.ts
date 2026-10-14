import { Test, TestingModule } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import request from "supertest";
import * as soap from "soap";
import { AppModule } from "./../src/app.module";

// Prueba de extremo a extremo del frontend: la página real, con el servicio SOA simulado.
describe("AppController (e2e)", () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    jest.spyOn(soap, "createClientAsync").mockResolvedValue({
      ObtenerProductosAsync: jest
        .fn()
        .mockResolvedValue([
          { productos: ["1|Teclado mecánico|45.9", '3|Monitor 24"|129.99'] },
        ]),
    } as unknown as soap.Client);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Misma configuración de vistas que src/main.ts
    app.setBaseViewsDir(join(__dirname, "..", "views"));
    app.setViewEngine("hbs");
    await app.init();
  });

  it("/ (GET) muestra los productos con precio de dos decimales", async () => {
    const respuesta = await request(app.getHttpServer()).get("/").expect(200);

    expect(respuesta.text).toContain("Productos consultados vía servicio SOA");
    expect(respuesta.text).toContain("Teclado mecánico — $45.90");
    expect(respuesta.text).toContain("Monitor 24&quot; — $129.99");
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });
});
