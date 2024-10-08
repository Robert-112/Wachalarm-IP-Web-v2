module.exports = (app_cfg, sql, waip, uuidv4, logger) => {
  // Module laden
  const turf = require("@turf/turf");

  // Variablen festlegen
  let uuid_pattern = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "i");

  // Speichern eines neuen Einsatzes
  const save_einsatz = (waip_data, remote_addr) => {
    return new Promise(async (resolve, reject) => {
      try {
        let waip_json = await validate_einsatz(waip_data);
        if (waip_json) {
          // Polygon erzeugen und zuweisen falls nicht vorhanden
          if (!waip_json.ortsdaten.wgs84_area) {
            let wgs_x = parseFloat(waip_json.ortsdaten.wgs84_x);
            let wgs_y = parseFloat(waip_json.ortsdaten.wgs84_y);
            let point = turf.point([wgs_y, wgs_x]);
            let buffered = turf.buffer(point, 1, {
              steps: app_cfg.global.circumcircle,
              units: "kilometers",
            });
            let bbox = turf.bbox(buffered);
            let new_point = turf.randomPoint(1, {
              bbox: bbox,
            });
            let new_buffer = turf.buffer(new_point, 1, {
              steps: app_cfg.global.circumcircle,
              units: "kilometers",
            });
            waip_json.ortsdaten.wgs84_area = new_buffer;
          }
          // pruefen, ob vielleicht schon ein Einsatz mit einer UUID gespeichert ist
          let waip_uuid = await sql.db_einsatz_get_uuid_by_enr(waip_json.einsatzdaten.einsatznummer);
          if (waip_uuid) {
            // wenn ein Einsatz mit UUID schon vorhanden ist, dann diese setzten / ueberschreiben
            waip_json.einsatzdaten.uuid = waip_uuid;
          } else {
            // uuid erzeugen und zuweisen falls nicht bereits in JSON vorhanden, oder falls keine korrekte uuid
            if (!waip_json.einsatzdaten.uuid || !uuid_pattern.test(waip_json.einsatzdaten.uuid)) {
              waip_json.einsatzdaten.uuid = uuidv4();
            }
          }

          // Einsatzdaten in Datenbank speichern und ID des Einsatzes zurückbekommen
          const waip_id = await sql.db_einsatz_speichern(waip_json);
          logger.log(
            "log",
            `Neuer Einsatz von ${remote_addr} wurde mit der ID ${waip_id} gespeichert und wird jetzt weiter verarbeitet: ${JSON.stringify(
              waip_json
            )}`
          );

          // true zurückgeben
          resolve(true);

          // Einsatz an Socket-IO-Räume verteilen
          waip.waip_verteilen_for_rooms(waip_id);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren eines Einsatzes. " + waip_data);
        }
      } catch (error) {
        reject(new Error("Fehler beim speichern eines neuen Einsatzes (WAIP-JSON). " + remote_addr + " " + error));
      }
    });
  };

  const save_rmld = (rmld_data, remote_addr) => {
    return new Promise(async (resolve, reject) => {
      try {
        logger.log("debug", `Rückmeldung von ${remote_addr} erhalten, wird jetzt verarbeitet: ${JSON.stringify(rmld_data)}`);
        let valid = await validate_rmld(rmld_data);
        if (valid) {
          // Rückmeldung speichern
          const arr_uuid_rueckmeldungen = await sql.db_rmld_save(rmld_data);
          logger.log("log", `${arr_uuid_rueckmeldungen.length} Rückmeldung(en) von ${remote_addr} erhalten.`);

          // Rückmeldung verteilen
          //waip.rmld_verteilen_by_uuid(arr_uuid_rueckmeldungen);

          // true zurückgeben
          resolve(true);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren einer Rückmeldung. " + rmld_data);
        }
      } catch (error) {
        reject(new Error("Fehler beim speichern einer neuen Rückmeldung (RMLD). " + remote_addr + error));
      }
    });
  };

  const save_einsatzstatus = (einsatzstatus_data, remote_addr) => {
    return new Promise(async (resolve, reject) => {
      try {
        logger.log("log", `Meldung zu einem Einsatzstatus von ${remote_addr} erhalten, wird jetzt verarbeitet: ${JSON.stringify(rmld_data)}`);
        let valid = await validate_einsatzstatus(einsatzstatus_data);
        if (valid) {
          // Status eines Einsatzes aktualisieren
          const anz_update = await sql.db_einsatz_statusupdate(einsatzstatus_data);
          if (anz_update > 0) {
            if (einsatzstatus_data.waip_uuid) {
              logger.log("log", `Einsatzstatus zum Einsatz ${einsatzstatus_data.waip_uuid} aktualisiert. Anzahl: ${anz_update}.`);
            } else {
              logger.log("log", `Einsatzstatus zum Einsatz ${einsatzstatus_data.einsatznummer}  aktualisiert. Anzahl: ${anz_update}.`);
            }
          } else {
            logger.log("log", `Es wurde kein Einsatzstatus aktualisiert.`);
          }
          // true zurückgeben
          resolve(true);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren einer Einsatz-Status-Meldung. " + einsatzstatus_data);
        }
      } catch (error) {
        reject(new Error("Fehler beim speichern einer Einsatz-Status-Meldung. " + remote_addr + error));
      }
    });
  };

  const save_einsatzmittel = (einsatzmittel_data, remote_addr) => {
    return new Promise(async (resolve, reject) => {
      try {
        logger.log("debug", `Einsatzmittel von ${remote_addr} erhalten, wird jetzt verarbeitet: ${JSON.stringify(rmld_data)}`);
        let valid = await validate_einsatzmittel(einsatzmittel_data);
        if (valid) {
          // Einsatzmittel speichern
          const arr_funkrufnamen = await sql.db_einsatzmittel_update(einsatzmittel_data);
          logger.log("log", `${arr_uuid_rueckmeldungen.length} Einsatzmittel von ${remote_addr} erhalten.`);

          // Einsatzmittel verteilen
          //waip.em_verteilen_by_id(arr_funkrufnamen);

          // true zurückgeben
          resolve(true);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren eines Einsatzmittels. " + einsatzmittel_data);
        }
      } catch (error) {
        reject(new Error("Fehler beim speichern eines Einsatzmittels. " + remote_addr + error));
      }
    });
  };

  const validate_einsatz = (data) => {
    return new Promise((resolve, reject) => {
      try {
        // false wenn data NULL oder nicht definiert
        if (data === null || data === undefined) {
          resolve(false);
        }
        // wenn data string ist, diesen in json umwandeln
        if (data.constructor == String) {
          let tmp = JSON.parse(data);
          resolve(tmp);
        }
        // wenn data object ist, dann testen ob dieses JSON-Konform ist
        if (data.constructor === Object) {
          let text = JSON.stringify(data);
          if (
            /^[\],:{}\s]*$/.test(
              text
                .replace(/\\["\\\/bfnrtu]/g, "@")
                .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
                .replace(/(?:^|:|,)(?:\s*\[)+/g, "")
            )
          ) {
            let tmp = JSON.parse(text);
            resolve(tmp);
          } else {
            resolve(false);
          }
        }
        // Log
        logger.log("debug", "Validierung WAIP: " + JSON.stringify(data));
      } catch (error) {
        reject(new Error("Fehler beim Validieren einer WAIP-Einsatzmeldung " + data + error));
      }
    });
  };

  const validate_rmld = (data) => {
    return new Promise((resolve, reject) => {
      try {
        // TODO Validierung: Rückmeldung auf Plausibilität

        // Log
        logger.log("debug", "Validierung RMLD: " + JSON.stringify(data));

        resolve(true);
      } catch (error) {
        reject(new Error("Fehler beim Validieren einer Rückmeldung " + data + error));
      }
    });
  };

  const validate_einsatzmittel = (data) => {
    return new Promise((resolve, reject) => {
      try {
        // TODO Validierung: Einsatzmittel auf Plausibilität

        // Log
        logger.log("debug", "Validierung Einsatzmittel: " + JSON.stringify(data));

        resolve(true);
      } catch (error) {
        reject(new Error("Fehler beim Validieren eines Einsatzmittels " + data + error));
      }
    });
  };

  const validate_einsatzstatus = (data) => {
    return new Promise((resolve, reject) => {
      try {
        // TODO Validierung: Einsatzstatus auf Plausibilität

        // Log
        logger.log("debug", "Validierung Einsatzstatus: " + JSON.stringify(data));

        resolve(true);
      } catch (error) {
        reject(new Error("Fehler beim Validieren des Einsatzstatus " + data + error));
      }
    });
  };

  return {
    save_einsatz: save_einsatz,
    save_rmld: save_rmld,
    save_einsatzstatus: save_einsatzstatus,
    save_einsatzmittel: save_einsatzmittel,
  };
};
