module.exports = (io, sql, app_cfg, waip) => {
  // Socket.IO Alarmmonitor

  let nsp_waip = io.of("/waip");

  nsp_waip.on("connection", (socket) => {
    // versuche Client-IP zu ermitteln
    let client_ip =
      socket.handshake.headers["x-real-ip"] ||
      socket.handshake.headers["x-forwarded-for"] ||
      socket.request.connection.remoteAddress;
    //zuerst Server-Version senden, damit der Client diese prueft und die Seite ggf. neu laedt
    socket.emit("io.version", app_cfg.global.app_id);

    // Aufruf des Alarmmonitors einer bestimmten Wache verarbeiten
    socket.on("WAIP", async (wachen_id) => {
      sql.db_log(
        "DEBUG",
        "Alarmmonitor Nr. " +
          wachen_id +
          " von " +
          client_ip +
          " (" +
          socket.id +
          ") aufgerufen."
      );
      // prüfen ob Wachenummer in der Datenbank hinterlegt ist
      const result = await sql.db_wache_vorhanden(wachen_id);
      // wenn die Wachennummer vorhanden/plausibel dann weiter
      if (result) {
        // Socket-Room beitreten
        socket.join(wachen_id, async () => {
          const result_einsatz = await sql.db_einsatz_ermitteln(
            wachen_id,
            socket
          );
          if (result_einsatz) {
            // nur den ersten Einsatz senden, falls mehrere vorhanden sind
            let waip_id = result_einsatz[0].waip_einsaetze_ID;
            sql.db_log(
              "WAIP",
              "Einsatz " +
                waip_id +
                " für Wache " +
                wachen_id +
                " vorhanden, wird jetzt an Client " +
                socket.id +
                " gesendet."
            );
            //letzten Einsatz verteilen
            waip.waip_verteilen(waip_id, socket, wachen_id);
            //vorhandene Rückmeldungen verteilen
            waip.rmld_verteilen_for_one_client(waip_id, socket, wachen_id);
          } else {
            sql.db_log(
              "WAIP",
              "Kein Einsatz für Wache " +
                wachen_id +
                " vorhanden, gehe in Standby"
            );
            // falls kein Einsatz vorhanden ist, dann Standby senden
            socket.emit("io.standby", null);
          }
          // in Statusüberischt speichern
          sql.db_client_update_status(socket, null);
        });
      } else {
        sql.db_log(
          "ERROR",
          "Fehler: Wachnnummer " + wachen_id + "nicht vorhanden!"
        );
        socket.emit(
          "io.error",
          "Fehler: Wachnnummer '" + wachen_id + "' nicht vorhanden!"
        );
      }
    });
    // Disconnect
    socket.on("disconnect", () => {
      sql.db_log(
        "DEBUG",
        "Alarmmonitor von " + client_ip + " (" + socket.id + ") geschlossen."
      );
      sql.db_client_delete(socket);
    });
  });

  // Socket.IO Dashboard

  let nsp_dbrd = io.of("/dbrd");

  nsp_dbrd.on("connection", (socket) => {
    // versuche Client-IP zu ermitteln
    let client_ip =
      socket.handshake.headers["x-real-ip"] ||
      socket.handshake.headers["x-forwarded-for"] ||
      socket.request.connection.remoteAddress;
    //zuerst Server-Version senden, damit der Client diese prueft und die Seite ggf. neu laedt
    socket.emit("io.version", app_cfg.global.app_id);
    // Aufruf des Dashboards eines bestimmten Einsatzes verarbeiten
    socket.on("dbrd", async (uuid) => {
      sql.db_log(
        "DEBUG",
        "Dashboard " +
          uuid +
          " von " +
          client_ip +
          " (" +
          socket.id +
          ") aufgerufen."
      );
      // prüfen ob Dashboard/Einsatz vorhanden
      const dbrd_uuid = await sql.db_einsatz_check_uuid(uuid);
      // wenn die Wachennummer vorhanden dann weiter
      if (dbrd_uuid) {
        // Socket-Room beitreiten
        socket.join(dbrd_uuid.uuid, () => {
          sql.db_log(
            "DBRD",
            "Einsatz " +
              dbrd_uuid.uuid +
              " für Dashboard " +
              dbrd_uuid.uuid +
              " vorhanden, wird jetzt an Client " +
              socket.id +
              " gesendet."
          );
          //letzten Einsatz verteilen
          waip.dbrd_verteilen(dbrd_uuid.uuid, socket);
          // in Statusüberischt speichern
          sql.db_client_update_status(socket, dbrd_uuid.uuid);
        });
      } else {
        sql.db_log(
          "ERROR",
          "Fehler: Dashboard " + uuid + "nicht (mehr) vorhanden!"
        );
        socket.emit(
          "io.error",
          "Fehler: Dashboard '" + uuid + "' nicht (mehr) vorhanden!"
        );
      }
    });
    // Disconnect
    socket.on("disconnect", (uuid) => {
      sql.db_log(
        "DEBUG",
        "Dashboard " +
          uuid +
          " von " +
          client_ip +
          " (" +
          socket.id +
          ") geschlossen."
      );
      sql.db_client_delete(socket);
    });
  });
};
