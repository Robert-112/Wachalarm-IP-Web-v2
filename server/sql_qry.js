module.exports = function (db, app_cfg) {
  // Module laden
  const { v4: uuidv4 } = require("uuid");
  const { v5: uuidv5 } = require("uuid");
  const custom_namespace = app_cfg.global.custom_namespace;

  // H3-Modul für Koordinaten-Anonymisierung laden und Variablen setzen
  const h3 = require("h3-js");
  const h3_res_mission = 7;
  const h3_res_resource = 8;

  // Variable um zu erkennen, ob eine UUID-Syntax korrekt ist
  const uuid_pattern = new RegExp(
    "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    "i"
  );

  // Hilfsfunktion um Datum&Zeit (29.12.23&20:06) in SQLite-Zeit umzuwandeln
  const Datetime_to_SQLiteDate = (s) => {
    if (s) {
      let d = new Date();
      let simpletime = new RegExp("/dd:dd/i");
      let simpledate = new RegExp("/dd.dd.dd&dd:dd/i");
      if (!simpletime.test(s) && !simpledate.test(s)) {
        return null;
      }
      if (simpletime.test(s)) {
        let hour = s.substring(0, 2);
        let min = s.substring(3, 5);
        d.setHours(hour);
        d.setMinutes(min);
        return d.toISOString();
      }
      if (simpledate.test(s)) {
        let day = s.substring(0, 2);
        let month = s.substring(3, 5);
        let year =
          d.getFullYear().toString().substring(0, 2) + s.substring(6, 8);
        let hour = s.substring(9, 11);
        let min = s.substring(12, 14);
        d.setDate(day);
        d.setMonth(month);
        d.setFullYear;
        d.setHours(hour);
        d.setMinutes(min);
        return d.toISOString();
      } else {
        return null;
      }
    } else {
      return null;
    }
  };

  // SQL-Abfragen

  // Einsatz inkl. Einsatzmitteln in Datenbank speichern
  const db_einsatz_speichern = (content) => {
    return new Promise(async (resolve, reject) => {
      // zunaechst bestehende UUID ermitteln oder neu erzeugen
      try {
        let mission_uuid = await db_get_mission_uuid_by_enr(
          content.einsatzdaten.nummer
        );
        if (mission_uuid.uuid) {
          // wenn ein Einsatz mit UUID schon vorhanden ist, dann diese ersetzen / überschreiben
          content.einsatzdaten.uuid = mission_uuid.uuid;
        } else {
          // uuid erzeugen und zuweisen falls nicht bereits in JSON vorhanden, oder falls keine korrekte uuid
          if (
            !content.einsatzdaten.uuid ||
            !uuid_pattern.test(content.einsatzdaten.uuid)
          ) {
            content.einsatzdaten.uuid = uuidv4();
          }
        }
      } catch (error) {
        // wenn noch keine Einsatz-UUID vorhanden oder keine korrekte UUID, dann eine UUID erzeugen
        if (
          !content.einsatzdaten.uuid ||
          !uuid_pattern.test(content.einsatzdaten.uuid)
        ) {
          content.einsatzdaten.uuid = uuidv4();
        }
      }

      // H3-ID für Ortsdaten erstellen
      content.ortsdaten.geo_h3_index = h3.latLngToCell(
        content.ortsdaten.wgs84_y,
        content.ortsdaten.wgs84_x,
        h3_res_mission
      );

      try {
        // Einsatzdaten verarbeiten/speichern
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO waip_einsaetze (
            id, uuid, els_einsatz_nummer, els_zeitstempel, alarmzeit, einsatzart, stichwort, sondersignal, besonderheiten, 
            landkreis, ort, ortsteil, ortslage, strasse, hausnummer, ort_sonstiges, objekt, objektteil, objektnummer, objektart, 
            wachenfolge, wgs84_x, wgs84_y, geo_h3_index
          ) VALUES (
            (SELECT ID FROM waip_einsaetze WHERE els_einsatz_nummer LIKE ?),
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `);

        const info = stmt.run(
          content.einsatzdaten.nummer,
          content.einsatzdaten.uuid,
          content.einsatzdaten.nummer,
          Datetime_to_SQLiteDate(content.einsatzdaten.alarmzeit),
          content.einsatzdaten.alarmzeit,
          content.einsatzdaten.art,
          content.einsatzdaten.stichwort,
          content.einsatzdaten.sondersignal,
          content.einsatzdaten.besonderheiten,
          content.ortsdaten.landkreis,
          content.ortsdaten.ort,
          content.ortsdaten.ortsteil,
          content.ortsdaten.ortslage,
          content.ortsdaten.strasse,
          content.ortsdaten.hausnummer,
          content.ortsdaten.ort_sonstiges,
          content.ortsdaten.objekt,
          content.ortsdaten.objektteil,
          content.ortsdaten.objektnr,
          content.ortsdaten.objektart,
          content.ortsdaten.wachfolge,
          content.ortsdaten.wgs84_x,
          content.ortsdaten.wgs84_y,
          content.ortsdaten.geo_h3_index
        );

        // anschließend die zugehörigen Einsatzmittel per Schliefe in DB speichern
        let itemsProcessed = 0;

        // letzte Einsatz-ID ermitteln
        let id = info.lastInsertRowid;

        // Abschluss der Schleife definieren
        const loop_done = (waip_id) => {
          resolve(waip_id);
        };

        if (content.alarmdaten === undefined) {
          //wenn keine Alarmdaten hinterlegt sind, loop_done direkt aufrufen
          loop_done(id);
        } else {
          // jedes einzelne Einsatzmittel und jede Alarmierung zum Einsatz speichern
          content.alarmdaten.forEach((item, index, array) => {
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO waip_einsatzmittel (
                id, 
                em_waip_einsaetze_id, 
                em_station_id, 
                (SELECT ID FROM waip_wachen WHERE name_wache LIKE ?)
                em_station_name, 
                em_funkrufname, 
                em_zeitstempel_alarm
              ) VALUES (
                (SELECT ID FROM einsatzmittel WHERE em_funkrufname LIKE ?),
                ?, ?, ?, ?, ?, ?);
            `);

            stmt.run(
              item.wachenname,
              item.einsatzmittel,
              id,
              item.wachenname,
              item.einsatzmittel,
              Datetime_to_SQLiteDate(item.zeit_a)
            );

            // Schleife erhoehen
            itemsProcessed++;

            // Schleife beenden
            if (itemsProcessed === array.length) {
              loop_done(id);
            }
          });
        }
      } catch (error) {
        reject(
          new Error("Fehler beim Speichern der Einsatzgrunddaten. " + error)
        );
      }
    });
  };

  // letzten vorhanden Einsatz zu einer Wache bei neuer Socket-Verbindung abfragen
  const db_einsatz_ermitteln = (wachen_id, socket) => {
    return new Promise((resolve, reject) => {
      try {
        let select_reset_counter;
        let user_id = socket.request.user.id;
        let dts = app_cfg.global.default_time_for_standby;

        // wenn Wachen-ID 0 ist, dann % für SQL-Abfrage setzen
        if (parseInt(wachen_id) == 0) {
          wachen_id = "%";
        }

        // wenn user_id keine Zahl ist, dann default_time_for_standby setzen
        if (isNaN(user_id)) {
          select_reset_counter = dts;
        } else {
          // wenn user_id vorhanden ist, dann Abfrage so anpassen, dass höchstmögliche Ablaufzeit verwendet wird
          select_reset_counter =
            "(SELECT COALESCE(MAX(reset_counter), " +
            dts +
            ") reset_counter FROM waip_user_config WHERE user_id = " +
            user_id +
            ")";
        }

        // Einsätze für die gewählte Wachen-ID abfragen und zudem die Ablaufzeit beachten
        const stmt = db.prepare(
          `
          SELECT waip_einsaetze_ID FROM
          (
            SELECT em.em_waip_einsaetze_id, we.zeitstempel FROM waip_einsatzmittel em
            LEFT JOIN waip_wachen wa ON wa.id = em.em_station_id
            LEFT JOIN waip_einsaetze we ON we.id = em.em_waip_einsaetze_id
            WHERE wa.nr_wache LIKE ? || \'%\'
            GROUP BY em.em_waip_einsaetze_id
            ORDER BY em.em_waip_einsaetze_id DESC
          )
          WHERE DATETIME(zeitstempel, \'+\' || ` +
            select_reset_counter +
            ` || \' minutes\')
            > DATETIME(\'now\', \'localtime\');
        `
        );
        let rows = stmt.all(wachen_id);
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen der Einsätze für Wachen-ID " +
              wachen_id +
              " (Socket-User-ID: " +
              user_id +
              "). " +
              error
          )
        );
      }
    });
  };

  // Überprüfung ob ein Einsatz mit dieser UUID vorhanden ist
  const db_einsatz_check_uuid = (uuid) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT uuid FROM waip_einsaetze WHERE uuid LIKE ? ;
        `);
        let row = stmt.get(uuid);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Prüfen der UUID " +
              uuid +
              " für einen Einsatz. " +
              error
          )
        );
      }
    });
  };

  // Prüfen ob Wachalarm bereits in dieser Form an diesen Socket gesendet wurde (Doppelalarmierung vermeiden)
  const db_einsatz_check_history = (waip_id, einsatzdaten, socket_id) => {
    return new Promise((resolve, reject) => {
      try {
        // FIXME: Objekt missiondata sollte eigentlich nicht notwendig sein, testen!
        // neues Objekt mit Einsatzdaten erstellen
        // let missiondata = Object.assign({}, einsatzdaten);

        // Einsatzdaten in kurze UUID-Strings umwandeln, diese UUIDs werden dann verglichen
        let uuid_em_alarmiert = uuidv5(
          JSON.stringify(einsatzdaten.em_alarmiert),
          custom_namespace
        );
        delete einsatzdaten.em_alarmiert;
        let uuid_em_weitere = uuidv5(
          JSON.stringify(einsatzdaten.em_weitere),
          custom_namespace
        );
        delete einsatzdaten.em_weitere;
        delete einsatzdaten.zeitstempel;
        delete einsatzdaten.ablaufzeit;
        delete einsatzdaten.wgs84_x;
        delete einsatzdaten.wgs84_y;
        delete einsatzdaten.wgs84_area;
        let uuid_einsatzdaten = uuidv5(
          JSON.stringify(einsatzdaten),
          custom_namespace
        );

        // Abfrage ob zu Socket und Waip-ID bereits History-Daten hinterlegt sind
        const stmt = db.prepare(`
          SELECT * FROM waip_history 
          WHERE waip_uuid LIKE (
            SELECT uuid FROM waip_einsaetze WHERE id = ?
          ) AND socket_id LIKE ? ;
        `);
        let row = stmt.get(waip_id, socket_id);

        // neu speichern oder aktualisieren
        if (row === undefined) {
          // wenn keine History-Daten hinterlegt sind, diese speichern
          const stmt = db.prepare(`
            INSERT INTO waip_history (
              waip_uuid, socket_id, uuid_einsatz_grunddaten, uuid_em_alarmiert, uuid_em_weitere
            ) VALUES (
              (SELECT uuid FROM waip_einsaetze WHERE id = ?),
              ?, ?, ?, ?
            );  
          `);
          const info = stmt.run(
            waip_id,
            socket_id,
            uuid_einsatzdaten,
            uuid_em_alarmiert,
            uuid_em_weitere
          );

          // Check-History = false
          resolve(info.changes);
        } else {
          // History mit aktuellen Daten aktualisieren
          const stmt = db.prepare(`
            UPDATE waip_history SET 
              uuid_einsatz_grunddaten = ?,
              uuid_em_alarmiert = ?,
              uuid_em_weitere = ?
            WHERE 
              waip_uuid LIKE (
                SELECT uuid FROM waip_einsaetze WHERE id = ?
              ) AND 
              socket_id LIKE ? ;
          `);
          const info = stmt.run(
            uuid_einsatzdaten,
            uuid_em_alarmiert,
            uuid_em_weitere,
            waip_id,
            socket_id
          );

          resolve(info.changes);
        }
      } catch (error) {
        reject(new Error("Fehler beim Prüfen der Einsatz-Historie. " + error));
      }
    });
  };

  // Einsatzdaten entsprechend der WAIP-ID zusammentragen
  const db_einsatz_get_by_waipid = (waip_id, wachen_nr, user_id) => {
    return new Promise((resolve, reject) => {
      try {
        // falls waip_id oder wachen_nur keine zahlen sind, Abbruch
        if (isNaN(waip_id) || isNaN(wachen_nr)) {
          resolve(null);
        } else {
          let len = wachen_nr.toString().length;
          // TODO hier auch andere Wachennummern berücksichtigen (z.B. 521201b)
          // wachen_nr muss 2, 4 oder 6 Zeichen lang sein
          if (
            parseInt(wachen_nr) != 0 &&
            len != 2 &&
            len != 4 &&
            len != 6 &&
            len == null
          ) {
            resolve(null);
          } else {
            // wenn wachen_nr 0, dann % fuer Abfrage festlegen
            if (parseInt(wachen_nr) == 0) {
              wachen_nr = "%";
            }

            // wenn keine user_id, dann Default-Anzeige-Zeit setzen
            if (isNaN(user_id)) {
              user_id = app_cfg.global.default_time_for_standby;
            }

            // FIXME: zentrale Abfrage zur Ausgabe der Alarmdaten wurde erneuert, asynchrone Rückgabe, Verweise und Verwendung prüfen!
            const stmt = db.prepare(`
              SELECT
                e.id,
                e.uuid,
                DATETIME(e.zeitstempel) zeitstempel,
                DATETIME(e.zeitstempel,	'+' || (
                  SELECT COALESCE(MAX(reset_counter), ?) reset_counter FROM waip_user_config WHERE user_id = ?
                ) || ' minutes') ablaufzeit,
                e.einsatzart, e.stichwort, e.sondersignal, e.objekt, e.ort, e.ortsteil, e.strasse, e.hausnummer
                e.besonderheiten, e.wgs84_x, e.wgs84_y, e.geo_h3_index
              FROM waip_einsaetze e
              WHERE e.id LIKE ?
              ORDER BY e.id DESC LIMIT 1;
            `);

            let einsatzdaten = stmt.get(
              app_cfg.global.default_time_for_standby,
              user_id,
              waip_id
            );

            if (einsatzdaten === undefined) {
              resolve(null);
            } else {
              // Abfrage der alarmierten Einsatzmittel der Wache
              const stmt1 = db.prepare(`
                SELECT 
                  em_funkrufname AS 'name',
                  em_zeitstempel_alarm AS 'zeit'
                FROM waip_einsatzmittel
                WHERE 
                  em_waip_einsaetze_id = ? 
                  AND em_station_id IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE ? || \'%\');
              `);
              // alarmierte Einsatzmittel den Einsatzdaten zuordnen
              einsatzdaten.em_alarmiert = stmt1.all(waip_id, wachen_nr);

              // Abfrage der weiteren Einsatzmittel zum Einsatz
              const stmt2 = db.prepare(`
                SELECT 
                  em_funkrufname AS 'name',
                  em_zeitstempel_alarm AS 'zeit'
                FROM waip_einsatzmittel
                WHERE 
                  em_waip_einsaetze_id = ? 
                  AND (em_station_id NOT IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE ? || \'%\') OR em_station_id IS NULL);
              `);
              // weitere Einsatzmittel den Einsatzdaten zuordnen
              einsatzdaten.em_weitere = stmt2.all(waip_id, wachen_nr);

              // Einsatzdaten zurückgeben
              resolve(einsatzdaten);
            }
          }
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Zusammenstellen der Einsatzdaten für WAIP-ID: " +
              waip_id +
              ". " +
              error
          )
        );
      }
    });
  };

  // Einsatzdaten über die UUID zusammentragen
  const db_einsatz_get_by_uuid = (waip_uuid) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT e.id, e.uuid, e.zeitstempel, e.einsatzart, e.stichwort, e.sondersignal, e.objekt, 
            e.ort, e.ortsteil, e.strasse, e.hausnummer, e.besonderheiten,
            e.wgs84_x, e.wgs84_y, e.geo_h3_index 
          FROM waip_einsaetze e 
          WHERE e.uuid LIKE ?;
        `);
        let einsatzdaten = stmt.get(waip_uuid);

        if (einsatzdaten === undefined) {
          resolve(null);
        } else {
          // Einsatzmittel zum Einsatz finden
          const stmt1 = db.prepare(`
            SELECT 
              e.einsatzmittel, e.status, e.wachenname 
            FROM waip_einsatzmittel e 
            WHERE e.waip_einsaetze_id = ?;
          `);
          // Einsatzmittel den Einsatzdaten hinzufügen
          einsatzdaten.einsatzmittel = stmt1.all(einsatzdaten.id);

          // Wachen zum Einsatz finden und hinzufuegen
          const stmt2 = db.prepare(`
            SELECT DISTINCT 
              e.waip_wachen_ID, e.wachenname 
            FROM waip_einsatzmittel e 
            WHERE e.waip_einsaetze_id = ?;
          `);
          einsatzdaten.wachen = stmt2.all(einsatzdaten.id);

          // Einsatzdaten zurückgeben
          resolve(einsatzdaten);
        }
      } catch (error) {
        reject(
          new Error("Fehler ermitteln eines Einsatzes über die UUID. " + error)
        );
      }
    });
  };

  // mit Einsatznummer die UUID eines Einsatzes finden
  const db_einsatz_get_uuid_by_enr = (einsatz_nr) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT uuid
          FROM waip_einsaetze 
          WHERE els_einsatz_nummer LIKE ?;
        `);
        let row = stmt.get(einsatz_nr);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row.uuid);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen der UUID eines Einsatzes mit der Einsatznummer " +
              einsatz_nr +
              error
          )
        );
      }
    });
  };

  // mit UUID die ID eines Einsatzes finden
  const db_einsatz_get_waipid_by_uuid = (waip_uuid) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id 
          FROM waip_einsaetze 
          WHERE uuid LIKE ?;
        `);
        let row = stmt.get(waip_uuid);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row.id);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen der ID eines Einsatzes mit der UUID " +
              waip_uuid +
              error
          )
        );
      }
    });
  };

  // alle aktivieren Einsaetze finden
  const db_einsatz_get_active = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 
            we.uuid, we.einsatzart, we.stichwort, we.ort, we.ortsteil, we.geo_h3_index,
            GROUP_CONCAT(DISTINCT SUBSTR( wa.nr_wache, 0, 3 )) a,
            GROUP_CONCAT(DISTINCT SUBSTR( wa.nr_wache, 0, 5 )) b,
            GROUP_CONCAT(DISTINCT wa.nr_wache) c
          FROM waip_einsaetze we
          LEFT JOIN waip_einsatzmittel em ON em.em_waip_einsaetze_id = we.id
          LEFT JOIN waip_wachen wa ON wa.id = em.em_station_id
          GROUP BY we.id
          ORDER BY we.einsatzart, we.stichwort;
        `);
        let rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error("Fehler beim Abfragen aller aktiven Einsätze. " + error)
        );
      }
    });
  };

  // alle potenziellen Socket-Rooms für einen Einsatz finden
  const db_einsatz_get_rooms = (waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT '0' room
          UNION ALL
          SELECT w.nr_kreis room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.waip_einsaetze_ID = ? GROUP BY w.nr_kreis
          UNION ALL
          SELECT w.nr_kreis || w.nr_traeger room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.waip_einsaetze_ID = ? GROUP BY w.nr_kreis || w.nr_traeger
          UNION ALL
          SELECT w.nr_wache room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.waip_einsaetze_ID = ? GROUP BY w.nr_wache;
        `);
        let rows = stmt.all(waip_id);
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen Socket-IO-Räume für Einsatz " +
              waip_id +
              ". " +
              error
          )
        );
      }
    });
  };

  // veraltete Einsätze finden
  const db_einsatz_get_old = (ablauf_minuten) => {
    // BUG '-?' in Abfrage könnte falsch sein, ggf. durch '+ ablauf_minuten +' ersetzen
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, uuid, els_einsatz_nummer 
          FROM waip_einsaetze 
          WHERE zeitstempel <= datetime('now', 'localtime', '-? minutes');
        `);
        let rows = stmt.all(waip_uuid);
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen der zu löschender Einsätze welche älter als " +
              ablauf_minuten +
              " Minuten sind. " +
              error
          )
        );
      }
    });
  };

  // Einsatzdaten löschen
  const db_einsatz_loeschen = (einsatz_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt1 = db.prepare(`
          DELETE FROM waip_history 
          WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE id = ?);
        `);
        stmt1.run(einsatz_id);
        const stmt2 = db.prepare(`
          DELETE FROM waip_einsaetze WHERE id = ?;
        `);
        const info = stmt2.run(einsatz_id);
        // Anzahl der gelöschten Einsätze zurückgeben
        resolve(info.changes);
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Löschen der Daten zum Einsatz mit der ID " +
              einsatz_id +
              ". " +
              error
          )
        );
      }
    });
  };

  // alle im System verfügbaren Wachen/Alarmmonitore abfragen
  const db_wache_get_all = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 'wache' typ, nr_wache nr, name_wache name 
          FROM waip_wachen 
          WHERE nr_wache is not '0'
          UNION ALL
          SELECT 'traeger' typ, nr_kreis || nr_traeger nr, name_traeger name 
          FROM waip_wachen 
          WHERE nr_kreis is not '0' 
          GROUP BY nr_traeger 
          UNION ALL
          SELECT 'kreis' typ, nr_kreis nr, name_kreis name 
          FROM waip_wachen 
          GROUP BY name_kreis 
          ORDER BY typ, name;
        `);
        let rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen der verfügbaren Wachen / Alarmmonitore. " +
              error
          )
        );
      }
    });
  };

  // Prüffunktion um zu erkennen ob wachen_nr valide ist
  const db_wache_vorhanden = (wachen_nr) => {
    return new Promise((resolve, reject) => {
      try {
        // wachen_nr muss eine Zahl sein, sonst nicht valide
        if (isNaN(wachen_nr)) {
          resolve(null);
        } else {
          // wenn wachen_nr eine Zahl ist, dann prüfen ob die Länge valide ist
          let len = wachen_nr.toString().length;
          // wachen_nr muss 2, 4 oder 6 Zeichen lang sein
          if (parseInt(wachen_nr) != 0 && len != 2 && len != 4 && len != 6) {
            // Fehler: Wachennummer nicht plausibel.
            resolve(null);
          } else {
            // wachen_nr plausibel, jetzt je nach Länge passende SQL-Anweisung ausführen
            if (parseInt(wachen_nr) == 0) {
              const stmt = db.prepare(`
                SELECT '1' length, nr_wache nr, name_wache name 
                FROM waip_wachen 
                WHERE nr_wache LIKE ?;
              `);
              let row = stmt.get(wachen_nr);
              if (row === undefined) {
                resolve(null);
              } else {
                resolve(row.id);
              }
            }
            if (len == 2) {
              const stmt = db.prepare(`
                SELECT '2' length, nr_kreis nr, name_kreis name 
                FROM waip_wachen 
                WHERE nr_kreis LIKE SUBSTR(?,-2, 2) 
                GROUP BY name_kreis LIMIT 1;
              `);
              let row = stmt.get(wachen_nr);
              if (row === undefined) {
                resolve(null);
              } else {
                resolve(row.id);
              }
            }
            if (len == 4) {
              const stmt = db.prepare(`
                SELECT '4' length, nr_kreis || nr_traeger nr, name_traeger name 
                FROM waip_wachen 
                WHERE nr_kreis LIKE SUBSTR(?,-4, 2) 
                  AND nr_traeger LIKE SUBSTR(?,-2, 2) 
                GROUP BY name_traeger LIMIT 1;
              `);
              let row = stmt.get(wachen_nr, wachen_nr);
              if (row === undefined) {
                resolve(null);
              } else {
                resolve(row.id);
              }
            }
            if (len == 6) {
              const stmt = db.prepare(`
                SELECT '6' length, nr_wache nr, name_wache name 
                FROM waip_wachen 
                WHERE nr_wache LIKE ?;
              `);
              let row = stmt.get(wachen_nr);
              if (row === undefined) {
                resolve(null);
              } else {
                resolve(row.id);
              }
            }
          }
        }
        const stmt = db.prepare(``);
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Überprüfen der Wachennummer " +
              wachen_nr +
              ". " +
              error
          )
        );
      }
    });
  };

  // Einsatzmittel in gesprochenen Rufnamen umwandeln
  const db_tts_einsatzmittel = (funkrufname) => {
    return new Promise((resolve, reject) => {
      try {
        // normierte Schreibweise "xx xx 00/00-00" prüfen
        let normung = new RegExp("/(dd-dd)/g");
        let funkrufnummern = funkrufname.match(normung);
        if (funkrufnummern) {
          // Einsatzmitteltyp ermitteln
          let typ = funkrufnummern.toString().substring(0, 2);
          // Einsatzmittel-Nr ermitteln
          let nr = funkrufnummern.toString().slice(4);
          nr = nr.toString().replace(/^0+/, "");
          // hinterlegte Ersetzungen finden
          const stmt = db.prepare(`
            SELECT rp_output name 
            FROM waip_replace 
            WHERE rp_typ = 'einsatzmittel' AND rp_input = ?;
          `);
          let row = stmt.get(typ);
          if (row === undefined) {
            resolve(funkrufname);
          } else {
            resolve(row.name + " " + nr);
          }
          // Funkkenner des Einsatzmittels in gesprochen Text umwandeln
        } else {
          resolve(funkrufname);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Übersetzen des Funkrufnamens " +
              funkrufname +
              " für Text-to-Speech. " +
              error
          )
        );
      }
    });
  };

  // Client-Status aktualisieren / speichern
  const db_client_update_status = (socket, client_status) => {
    return new Promise((resolve, reject) => {
      try {
        let user_name = socket.request.user.user;
        let user_permissions = socket.request.user.permissions;
        let user_agent = socket.request.headers["user-agent"];
        let client_ip =
          socket.handshake.headers["x-real-ip"] ||
          socket.handshake.headers["x-forwarded-for"] ||
          socket.request.connection.remoteAddress;
        let reset_timestamp = socket.request.user.reset_counter;
        // Standby wenn Client-Status keine Nummer oder Null
        if (isNaN(client_status) || client_status == null) {
          client_status = "Standby";
        }
        // wenn User-Name nicht bekannt
        if (user_name === undefined) {
          user_name = "";
        }
        // wenn User-Berechtigung nicht bekannt
        if (user_permissions === undefined) {
          user_permissions = "";
        }
        // wenn Anzeigezeit nicht bekannt, Standard aus App-Cfg setzen
        if (reset_timestamp === undefined) {
          reset_timestamp = app_cfg.global.default_time_for_standby;
        } else if (reset_timestamp == null) {
          reset_timestamp = app_cfg.global.default_time_for_standby;
        }
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO waip_clients (
            id, 
            socket_id, 
            client_ip, 
            room_name, 
            client_status, 
            user_name, 
            user_permissions, 
            user_agent, 
            reset_timestamp 
          ) VALUES (
            (SELECT id FROM waip_clients WHERE socket_id = ?),
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            (SELECT DATETIME(zeitstempel, \'+ ? minutes\') FROM waip_einsaetze WHERE id = ?)
          );        
        `);
        const info = stmt.run(
          socket.id,
          socket.id,
          client_ip,
          socket.rooms[Object.keys(socket.rooms)[0]],
          client_status,
          user_name,
          user_permissions,
          user_agent,
          reset_timestamp,
          client_status
        );
        resolve(info.changes);
      } catch (error) {
        reject(
          new Error(
            "Fehler bei Aktualisierung des Clientstatus. Status:" +
              client_status +
              ", Socket: " +
              socket +
              error
          )
        );
      }
    });
  };

  // Verbunden Clients ermitteln
  const db_client_get_connected = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_clients;
        `);
        let rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error("Fehler beim abfragen der verbundenen Clients:" + error)
        );
      }
    });
  };

  // Client aus Datenbank entfernen
  const db_client_delete = (socket) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          DELETE FROM waip_clients WHERE socket_id = ?
        `);
        const info = stmt.run(socket.id);
        resolve(info.changes);
      } catch (error) {
        reject(
          new Error("Fehler beim löschen eines Clients. " + socket + error)
        );
      }
    });
  };

  // Pruefen ob für einen Client ein Einsatz vorhanden ist
  const db_client_check_waip_id = (socket_id, waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT client_status id FROm waip_clients WHERE socket_id LIKE ?;
        `);
        let row = stmt.get(socket_id);
        if (row === undefined) {
          resolve(null);
        } else {
          if (row.id == waip_id) {
            resolve(row);
          } else {
            resolve(null);
          }
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler bei Einsatzprüfung für einen Client. " +
              socket_id +
              waip_id +
              error
          )
        );
      }
    });
  };

  // Daten in Protokollieren und Log begrenzen
  const db_log = (typ, text) => {
    return new Promise((resolve, reject) => {
      try {
        let do_log = true;
        // Debug Eintraege nur bei Development speichern
        let debug_regex = new RegExp("debug", "gi");
        if (typ.match(debug_regex)) {
          do_log = app_cfg.global.development;
        }
        if (do_log) {
          // Log-Eintrag schreiben
          const stmt1 = db.prepare(`
            INSERT INTO waip_log (
              log_typ, 
              log_text
            ) VALUES (
              ?,
              ?
            );
          `);
          stmt1.run(typ, text);

          // Log begrenzen um Speicherplatz in der DB zu begrenzen
          const stmt2 = db.prepare(`
            DELETE FROM waip_log WHERE id IN
            (
              SELECT id FROM waip_log ORDER BY id DESC LIMIT ?, 100
            );
          `);
          const info = stmt2.run(app_cfg.global.db_limit_log);

          resolve(info.changes);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Schreiben eines Log-Eintrags. " + typ + text + error
          )
        );
      }
    });
  };

  // letzten 10000 Log-Einträge abfragen
  const db_log_get_10000 = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_log ORDER BY id DESC LIMIT 5000;
        `);
        let rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error("Fehler beim Abfragen der letzten Log-Einträge. " + error)
        );
      }
    });
  };

  // Client-Eintrag per Socket-ID finden
  const db_socket_get_by_id = (socket_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_clients WHERE socket_id = ?;
        `);
        let row = stmt.get(socket_id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen eines Client-Eintrags über die Socket-ID. " +
              socket_id +
              error
          )
        );
      }
    });
  };

  // Socket-ID über Raumnamen finden
  const db_socket_get_by_room = (room_name) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT socket_id FROM waip_clients 
          WHERE room_name = ?;
        `);
        let row = stmt.get(room_name);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen einer Socket-ID über einen Raumnamen. " +
              room_name +
              error
          )
        );
      }
    });
  };

  // Socket-ID für ein Dashboard per Waip-Id finden
  const db_socket_get_dbrd = (waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT socket_id FROM waip_clients 
          WHERE client_status = ? AND socket_id LIKE '/dbrd#%';
        `);
        let rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen der Socket-IDs (Dashboard). " +
              waip_id +
              error
          )
        );
      }
    });
  };

  // Sockets (Clients) finden, die in den Standby gehen sollen
  const db_socket_get_all_to_standby = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT socket_id FROM waip_clients
          WHERE reset_timestamp < DATETIME(\'now\', \'localtime\');
        `);
        let rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Abfragen Socket-IDs für Clients in Standby gehen sollen. " +
              error
          )
        );
      }
    });
  };

  // Konfiguration eines Users speichern
  const db_user_set_config = (user_id, reset_counter) => {
    return new Promise((resolve, reject) => {
      try {
        // reset_counter validieren, ansonsten auf default setzen
        if (
          !(
            reset_counter >= 1 &&
            reset_counter <= app_cfg.global.time_to_delete_waip
          )
        ) {
          reset_counter = app_cfg.global.default_time_for_standby;
        }
        // Benutzer-Einstellungen speichern
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO waip_user_config
          (id, user_id, reset_counter)
          VALUES (
            (select ID from waip_user_config where user_id like ? ),
            ?,
            ?,
          );
        `);
        const info = stmt.run(user_id, user_id, reset_counter);
        resolve(info.changes);
      } catch (error) {
        reject(
          new Error(
            "Fehler beim speichern / aktualisieren von Benutzer-Einstellungen. " +
              user_id +
              reset_counter +
              error
          )
        );
      }
    });
  };

  // Einstellungen eines Benutzers laden
  const db_user_get_config = (user_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT reset_counter FROM waip_user_config
          WHERE user_id = ?;
        `);
        let row = stmt.get(user_id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim laden von Benutzer-Einstellungen. " + user_id + error
          )
        );
      }
    });
  };

  // alle Benutzer laden
  const db_user_get_all = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, user, permissions, ip_address FROM waip_users;
        `);
        let rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim laden aller Benutzerdaten. " + error));
      }
    });
  };

  // Benutzer-Berechtigung ueberpruefen
  const db_user_check_permission = (user_obj, waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        // wenn user_obj und permissions nicht übergeben wurden, dann false
        if (!user_obj && !user_obj.permissions) {
          resolve(false);
        }
        // wenn admin, dann true
        if (user_obj.permissions == "admin") {
          resolve(true);
        } else {
          // Berechtigungen aus DB abfragen -> 52,62,6690,....
          const stmt = db.prepare(`
            SELECT GROUP_CONCAT(DISTINCT wa.nr_wache) wache FROM waip_einsatzmittel em
            LEFT JOIN waip_wachen wa ON wa.id = em.waip_wachen_ID
            WHERE waip_einsaetze_ID = ?;
          `);
          let row = stmt.get(waip_id);
          // keine Wache für Benutzer hinterlegt, dann false
          if (row === undefined) {
            resolve(false);
          } else {
            // Berechtigungen mit Wache vergleichen, wenn found, dann true, sonst false
            let permission_arr = user_obj.permissions.split(",");
            const found = permission_arr.some(
              (r) => row.wache.search(RegExp("," + r + "|\\b" + r)) >= 0
            );
            if (found) {
              resolve(true);
            } else {
              resolve(false);
            }
          }
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim Überprüfen der Berechtigungen eines Benutzers. " +
              user_obj +
              waip_id +
              error
          )
        );
      }
    });
  };

/*id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        zeitstempel DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP)),
        einsatz_id INTEGER,
        gssi_wache INTEGER,
        anzahl_empfaenger INTEGER,
        response_uuid TEXT,
        response_type TEXT,
        response_agt INTEGER,
        response_alias TEXT,
        response_adress TEXT,           -- neu
        response_receivetime DATETIME,  -- neu
        response_settime DATETIME,
        response_arrivaltime DATETIME,*/

  const db_rmld_save = (rmld_obj) => {
    return new Promise((resolve, reject) => {
      try {
        // zunächst prüfen ob Wache (GSSI) gesetzt
        if (!isNaN(rmld_obj.gssi_wache)) {
          reuckmeldung.wache_id = responseobj.wachenauswahl;
        } else {
          reuckmeldung.wache_id = null;
        }
      } catch (error) {
        reject(
          new Error(
            "Fehler beim verarbeiten einer Rückmeldung. " +
            rmld_obj
              +
              error
          )
        );
      }
    })
  };

  function db_rmld_save(responseobj, callback) {
    // TODO auch das Update einer Rückmeldung speichern und verteilen
    // Rueckmeldung speichern
    let reuckmeldung = {};
    reuckmeldung.rmld_uuid = responseobj.rmld_uuid;
    reuckmeldung.waip_uuid = responseobj.waip_uuid;
    // Typ der Einsatzfunktion festlegen
    switch (responseobj.radio_efunction) {
      case "ek":
        reuckmeldung.einsatzkraft = 1;
        reuckmeldung.maschinist = 0;
        reuckmeldung.fuehrungskraft = 0;
        break;
      case "ma":
        reuckmeldung.einsatzkraft = 0;
        reuckmeldung.maschinist = 1;
        reuckmeldung.fuehrungskraft = 0;
        break;
      case "fk":
        reuckmeldung.einsatzkraft = 0;
        reuckmeldung.maschinist = 0;
        reuckmeldung.fuehrungskraft = 1;
        break;
      default:
        reuckmeldung.einsatzkraft = 0;
        reuckmeldung.maschinist = 0;
        reuckmeldung.fuehrungskraft = 0;
    }
    // ist AGT ja / nein
    if (responseobj.cb_agt) {
      reuckmeldung.agt = 1;
    } else {
      reuckmeldung.agt = 0;
    }
    // Zeitpunkt der Rueckmeldung festlegen
    reuckmeldung.set_time = new Date();
    // Zeitpunkt der geplanten Ankunft festlegen
    let resp_time = new Date();
    resp_time.setMinutes(
      resp_time.getMinutes() + parseInt(responseobj.eintreffzeit)
    );
    reuckmeldung.arrival_time = resp_time;
    // Wache gesetzt?
    if (!isNaN(responseobj.wachenauswahl)) {
      reuckmeldung.wache_id = responseobj.wachenauswahl;
    } else {
      reuckmeldung.wache_id = null;
    }
    // Rueckmeldung der Wache zuordnen
    db.get(
      `select name_wache, nr_wache from waip_wachen where id = ?;`,
      [reuckmeldung.wache_id],
      function (err, row) {
        if (err == null && row) {
          reuckmeldung.wache_name = row.name_wache;
          reuckmeldung.wache_nr = row.nr_wache;
          // Rueckmeldung in DB speichern
          db.run(
            `insert or replace into waip_response (id, waip_uuid, rmld_uuid, einsatzkraft, maschinist, fuehrungskraft, agt, set_time, arrival_time, wache_id, wache_nr, wache_name) 
        values
        ((select id from waip_response where rmld_uuid =  \'` +
              reuckmeldung.rmld_uuid +
              `\'), 
        \'` +
              reuckmeldung.waip_uuid +
              `\', 
        \'` +
              reuckmeldung.rmld_uuid +
              `\', 
        \'` +
              reuckmeldung.einsatzkraft +
              `\', 
        \'` +
              reuckmeldung.maschinist +
              `\', 
        \'` +
              reuckmeldung.fuehrungskraft +
              `\', 
        \'` +
              reuckmeldung.agt +
              `\', 
        \'` +
              reuckmeldung.set_time +
              `\', 
        \'` +
              reuckmeldung.arrival_time +
              `\', 
        \'` +
              reuckmeldung.wache_id +
              `\', 
        \'` +
              reuckmeldung.wache_nr +
              `\', 
        \'` +
              reuckmeldung.wache_name +
              `\')`,
            function (err) {
              if (err == null) {
                // Rueckmeldung-UUID zurückgeben
                callback && callback(reuckmeldung.rmld_uuid);
              } else {
                callback && callback(null);
              }
            }
          );
        } else {
          callback && callback(null);
        }
      }
    );
  }

  // alle Rückmeldungen laden
  function db_rmld_get_fuer_wache(waip_einsaetze_id, wachen_nr, callback) {
    // Rueckmeldungen fuer eine Wache auslesen
    db.all(
      `SELECT * FROM waip_response WHERE waip_uuid = (select uuid from waip_einsaetze where id = ?)`,
      [waip_einsaetze_id],
      function (err, rows) {
        if (err == null && rows) {
          // temporaere Variablen
          let itemsProcessed = 0;
          let all_responses = [];
          // callback-function fuer absgeschlossene Schleife
          function loop_done(all_responses) {
            callback && callback(all_responses);
          }
          // summiertes JSON-Rueckmeldeobjekt für die angeforderte Wachennummer erstellen
          rows.forEach(function (item, index, array) {
            let tmp = JSON.stringify(item.wache_nr);
            if (tmp.startsWith(wachen_nr) || wachen_nr == 0) {
              if (item.einsatzkraft == 1) {
                item.einsatzkraft = true;
              } else {
                item.einsatzkraft = false;
              }
              if (item.maschinist == 1) {
                item.maschinist = true;
              } else {
                item.maschinist = false;
              }
              if (item.fuehrungskraft == 1) {
                item.fuehrungskraft = true;
              } else {
                item.fuehrungskraft = false;
              }
              if (item.agt == 1) {
                item.agt = true;
              } else {
                item.agt = false;
              }
              // Rueckmeldeobjekt aufsummieren
              all_responses.push(item);
            }
            // Schleife ggf. beenden
            itemsProcessed++;
            if (itemsProcessed === array.length) {
              loop_done(all_responses);
            }
          });
        } else {
          callback && callback(null);
        }
      }
    );
  }

  // eine Rückmeldung laden
  function db_rmld_get_by_rmlduuid(rmld_uuid, callback) {
    // einzelne Rueckmeldung fuer eine Rueckmelde-UUID
    db.all(
      `SELECT * FROM waip_response WHERE rmld_uuid like ?`,
      [rmld_uuid],
      function (err, row) {
        if (err == null && row) {
          if (row.einsatzkraft == 1) {
            row.einsatzkraft = true;
          } else {
            row.einsatzkraft = false;
          }
          if (row.maschinist == 1) {
            row.maschinist = true;
          } else {
            row.maschinist = false;
          }
          if (row.fuehrungskraft == 1) {
            row.fuehrungskraft = true;
          } else {
            row.fuehrungskraft = false;
          }
          if (row.agt == 1) {
            row.agt = true;
          } else {
            row.agt = false;
          }
          callback && callback(row);
        } else {
          callback && callback(null);
        }
      }
    );
  }

  function db_rmld_get_for_export(waip_einsatznummer, waip_uuid, callback) {
    // alle Rueckmeldungen fuer einen Einsatz ermitteln
    db.all(
      `SELECT ? einsatznummer, wr.id, wr.waip_uuid, wr.rmld_uuid, wr.einsatzkraft, wr.maschinist, wr.fuehrungskraft, 
      wr.agt, wr.set_time, wr.arrival_time, wr.wache_id, wr.wache_nr, wr.wache_name
      FROM waip_response wr WHERE wr. waip_uuid like ?`,
      [waip_einsatznummer, waip_uuid],
      function (err, rows) {
        if (err == null && rows) {
          callback && callback(rows);
        } else {
          callback && callback(null);
        }
      }
    );
  }

  function db_rmld_loeschen(waip_uuid) {
    // Rueckmeldungen löschen
    db.run(`DELETE FROM waip_response WHERE waip_uuid = ?`, [waip_uuid]);
  }

  function db_export_get_for_rmld(arry_wachen, callback) {
    // saubere String-Werte erstellen
    arry_wachen = arry_wachen.map(String);
    // Wachen-Nummern um Teil-Nummern fuer Kreis und Treager ergaenzen
    let kreis = arry_wachen.map((i) => i.substr(0, 2));
    let traeger = arry_wachen.map((i) => i.substr(0, 4));
    arry_wachen = arry_wachen.concat(kreis);
    arry_wachen = arry_wachen.concat(traeger);
    // doppelte Elemente aus Array entfernen
    arry_wachen = arry_wachen.filter((v, i, a) => a.indexOf(v) === i);
    // DEBUG
    if (app_cfg.global.development) {
      console.log("Export-Liste RMLD: " + JSON.stringify(arry_wachen));
    }
    // nur weiter machen wenn arry_wachen nicht leer, weil z.b. keine Rueckmeldungen vorhanden sind
    if (arry_wachen.length > 0) {
      // Export-Liste auslesen
      db.each(
        `select * from waip_export where export_typ like \'rmld\' and (export_filter IN (` +
          arry_wachen.join(", ") +
          `) or export_filter like \'\')`,
        function (err, row) {
          if (err == null && row) {
            callback && callback(row);
          } else {
            callback && callback(null);
          }
        }
      );
    } else {
      callback && callback(null);
    }
  }

  return {
    db_einsatz_speichern: db_einsatz_speichern,
    db_einsatz_ermitteln: db_einsatz_ermitteln,
    db_einsatz_check_uuid: db_einsatz_check_uuid,
    db_einsatz_check_history: db_einsatz_check_history,
    db_einsatz_get_by_waipid: db_einsatz_get_by_waipid,
    db_einsatz_get_by_uuid: db_einsatz_get_by_uuid,
    db_einsatz_get_uuid_by_enr: db_einsatz_get_uuid_by_enr,
    db_einsatz_get_waipid_by_uuid: db_einsatz_get_waipid_by_uuid,
    db_einsatz_get_active: db_einsatz_get_active,
    db_einsatz_get_rooms: db_einsatz_get_rooms,
    db_einsatz_get_old: db_einsatz_get_old,
    db_einsatz_loeschen: db_einsatz_loeschen,
    db_wache_get_all: db_wache_get_all,
    db_wache_vorhanden: db_wache_vorhanden,
    db_tts_einsatzmittel: db_tts_einsatzmittel,
    db_client_update_status: db_client_update_status,
    db_client_get_connected: db_client_get_connected,
    db_client_delete: db_client_delete,
    db_client_check_waip_id: db_client_check_waip_id,
    db_log: db_log,
    db_log_get_10000: db_log_get_10000,
    db_socket_get_by_id: db_socket_get_by_id,
    db_socket_get_by_room: db_socket_get_by_room,
    db_socket_get_dbrd: db_socket_get_dbrd,
    db_socket_get_all_to_standby: db_socket_get_all_to_standby,
    db_user_set_config: db_user_set_config,
    db_user_get_config: db_user_get_config,
    db_user_get_all: db_user_get_all,
    db_user_check_permission: db_user_check_permission,
    db_rmld_save: db_rmld_save,
    db_rmld_get_fuer_wache: db_rmld_get_fuer_wache,
    db_rmld_get_by_rmlduuid: db_rmld_get_by_rmlduuid,
    db_rmld_get_for_export: db_rmld_get_for_export,
    db_rmld_loeschen: db_rmld_loeschen,
    db_export_get_for_rmld: db_export_get_for_rmld,
  };
};