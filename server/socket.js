module.exports = (io, sql, app_cfg, logger, waip) => {
  // Socket.IO-Konfigurationen

  // Wachalarm
  const nsp_waip = io.of("/waip");
  nsp_waip.on("connection", (socket) => {
    // versuche Client-IP zu ermitteln
    let client_ip = socket.handshake.headers["x-real-ip"] || socket.handshake.headers["x-forwarded-for"].split(",")[0] || socket.handshake.address;

    // Verbindungsfehler protokollieren
    socket.on("connection_error", (err) => {
      logger.log("error", err.message);
    });

    // trennen protokollieren und Client-Socket aus DB löschen
    socket.on("disconnect", (reason, details) => {
      logger.log("log", `Alarmmonitor von ${client_ip} (${socket.id}) geschlossen. (Grund: ${reason}, Details: ${details})`);
      sql.db_client_delete(socket);
    });

    // bei jedem Connect die Server-Version senden, damit der Client diese prueft und die Seite ggf. neu laedt
    socket.emit("io.version", app_cfg.global.app_id);

    // Aufruf des Alarmmonitors einer bestimmten Wache verarbeiten
    socket.on("WAIP", async (wachen_nr) => {
      try {
        
        // prüfen ob Wachenummer in der Datenbank hinterlegt ist
        const result = await sql.db_wache_vorhanden(wachen_nr);
        if (!result) {
          throw `Abfrage der Wache ${wachen_nr} lieferte kein Ergebnis!`;
        }

        // Raum der Wache beitreten
        socket.join(wachen_nr);
        logger.db_log("WAIP", `Alarmmonitor Nr. ${wachen_nr} wurde von ${client_ip} (${socket.id}) aufgerufen.`);

        // anzuzeigenden Einsatz abfragen
        const waip_id = await sql.db_einsatz_ermitteln(wachen_nr);
        
        if (waip_id) {
          // Einsatzdaten abfragen
          var einsatzdaten = await sql.db_einsatz_get_for_wache(waip_id, wachen_nr);
        } else {
          var einsatzdaten = null;
        }

        // wenn Einsatz vorhanden, dann diesen senden, sonst Standby senden
        if (einsatzdaten) {
          // Einsatz senden, falls vorhanden
          logger.log("log", `Einsatz ${einsatzdaten.id} für Wache ${wachen_nr} vorhanden, wird jetzt an Client ${socket.id} gesendet.`);

          //letzten Einsatz an Alarmmonitor senden
          waip.waip_verteilen_for_one_client(einsatzdaten, socket, wachen_nr);
        } else {
          // Standby an Alarmmonitor senden
          waip.standby_verteilen_for_one_client(socket);
          logger.log("log", `Kein Einsatz für Wache ${wachen_nr} vorhanden, gehe in Standby.`);
        }
      } catch (error) {
        const logMessage = `Fehler beim Aufruf des Alarmmonitors Nr. ${wachen_nr} von ${client_ip} (${socket.id})! ${error}`;
        logger.log("error", logMessage);
        // Fehlermeldung senden und Verbindung trennen
        socket.emit("io.error", logMessage);
        socket.disconnect(true);
      }
    });
  });

  // Dashboard
  const nsp_dbrd = io.of("/dbrd");
  nsp_dbrd.on("connection", (socket) => {
    // versuche Client-IP zu ermitteln
    let client_ip = socket.handshake.headers["x-real-ip"] || socket.handshake.headers["x-forwarded-for"].split(",")[0] || socket.handshake.address;

    // Verbindungsfehler protokollieren
    socket.on("connection_error", (err) => {
      logger.log("error", err.message);
    });

    // trennen protokollieren und Client-Socket aus DB löschen
    socket.on("disconnect", (reason, details) => {
      logger.log("log", `Dashboard von ${client_ip} (${socket.id}) geschlossen. (Grund: ${reason}, Details: ${details})`);
      sql.db_client_delete(socket);
    });

    // bei jedem Connect die Server-Version senden, damit der Client diese prueft und die Seite ggf. neu laedt
    socket.emit("io.version", app_cfg.global.app_id);

    // Aufruf des Dashboards mit einer bestimmten Einsatz-UUID verarbeiten
    socket.on("dbrd", async (uuid) => {
      try {
        // prüfen ob Dashboard/Einsatz vorhanden
        const dbrd_uuid = await sql.db_einsatz_check_uuid(uuid);
        if (!dbrd_uuid) {
          throw `Abfrage des Dashboards mit der UUID ${uuid} ist nicht mehr vorhanden (Anfrage lieferte kein Ergebnis)!`;
        } else {
          // Dashboard/Einsatz scheint vorhanden/plausibel, Socket-Room beitreten
          socket.join(dbrd_uuid.uuid);
          logger.db_log("DBRD", `Dashboard mit der UUID ${uuid} wurde von ${client_ip} (${socket.id}) aufgerufen.`);

          // Einsatz an Dashboard senden
          waip.dbrd_verteilen(dbrd_uuid.uuid, socket);
        }
      } catch (error) {
        const logMessage = `Fehler beim Aufruf des Dashboards mit der UUID ${uuid} von ${client_ip} (${socket.id})! ${error}`;
        logger.log("error", logMessage);
        // Fehlermeldung senden und Verbindung trennen
        socket.emit("io.error", logMessage);
        socket.disconnect(true);
      }
    });
  });

};
