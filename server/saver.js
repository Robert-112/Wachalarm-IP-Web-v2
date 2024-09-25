module.exports = (app_cfg, sql, waip, uuidv4, logger) => {

  // Module laden
  const turf = require("@turf/turf");

  // Variablen festlegen
  let uuid_pattern = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "i");

  // Speichern eines neuen Einsatzes
  const save_new_einsatz = (waip_data, remote_addr, app_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        let waip_json = await validate_waip(waip_data);
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
          // nicht erwuenschte Daten ggf. entfernen (Datenschutzoption)
          let data_filtered = await filter_api_data(waip_json, remote_addr);

          // Einsatz speichern
          waip.waip_speichern(data_filtered);
          logger.log("log", `Neuer Einsatz von ${remote_addr} wird jetzt verarbeitet: ${JSON.stringify(data_filtered)}`);

          // true zurückgeben
          resolve(true);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren eines Einsatzes. " + waip_data);
        }
      } catch (error) {
        reject(new Error("Fehler beim speichern eines neuen Einsatzes (WAIP-JSON). " + remote_addr + " " + error));
      }
    });
  };

  const save_new_rmld = (rmld_data, remote_addr, app_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        let valid = await validate_rmld(rmld_data);
        if (valid) {
          // Rückmeldung speichern und verteilen
          await sql.db_rmld_save(rmld_data);
          logger.log("log", `Rückmeldung von ${remote_addr} wird jetzt verarbeitet: ${JSON.stringify(rmld_data)}`);

          // Rückmeldung verteilen
          waip.rmld_verteilen_by_uuid(rmld_data.waip_uuid, rmld_data.rmld_uuid);

          // true zurückgeben
          resolve(true);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren einer Rückmeldung. " + rmld_data);
        }
      } catch (error) {
        new Error("Fehler beim speichern einer neuen Rückmeldung (RMLD). " + remote_addr + error);
      }
    });
  };

  const filter_api_data = (data, remote_ip) => {
    return new Promise((resolve, reject) => {
      try {
        if (app_cfg.filter.enabled) {
          // Filter nur anwenden wenn Einsatzdaten von bestimmten IP-Adressen kommen
          if (app_cfg.filter.on_message_from.includes(remote_ip)) {
            let data_filtered = data;
            // Schleife definieren
            function loop_done(data_filtered) {
              resolve(data_filtered);
            }
            let itemsProcessed = 0;
            // nicht gewollte Daten entfernen
            app_cfg.filter.remove_data.forEach(function (item, index, array) {
              data_filtered.einsatzdaten[item] = "";
              data_filtered.ortsdaten[item] = "";
              // Schleife erhoehen
              itemsProcessed++;
              if (itemsProcessed === array.length) {
                // Schleife beenden
                loop_done(data_filtered);
              }
            });
          } else {
            resolve(data);
          }
        } else {
          resolve(data);
        }
      } catch (error) {
        reject(new Error("Fehler beim Filtern der übergebenen Daten. " + error));
      }
    });
  };

  const validate_waip = (data) => {
    return new Promise((resolve, reject) => {
      /* Beispiel eines Einsatzes
      {
        "einsatzdaten": {
          "eisnatznummer": "753",
          "alarmzeit": "01.01.19&01:00",
          "art": "Rettungseinsatz",
          "stichwort": "N4:Trauma",
          "sondersignal": 1,
          "besonderheiten": "DEMO Wachalarm-IP-Web - Verkehrsunfall",
          "einsatzdetails": "Feuerwehrplan 12 A",
          "uuid": "8ac19295-8efa-4a5e-bb80-227a6e419789"
        },
        "ortsdaten": {
          "ort": "Luckau",
          "ortsteil": "",
          "strasse": "Golzener Straße 21",
          "objekt": "",
          "objektnr": "-1",
          "objektart": "",
          "wachfolge": "611202",
          "wgs84_x": "51.8556",
          "wgs84_y": "13.7039"
        },
        "alarmdaten": [
          {
            "typ": "ALARM",
            "netzadresse": "",
            "wachenname": "LDS RW Luckau",
            "einsatzmittel": "AK LDS 12/82-01",
            "zeit_alarmierung": "15:47",
            "zeit_ausgerueckt": ""
          },
          {
            "typ": "ALARM",
            "netzadresse": "",
            "wachenname": "LDS RW Luckau",
            "einsatzmittel": "AK LDS 12/83-02",
            "zeit_alarmierung": "15:47",
            "zeit_ausgerueckt": ""
          }
        ]
      }
      */
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

  return {
    save_new_einsatz: save_new_einsatz,
    save_new_rmld: save_new_rmld,
  };
};
