const soap = require("soap");

soap.createClient("http://localhost:3000/wsdl?wsdl", function (err, client) {
  if (err) return console.error(err);
  client.ObtenerProductos({}, function (err, result) {
    if (err) return console.error(err);
    console.log("Respuesta:", result);
  });
});