// Подключает все группы маршрутов
module.exports = (app) => {
  require("./player")(app);
  require("./ratings")(app);
  require("./game")(app);
  require("./social")(app);
  require("./payments")(app);
  require("./clans")(app);
  require("./fun")(app);
  require("./admin")(app);
};
