module.exports = (app_cfg, logger, saver) => {
  // Module laden
  let dgram = require("dgram");
  let udp_server = dgram.createSocket("udp4");

  // UDP-Server für Schnittstelle starten
  udp_server.bind(app_cfg.global.udpport);
  udp_server.on("listening", () => {
    let address = udp_server.address();
    logger.log("log", `UDP Server auf ${address.address}:${address.port} gestartet.`);
  });

  // Warten auf Einsatzdaten
  udp_server.on("message", (message, remote) => {
    try {
      saver.save_new_waip(message.toString("utf8"), remote.address + ":" + remote.port, "udp");
    } catch (error) {
      logger.log("error", `Fehler beim Speichern eines neuen Einsatzes per UDP von ${address.address}:${address.port}!`, error);
    }    
  });
};
