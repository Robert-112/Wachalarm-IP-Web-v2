module.exports = (io, sql, app_cfg, logger, waip, remote_api, saver) => {
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
    socket.on("WAIP", async (wachen_id) => {
      logger.db_log("WAIP", `Alarmmonitor Nr. ${wachen_id} wurde von ${client_ip} (${socket.id}) aufgerufen.`);
      try {
        // prüfen ob Wachenummer in der Datenbank hinterlegt ist
        const result = await sql.db_wache_vorhanden(wachen_id);
        if (!result) {
          throw `Abfrage der Wache ${wachen_id} lieferte kein Ergebnis!`;
        } else {
          // Wachennummer scheint vorhanden/plausibel, Socket-Room beitreten
          socket.join(wachen_id);

          // anzuzeigenden Einsatz abfragen
          const result_einsatz = await sql.db_einsatz_ermitteln(wachen_id, socket);

          // wenn Einsatz vorhanden, diesen senden, sonst Standby senden
          if (result_einsatz) {
            // nur den ersten Einsatz senden, falls mehrere vorhanden sind
            let waip_id = result_einsatz[0].waip_einsaetze_ID;
            logger.log("log", `Einsatz ${waip_id} für Wache ${wachen_id} vorhanden, wird jetzt an Client ${socket.id} gesendet.`);

            //letzten Einsatz an Alarmmonitor senden
            waip.waip_verteilen(waip_id, socket, wachen_id);

            //vorhandene Rückmeldungen an Alarmmonitor senden
            waip.rmld_verteilen_for_one_client(waip_id, socket, wachen_id);

            // Client-Status mit Wachennummer aktualisieren
            sql.db_client_update_status(socket, waip_id);
          } else {
            // falls kein Einsatz vorhanden ist, dann Standby senden
            logger.log("log", `Kein Einsatz für Wache ${wachen_id} vorhanden, gehe in Standby.`);
            socket.emit("io.standby", null);
            sql.db_client_update_status(socket, null);
          }
        }
      } catch (error) {
        const logMessage = `Fehler beim Aufruf des Alarmmonitors Nr. ${wachen_id} von ${client_ip} (${socket.id})! ${error}`;
        logger.log("error", logMessage);
        socket.emit("io.error", logMessage);
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
      logger.db_log("DBRD", `Dashboard mit der UUID ${uuid} wurde von ${client_ip} (${socket.id}) aufgerufen.`);
      try {
        // prüfen ob Dashboard/Einsatz vorhanden
        const dbrd_uuid = await sql.db_einsatz_check_uuid(uuid);
        if (!dbrd_uuid) {
          throw `Abfrage des Dashboards mit der UUID ${uuid} scheint nicht (mehr) vorhanden (Abfrage lieferte kein Ergebnis)!`;
        } else {
          // Dashboard/Einsatz scheint vorhanden/plausibel, Socket-Room beitreten
          socket.join(dbrd_uuid.uuid);

          // Einsatz an Dashboard senden
          waip.dbrd_verteilen(dbrd_uuid.uuid, socket);

          // Client-Status mit Wachennummer aktualisieren
          sql.db_client_update_status(socket, dbrd_uuid.uuid);
        }
      } catch (error) {
        const logMessage = `Fehler beim Aufruf des Dashboards mit der UUID ${uuid} von ${client_ip} (${socket.id})! ${error}`;
        logger.log("error", logMessage);
        socket.emit("io.error", logMessage);
      }
    });
  });

  // Websocket-API (eingehend, anderer Server stellt Verbindung her und sendet Daten))
  if (app_cfg.api.enabled) {
    const nsp_api = io.of("/api");
    nsp_api.on("connection", (socket) => {
      // versuche Remote-IP zu ermitteln
      let remote_ip = socket.handshake.headers["x-real-ip"] || socket.handshake.headers["x-forwarded-for"].split(",")[0] || socket.handshake.address;

      // Verbindungsfehler protokollieren
      socket.on("connection_error", (err) => {
        logger.log("error", err.message);
      });

      // trennen protokollieren und Client-Socket aus DB löschen
      socket.on("disconnect", (reason, details) => {
        logger.log("log", `API-Verbindung von ${remote_ip} (${socket.id}) geschlossen. (Grund: ${reason}, Details: ${details})`);
        sql.db_client_delete(socket);
      });

      // Remote-Verbindung nur zulassen, wenn IP in Access-List, und Access-List ueberhaupt befuellt
      if (!app_cfg.api.access_list.includes(remote_ip) && app_cfg.api.access_list.length > 0) {
        socket.disconnect(true);
        logger.db_log("API", `API-Verbindung von ${remote_ip} getrennt, da nicht in Zugangsliste (${app_cfg.api.access_list})enthalten!`);
      }

      // in Liste der Clients mit aufnehmen
      sql.db_client_update_status(socket, "api");

      // neuen externen Einsatz speichern (vom Client zum Server)
      socket.on("from_client_to_server_new_waip", async (raw_data) => {
        let data = raw_data.data;
        let app_id = raw_data.app_id;
        // nur speichern wenn app_id nicht der eigenen globalen app_id entspricht
        if (app_id != app_cfg.global.app_id) {
          try {
            await saver.save_new_waip(data, remote_ip, app_id);
            logger.db_log("API", `Neuer Wachalarm von ${remote_ip}. Wird verarbeitet.`);
            logger.log("log", `Alarmdaten per Websocket-API von ${remote_ip} erhalten. Data: ${data}`);
          } catch (error) {
            const logMessage = `Fehler beim speichern von Alarmdaten von ${remote_ip} über die Websocket-API (Server)! Data: ${data} Error: ${error}`;
            logger.log("error", logMessage);
            socket.emit("io.error", logMessage);
          }
        } else {
          logger.db_log(
            "warn",
            `Alarmdaten per Websocket-API (Server) von ${remote_ip} erhalten, aber verworfen da gleiche App-ID ${app_id}! Data: ${data}`
          );
        }
      });

      // neue externe Rueckmeldung speichern (vom Client zum Server)
      socket.on("from_client_to_server_new_rmld", async (raw_data) => {
        let data = raw_data.data;
        let app_id = raw_data.app_id;
        // nur speichern wenn app_id nicht eigenen globalen app_id entspricht
        if (app_id != app_cfg.global.app_id) {
          try {
            await saver.save_new_rmld(data, remote_ip, app_id);
            logger.db_log("API", `Rückmeldung von ${remote_ip} erhalten. Wird verarbeitet.`);
            logger.log("log", `Rückmeldung per Websocket-API (Server) von ${remote_ip} erhalten. Data: ${data}`);
          } catch (error) {
            const logMessage = `Fehler beim speichern einer Rückmeldung von ${remote_ip} über die Websocket-API (Server)! Data: ${data} Error: ${error}`;
            logger.log("error", logMessage);
            socket.emit("io.error", logMessage);
          }
        } else {
          logger.db_log(
            "warn",
            `Rückmeldedaten per Websocket-API (Server) von ${remote_ip} erhalten, aber verworfen da gleiche App-ID ${app_id}! Data: ${data}`
          );
        }
      });
    });
  }

  // Websocket-API (ausgehend, Verbindung zu einem anderen Server herstellen)
  if (app_cfg.endpoint.enabled) {
    // TODO API: Verbindungsaufbau mit passendem Geheimnis absichern, IP-Adresse senden

    // Verbindungsaufbau protokollieren
    remote_api.on("connect", () => {
      logger.log("log", `Websocket-Verbindung mit ${app_cfg.endpoint.host} hergestellt`);
    });

    // Verbindungsabbau protokollieren
    remote_api.on("disconnect", (reason) => {
      logger.log("warn", `Websocket-Verbindung zu ${app_cfg.endpoint.host} verloren, Fehler: ${reason}`);
    });

    // Fehler protokollieren
    remote_api.on("connect_error", (err) => {
      logger.log("error", `Websocket-Verbindung zu ${app_cfg.endpoint.host} verloren, Fehler: ${err}`);
    });

    // neuer Einsatz vom Endpoint-Server (vom Server zum Client)
    remote_api.on("from_server_to_client_new_waip", async (raw_data) => {
      let data = raw_data.data;
      let app_id = raw_data.app_id;
      // nur speichern wenn app_id nicht eigenen globalen app_id entspricht
      if (app_id != app_cfg.global.app_id) {
        try {
          await saver.save_new_waip(data, remote_ip, app_id);
          logger.db_log("API", `Neuer Wachalarm von ${remote_ip}. Wird verarbeitet.`);
          logger.log("log", `Alarmdaten per Websocket-API (Client) von ${remote_ip} erhalten. Data: ${data}`);
        } catch (error) {
          const logMessage = `Fehler beim speichern von Alarmdaten von ${remote_ip} über die Websocket-API (Client)! Data: ${data} Error: ${error}`;
          logger.log("error", logMessage);
          socket.emit("io.error", logMessage);
        }
      } else {
        logger.db_log(
          "warn",
          `Alarmdaten per Websocket-API (Client) von ${remote_ip} erhalten, aber verworfen da gleiche App-ID ${app_id}! Data: ${data}`
        );
      }
    });

    // neue Rückmeldung vom Endpoint-Server (vom Server zum Client)
    remote_api.on("from_server_to_client_new_rmld", async (raw_data) => {
      let data = raw_data.data;
      let app_id = raw_data.app_id;
      // nur speichern wenn app_id nicht eigenen globalen app_id entspricht
      if (app_id != app_cfg.global.app_id) {
        try {
          await saver.save_new_rmld(data, app_cfg.endpoint.host, app_id);
          logger.db_log("API", `Rückmeldung von ${remote_ip} erhalten. Wird verarbeitet.`);
          logger.log("log", `Rückmeldung per Websocket-API (Client) von ${remote_ip} erhalten. Data: ${data}`);
        } catch (error) {
          const logMessage = `Fehler beim speichern einer Rückmeldung von ${remote_ip} über die Websocket-API (Client)! Data: ${data} Error: ${error}`;
          logger.log("error", logMessage);
          socket.emit("io.error", logMessage);
        }
      } else {
        logger.db_log(
          "warn",
          `Rückmeldedaten per Websocket-API (Client) von ${remote_ip} erhalten, aber verworfen da gleiche App-ID ${app_id}! Data: ${data}`
        );
      }
    });
  }
};
