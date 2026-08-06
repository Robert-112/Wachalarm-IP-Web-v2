const e = require("express");

module.exports = (io, sql, fs, logger, app_cfg) => {
  const { tts_erstellen } = require("./tts.js")(fs, logger, sql, app_cfg);
  const osrm = app_cfg.osrm.enabled ? require("./osrm.js")(app_cfg, logger) : null;
  const waip_verteilen_socket = (einsatzdaten, socket, wachen_nr, reset_timestamp) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Lokale Kopie erstellen, damit das geteilte einsatzdaten-Objekt nicht durch
        // Berechtigungs-Stripping fuer andere Sockets im selben Raum veraendert wird.
        const data = { ...einsatzdaten };

        // Berechtigungen für den Einsatz, anhand der Wachen-Berechtigung ueberpruefen
        const permissions = await sql.db_user_check_permission_for_waip(socket, data.id);

        // wenn Berechtigungen nicht passen / nicht vorhanden sind, dann Daten entfernen
        if (!permissions) {
          data.einsatznummer = "";
          data.objekt = "";
          data.objektteil = "";
          data.besonderheiten = "";
          data.strasse = "";
          data.hausnummer = "";
          data.einsatzdetails = "";
          data.wgs84_x = "";
          data.wgs84_y = "";
          // Flag setzen, dass Berechtigungen nicht ok sind
          data.permissions = false;
        } else {
          // Flag setzen, dass Berechtigungen ok sind
          data.permissions = true;
        }

        // Ablaufzeit zum Einsatz hinzufuegen, damit diese auf der Seite ausgewertet werden kann
        data.ablaufzeit = reset_timestamp;

        // pruefen ob Einsatz bereits genau so beim Client angezeigt wurde (Doppelalarmierung)
        const doppelalarm = await sql.db_einsatz_check_history(data, socket);

        if (doppelalarm) {
          // Log das Einsatz explizit nicht an Client gesendet wurde
          logger.log("waip", `Einsatz ${data.id} für Wache ${wachen_nr} nicht an Socket ${socket.id} gesendet, Doppelalarmierung.`);
          resolve(false);
        } else {
          // Einsatz-ID dem Socket zuweisen, fuer spaetere Abgleiche
          socket.data.waip_id = data.id;

          // Einsatzdaten an Client senden
          socket.emit("io.new_waip", data);
          logger.log("waip", `Einsatz ${data.id} für Wache ${wachen_nr} an ${socket.id} gesendet.`);

          // Client-Status mit Wachennummer aktualisieren
          sql.db_client_update_status(socket, data.id);

          // Sound erstellen und an Client senden
          const tts = await tts_erstellen(data, wachen_nr);
          if (tts) {
            // Sound-Link senden
            socket.emit("io.playtts", tts);
            logger.log("log", `ttsfile ${tts}`);
          }

          resolve(true);
        }
      } catch (error) {
        logger.log("error", `Fehler beim Verteilen der Waip-Einsatzdaten ${einsatzdaten.id} für einen Client ${socket.id}. ` + error);
        resolve(false);
      }
    });
  };

  const einsatz_verteilen_rooms = (waip_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        // anhand der waip_id die beteiligten Wachennummern / Socket-Räume zum Einsatz ermitteln
        const socket_rooms = await sql.db_einsatz_get_waip_rooms(waip_id);

        // waip_rooms muss größer 1 sein, da sonst nur der Standard-Raum '0' vorhanden ist
        if (socket_rooms.length == 1 && socket_rooms[0].room == "0") {
          // wenn kein Raum (keine Wache) ausser '0' zurueckgeliefert wird, dann Einsatz direkt wieder loeschen weil keine Wachen dazu hinterlegt
          logger.log("warn", `Keine Wache für den Einsatz mit der ID ${waip_id} vorhanden! Einsatz wird gelöscht!`);

          // FIXME db_einsatz_loeschen liefert die Anzahl der gelöschten Daten zurück, hier beachten
          sql.db_einsatz_loeschen(waip_id);
        } else {
          let basis_einsatzdaten = null;

          // Einsatzdaten an alle beteiligten Wachen (Websocket-Raum) verteilen
          for (const rooms of socket_rooms) {
            const wachen_nr = rooms.room;

            // Einsatzdaten passend pro Wache aus Datenbank laden
            const einsatzdaten = await sql.db_einsatz_get_for_wache(waip_id, wachen_nr);

            // Basis-Einsatzdaten (mit Koordinaten) für OSRM merken
            if (!basis_einsatzdaten && einsatzdaten) basis_einsatzdaten = einsatzdaten;

            // alles Sockets der Wache ermitteln
            const sockets = await io.of("/waip").in(wachen_nr.toString()).fetchSockets();

            // prüfen ob nach dem Aktiv-Filter noch Einsatzmittel vorhanden sind
            const keineAktivenEinsatzmittel =
              (!einsatzdaten.em_alarmiert || einsatzdaten.em_alarmiert.length === 0) &&
              (!einsatzdaten.em_weitere || einsatzdaten.em_weitere.length === 0);

            // an jeden Socket entsprechende Daten senden
            for (const socket of sockets) {
              if (keineAktivenEinsatzmittel) {
                // Standby senden, da keine Einsatzmittel aktiver Wachen vorhanden
                standby_verteilen_socket(socket);
                logger.log("waip", `Einsatz ${waip_id} für Wache ${wachen_nr} verworfen: keine Einsatzmittel aktiver Wachen, sende Standby.`);
                resolve(false);
              } else {
                // Prüfen ob für den Client die Anzeigezeit abgelaufen ist
                const reset_timestamp = await sql.db_client_get_alarm_anzeigbar(socket, einsatzdaten.id);

                if (!einsatzdaten || !reset_timestamp) {
                  // Standby senden
                  standby_verteilen_socket(socket);
                  logger.log("waip", `Kein anzuzeigender Einsatz für ${wachen_nr} vorhanden, sende keine Einsatzdaten, sondern Standby.`);
                  resolve(false);
                } else {
                  // Einsatz an den einzelnen Socket versenden
                  waip_verteilen_socket(einsatzdaten, socket, wachen_nr, reset_timestamp);
                  resolve(true);
                }
              }
            }
          }

          // OSRM-Routen asynchron berechnen und verteilen (non-blocking nach Alarmausgabe)
          if (osrm && basis_einsatzdaten) {
            osrm_routen_berechnen(waip_id, basis_einsatzdaten).catch((err) =>
              logger.log("error", `OSRM Routenberechnung für Einsatz ${waip_id} fehlgeschlagen: ${err.message}`)
            );
          }
        }
      } catch (error) {
        reject(new Error(`Fehler beim Verteilen der Waip-Einsatzdaten ${waip_id} an Socket-Räume}. ` + error));
      }
    });
  };

  const standby_verteilen_socket = (socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // die Einsatz-ID aus dem Websocket entfernen
        socket.data.waip_id = null;

        // Standby ohne Daten senden senden
        socket.emit("io.standby", null);

        // Client-Status mit Standby aktualisieren
        sql.db_client_update_status(socket, "Standby");
      } catch (error) {
        reject(new Error(`Fehler senden des Standby-Befehls für einen Client ${socket.id}. ` + error));
      }
    });
  };

  const rmld_verteilen_rooms = (obj_waip_uuid_with_rmld_uuid) => {
    return new Promise(async (resolve, reject) => {
      try {
        // alle waip-uuids durchgehen und jeweils die Rückmeldungsdaten anhand der einzelnen UUIDs im Array ermitteln und senden
        for (const key in obj_waip_uuid_with_rmld_uuid) {
          const waip_uuid = key;

          // Einsatz-ID mittels Einsatz-UUID ermitteln
          const waip_id = await sql.db_einsatz_get_waipid_by_uuid(waip_uuid);

          // anhand der waip_id die beteiligten Wachennummern / Socket-Räume in '/waip' zum Einsatz ermitteln
          // BUG hier werden die Räume anhand der Waip-Id ermittelt, das ist nicht ganz passend,
          // einzelne Websockets können aber schon einen anderen Einsatz anzeigen
          const waip_rooms = await sql.db_einsatz_get_waip_rooms(waip_id);

          // Rückmeldungen an alle beteiligten Wachen ('/waip'-Websocket-Raum) verteilen
          for (const waip_room of waip_rooms) {
            const wachen_nr = waip_room.room;

            // alle zur Wache zugehörigen Alarmmonitor-Sockets ermitteln
            const waip_sockets = await io.of("/waip").in(wachen_nr.toString()).fetchSockets();

            // bestimmte Rückmeldungen passend pro Wache aus Datenbank laden
            const rmld_waip_arr = await sql.db_rmlds_get_for_wache(wachen_nr, waip_id, obj_waip_uuid_with_rmld_uuid[waip_uuid]);

            // an jeden Socket entsprechende Daten senden
            for (const waip_socket of waip_sockets) {
              // wenn socket.data.waip_id dem aktuellen Einsatz entspricht
              if (waip_socket.data.waip_id === waip_id) {
                // Rückmeldungen an Socket versenden
                rmld_arr_verteilen_socket(rmld_waip_arr, waip_socket);
              } else {
                // Protokollieren das es nicht gesendet wurde
                logger.log("log", `Rückmeldungen an Socket ${waip_socket.id} nicht gesendet, weil dieser einen anderen oder keinen Einsatz anzeigt.`);
              }
            }
          }

          // alle zum Einsatz zugehörigen Dashboard-Sockets ermitteln
          const dbrd_sockets = await io.of("/dbrd").in(waip_uuid.toString()).fetchSockets();

          // bestimmte Rückmeldungen passend pro Dashboard aus Datenbank laden
          const rmld_dbrd_arr = await sql.db_rmlds_get_for_wache(0, waip_id, obj_waip_uuid_with_rmld_uuid[waip_uuid]);

          // an jeden Socket entsprechende Daten senden
          for (const dbrd_socket of dbrd_sockets) {
            // Rückmeldungen an Socket versenden
            rmld_arr_verteilen_socket(rmld_dbrd_arr, dbrd_socket);
          }

          resolve(true);
        }
      } catch (error) {
        reject(new Error("Fehler beim Verteilen der Rückmeldungen für einen Einsatz. " + error));
      }
    });
  };

  const rmld_arr_verteilen_socket = (rmld_arr, socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Prüfen ob Einsatz bei Socket noch angezeigt wird
        // TODO prüfen der ablaufzeit hinzufügen
        //const ablaufzeit = await sql.db_user_get_ablaufzeit(socket, einsatzdaten.id);

        // Rückmeldungen durchgehen und einzeln an Socket senden
        for (const rmld_data of rmld_arr) {
          // Lokale Kopie erstellen, damit das geteilte rmld_data-Objekt nicht durch
          // Berechtigungs-Stripping für andere Sockets im selben Raum verändert wird.
          const data = { ...rmld_data };

          // Berechtigungen für aufgerufenen Alarmmonitor überpruefen
          const permissions = await sql.db_user_check_permission_for_rmld(socket, data.wache_nr);

          // wenn Berechtigungen nicht passen / nicht vorhanden sind, dann Daten entfernen
          if (!permissions) {
            data.rmld_alias = null;
            data.rmld_address = null;
          }

          // Rueckmeldung an Socket/Client senden
          socket.emit("io.new_rmld", data);

          const logMessage1 = `Rückmeldungen an Socket ${socket.id} gesendet.`;
          logger.log("log", logMessage1);
          const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(data)}`;
          logger.log("debug", logMessage2);
        }

        resolve(true);
      } catch (error) {
        logger.log("error", `Fehler beim Verteilen einer Rückmeldung für einen Client ${socket.id}. ` + error);
        resolve(false);
      }
    });
  };

  const dbrd_verteilen_socket = (dbrd_uuid, socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Einsatzdaten laden
        const einsatzdaten = await sql.db_einsatz_get_by_uuid(dbrd_uuid);
        if (!einsatzdaten) {
          // Standby senden wenn Einsatz nicht vorhanden
          // BUG hier kein standby senden, sondern nicht vorhanden
          socket.emit("io.deleted", null);
          const logMessage = `Der angefragte Einsatz ${dbrd_uuid} ist nicht - oder nicht mehr - vorhanden!, Dashboard-Socket ${socket.id} wurde getrennt.`;
          logger.log("log", logMessage);
          sql.db_client_update_status(socket, null);
        } else {
          const permissions = await sql.db_user_check_permission_for_waip(socket, einsatzdaten.id);

          // Daten entfernen wenn kann authentifizierter Nutzer
          if (!permissions) {
            delete einsatzdaten.einsatznummer;
            delete einsatzdaten.objekt;
            delete einsatzdaten.objektteil;
            delete einsatzdaten.besonderheiten;
            delete einsatzdaten.strasse;
            delete einsatzdaten.hausnummer;
            delete einsatzdaten.einsatzdetails;
            delete einsatzdaten.wgs84_x;
            delete einsatzdaten.wgs84_y;
            // Flag setzen, dass Berechtigungen nicht ok sind
            einsatzdaten.permissions = false;
          } else {
            // Flag setzen, dass Berechtigungen ok sind
            einsatzdaten.permissions = true;
          }

          // Einsatz-ID dem Websocket zuweisen
          socket.data.waip_id = einsatzdaten.id;
          // Einsatzdaten senden
          socket.emit("io.Einsatz", einsatzdaten);
          // Rueckmeldungen verteilen
          rmld_arr_verteilen_socket(einsatzdaten.id, socket);
          // Routen senden (wenn OSRM aktiviert)
          if (osrm) routen_verteilen_socket(einsatzdaten.id, socket);
          const logMessage = `Einsatzdaten für Dashboard ${dbrd_uuid} an Socket ${socket.id} gesendet`;
          logger.log("log", logMessage);
          sql.db_client_update_status(socket, einsatzdaten.id);
        }

        // Client-Status mit Wachennummer aktualisieren
        sql.db_client_update_status(socket, dbrd_uuid.uuid);
      } catch (error) {
        reject(new Error("Fehler beim Senden der Dashboard-Daten für einen Client. " + error));
      }
    });
  };

  // Routen für einen Socket senden – wählt route_full oder route_half je nach Berechtigung
  const routen_verteilen_socket = async (waip_id, socket) => {
    try {
      const routen = sql.db_routen_get(waip_id);
      if (!routen || !routen.length) return;

      const permissions = await sql.db_user_check_permission_for_waip(socket, waip_id);

      // Routen auf Wachen der eigenen Wachennummer begrenzen (em_alarmiert-Filter).
      // Dashboard-Sockets (kein wachen_nr) und Leitstellen-Sockets (1–5) sehen alle Routen.
      const wachen_nr = socket.data.wachen_nr;
      const wachen_nr_int = wachen_nr ? parseInt(wachen_nr) : 0;
      const filterByWache = wachen_nr && wachen_nr_int !== 0 && (wachen_nr_int < 1 || wachen_nr_int > 5);

      const payload = routen
        .filter((r) => !filterByWache || String(r.nr_wache).startsWith(wachen_nr))
        .map((r) => {
          const geometry_str = permissions ? r.em_wgs84_route_full : r.em_wgs84_route_half;
          const base = { nr_wache: r.nr_wache, name_wache: r.name_wache, color: osrm.wachen_color(r.nr_wache) };
          // Keine Route vorhanden (z.B. Wache liegt im Einsatzbereich) -> nur Label an der
          // Wachen-Position anzeigen, damit die Wache trotzdem sichtbar bleibt
          if (!geometry_str) return { ...base, coords: [r.wgs84_x, r.wgs84_y] };
          return { ...base, geometry: JSON.parse(geometry_str) };
        });

      if (payload.length) socket.emit("io.routes", payload);
    } catch (err) {
      logger.log("error", `Fehler beim Senden von Routen an Socket ${socket.id}: ${err.message}`);
    }
  };

  // Routen an alle verbundenen Sockets eines Einsatzes verteilen
  const routen_verteilen_rooms = async (waip_id) => {
    try {
      const socket_rooms = await sql.db_einsatz_get_waip_rooms(waip_id);
      for (const room of socket_rooms) {
        const sockets = await io.of("/waip").in(room.room.toString()).fetchSockets();
        for (const socket of sockets) {
          if (socket.data.waip_id === waip_id) {
            routen_verteilen_socket(waip_id, socket);
          }
        }
      }

      // Dashboard-Sockets mit Routen versorgen
      const waip_uuid = sql.db_einsatz_get_uuid_by_id(waip_id);
      if (waip_uuid) {
        const dbrd_sockets = await io.of("/dbrd").in(waip_uuid).fetchSockets();
        for (const socket of dbrd_sockets) {
          routen_verteilen_socket(waip_id, socket);
        }
      }
    } catch (err) {
      logger.log("error", `Fehler beim Verteilen von Routen für Einsatz ${waip_id}: ${err.message}`);
    }
  };

  // OSRM-Routen berechnen, in DB speichern und an alle verbundenen Clients senden
  const osrm_routen_berechnen = async (waip_id, einsatzdaten) => {
    const stationen = sql.db_routen_stationen_get(waip_id);
    if (!stationen || !stationen.length) {
      logger.log("log", `OSRM: Keine alarmierten Wachen mit Koordinaten für Einsatz ${waip_id}.`);
      return;
    }

    const hat_geometry = !!einsatzdaten.geometry;
    const einsatz_hat_koordinaten = !!(einsatzdaten.wgs84_x && einsatzdaten.wgs84_y);

    for (const station of stationen) {
      try {
        // Genaue Route von Wache zum Einsatzort (nur bei vorhandenen Einsatzkoordinaten,
        // sonst würde von 0,0 aus geroutet)
        const route_full = einsatz_hat_koordinaten
          ? await osrm.get_route(
              station.wgs84_x, station.wgs84_y,
              einsatzdaten.wgs84_x, einsatzdaten.wgs84_y
            )
          : null;

        let route_half;
        if (hat_geometry) {
          if (osrm.station_inside_boundary(station.wgs84_x, station.wgs84_y, einsatzdaten.geometry)) {
            // Wache liegt im Einsatzbereich: jede Route würde den echten Einsatzort verraten.
            // Für eingeschränkte Nutzer wird deshalb gar keine Route gespeichert.
            route_half = null;
            logger.log("log", `OSRM: Wache ${station.nr_wache} liegt im Einsatzbereich – route_half nicht berechnet.`);
          } else {
            // Route zum Schwerpunkt des Bereichs, am Rand abgeschnitten
            const centroid = osrm.get_centroid(einsatzdaten.geometry);
            const route_to_centroid = await osrm.get_route(
              station.wgs84_x, station.wgs84_y,
              centroid.lat, centroid.lng
            );
            route_half = osrm.clip_route_at_boundary(route_to_centroid, einsatzdaten.geometry);
          }
        } else {
          // Kein Bereich vorhanden – half = full (kein Sicherheitsrisiko, da kein Bereich)
          route_half = route_full;
        }

        sql.db_route_speichern(waip_id, station.station_id, route_full, route_half);
        logger.log("log", `OSRM Route für Wache ${station.nr_wache} (Einsatz ${waip_id}) gespeichert.`);
      } catch (err) {
        logger.log("warn", `OSRM Route für Wache ${station.nr_wache} fehlgeschlagen: ${err.message}`);
      }
    }

    // Routen an alle aktuell verbundenen Clients senden
    await routen_verteilen_rooms(waip_id);
  };

  // TODO WAIP: Funktion um Clients remote "neuzustarten" (Seite neu laden), niedrige Prioritaet

  // Funktion die alle xxx Sekunden ausgeführt wird
  const system_cleanup = async () => {
    // alte Einsätze aus der Datenbank laden
    const alte_einsaetze = await sql.db_einsaetze_get_old();

    // wenn alte Einsäzte vorhanden sind, dann aufräumen
    if (alte_einsaetze) {
      alte_einsaetze.forEach(async (waip) => {
        // Aufräumen der alten Einsätze
        logger.log("log", `Einsatz mit der ID ${waip.id} ist veraltet. Datenbank wird aufgeräumt.`);

        // Alarmmonitore ermitteln an die ein Standby gesendet werden muss
        const rooms_to_standby = await sql.db_einsatz_get_waip_rooms(waip.id);

        // Standby an die ermittelten Alarmmonitore senden
        if (rooms_to_standby) {
          rooms_to_standby.forEach(async (room_to_standby) => {
            // für jede Wache (room_to_standby.room) die verbundenen Sockets(Clients) ermitteln und Standby senden
            const room_sockets = await io.of("/waip").in(room_to_standby.room.toString()).fetchSockets();

            // TODO hier wäre es besser, das standby an den Raum zu senden, nicht an jeden Socket

            for (const socket of room_sockets) {
              // Standby senden
              const same_id = await sql.db_client_check_waip_id(socket.id, waip.id);
              if (same_id) {
                // Einsatz-ID aus dem Websocket entfernen
                socket.data.waip_id = null;
                // Standby senden
                standby_verteilen_socket(socket);
                // Audio stoppen
                socket.emit("io.stopaudio", null);
                logger.log("log", `Standby an Alarmmonitor-Socket ${socket.id} gesendet.`);
                sql.db_client_update_status(socket, null);
              }
            }
          });
        }

        // Dashboards trennen
        // io.deletet an alle Socket senden die im Namespace /dbrd im Raum der alte_einsaetze.uuid sind
        const dbrd_sockets = await io.of("/dbrd").in(waip.uuid.toString()).fetchSockets();
        // io.deletet an dbrd_sockets senden
        dbrd_sockets.forEach((socket) => {
          socket.emit("io.deleted", null);
          logger.log("log", `Dashboard mit dem Socket ${socket.id} wurde getrennt, Einsatz gelöscht.`);
        });

        // Einsatz mit allen zugehörigen Daten löschen
        sql.db_einsatz_loeschen(waip.id);
        logger.log("log", `Einsatz-Daten zu Einsatz ${waip.id} gelöscht.`);
      });
    }

    // alle User-Einstellungen prüfen und ggf. Standby senden, z.B. wenn Reset_Timestamp erreicht ist
    const socket_ids = await sql.db_socket_get_all_to_standby();
    if (socket_ids) {
      for (const row of socket_ids) {
        const sockets = await io.of("/waip").in(row.socket_id).fetchSockets();
        for (const socket of sockets) {
          // Einsatz-ID aus dem Websocket entfernen
          socket.data.waip_id = null;
          // Standby senden
          standby_verteilen_socket(socket);
          // Audio stoppen
          socket.emit("io.stopaudio", null);
          logger.log("log", `Standby an Alarmmonitor-Socket ${socket.id} gesendet`);
          sql.db_client_update_status(socket, null);
        }
      }
    }

    // loeschen alter Sounddaten nach Alter
    const retentionMinutes = app_cfg.global.time_to_delete_waip;
    const retentionMs = retentionMinutes * 60 * 1000;
    const nowTs = Date.now();
    fs.readdirSync(process.cwd() + app_cfg.global.soundpath).forEach((file) => {
      try {
        if (file.endsWith(".mp3") && !file.endsWith("_tmp.mp3") && !file.startsWith("bell")) {
          const fullPath = process.cwd() + app_cfg.global.soundpath + file;
          const stats = fs.statSync(fullPath);
          const age = nowTs - stats.mtimeMs;
          if (age > retentionMs) {
            fs.unlinkSync(fullPath);
            logger.log("log", `Veraltete Sound-Datei ${file} (> ${retentionMinutes}min) wurde gelöscht.`);
          }
        }
      } catch (error) {
        logger.log("error", `Fehler beim Löschen einer Sound-Datei ${file}: ${error}`);
      }
    });
  };

  // System alle xxx Sekunden aufräumen
  setInterval(system_cleanup, app_cfg.global.system_cleanup_time);

  return {
    waip_verteilen_socket: waip_verteilen_socket,
    einsatz_verteilen_rooms: einsatz_verteilen_rooms,
    standby_verteilen_socket: standby_verteilen_socket,
    rmld_arr_verteilen_socket: rmld_arr_verteilen_socket,
    rmld_verteilen_rooms: rmld_verteilen_rooms,
    dbrd_verteilen_socket: dbrd_verteilen_socket,
    routen_verteilen_socket: routen_verteilen_socket,
  };
};
