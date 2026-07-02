module.exports = (db, app_cfg) => {
  // Module laden
  const crypto = require("crypto");
  const uuidv5 = (name, namespace) => {
    const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
    const hash = crypto.createHash("sha1").update(nsBytes).update(Buffer.from(name, "utf8")).digest();
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const h = hash.slice(0, 16).toString("hex");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
  };

  // Hilfsfunktion um Datum&Zeit (29.12.23&20:06) in SQLite-Zeit umzuwandeln
  const Datetime_to_SQLiteDate = (s) => {
    if (s) {
      let d = new Date();
      let simpletime = new RegExp(/^\d{2}:\d{2}$/);
      let simpledate = new RegExp(/^\d{2}\.\d{2}\.\d{2}&\d{2}:\d{2}$/);
      if (!simpletime.test(s) && !simpledate.test(s)) {
        return null;
      }
      if (simpletime.test(s)) {
        let hour = parseInt(s.substring(0, 2), 10);
        let min = parseInt(s.substring(3, 5), 10);
        d.setHours(hour);
        d.setMinutes(min);
        let iso_date = d.toISOString();
        let sql_date = iso_date.replace(/T|Z/g, " ");
        sql_date = sql_date.trim();
        sql_date = sql_date.substring(0, 19);
        return sql_date;
      }
      if (simpledate.test(s)) {
        let day = parseInt(s.substring(0, 2), 10);
        let month = parseInt(s.substring(3, 5), 10) - 1; // Monate sind nullbasiert
        let year = parseInt(d.getFullYear().toString().substring(0, 2) + s.substring(6, 8), 10);
        let hour = parseInt(s.substring(9, 11), 10);
        let min = parseInt(s.substring(12, 14), 10);
        d.setDate(day);
        d.setMonth(month);
        d.setFullYear(year);
        d.setHours(hour);
        d.setMinutes(min);
        let iso_date = d.toISOString();
        let sql_date = iso_date.replace(/T|Z/g, " ");
        sql_date = sql_date.trim();
        sql_date = sql_date.substring(0, 19);
        return sql_date;
      } else {
        return null;
      }
    } else {
      return null;
    }
  };

  // SQL-Abfragen

  // Alarmdaten auf aktive Wachen filtern — gibt nur Eintraege zurueck, bei denen die Wache aktiv ist
  const db_alarmdaten_filter_aktiv = (alarmdaten) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT name_wache FROM waip_wachen WHERE name_wache LIKE ? AND aktiv = 1;
        `);
        const aktiv = alarmdaten.filter((item) => stmt.get(item.wachenname) !== undefined);
        resolve(aktiv);
      } catch (error) {
        reject(new Error("Fehler beim Filtern der Alarmdaten nach aktiven Wachen. " + error));
      }
    });
  };

  // Einsatz inkl. Einsatzmitteln in Datenbank speichern
  const db_einsatz_speichern = (content) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Abbrechen wenn keine UUID vorhanden ist
        if (!content.einsatzdaten.uuid) {
          throw new Error("Keine UUID überbermittelt, Einsatz wird nicht gespeichert.");
        }

        // Hilfsfunktionen: fehlende/leere Werte explizit als NULL übergeben,
        // damit COALESCE beim Update bestehende DB-Werte erhalten kann.
        const nullIfEmpty = (v) => (v === null || v === undefined || v === "" ? null : v);
        const nullIfNaN   = (v) => (Number.isNaN(v) ? null : v);
        const geometryStr = (g) => (g != null ? JSON.stringify(g) : null);

        const einsatzart    = nullIfEmpty(content.einsatzdaten.art);
        const stichwort     = nullIfEmpty(content.einsatzdaten.stichwort);
        const sondersignal  = nullIfNaN(parseInt(content.einsatzdaten.sondersignal, 10));
        const besonderheiten = nullIfEmpty(content.einsatzdaten.besonderheiten);
        const einsatzdetails = nullIfEmpty(content.einsatzdaten.einsatzdetails);
        const ort           = nullIfEmpty(content.ortsdaten.ort);
        const ortsteil      = nullIfEmpty(content.ortsdaten.ortsteil);
        const ortslage      = nullIfEmpty(content.ortsdaten.ortslage);
        const strasse       = nullIfEmpty(content.ortsdaten.strasse);
        const hausnummer    = nullIfEmpty(content.ortsdaten.hausnummer);
        const ort_sonstiges = nullIfEmpty(content.ortsdaten.ort_sonstiges);
        const objekt        = nullIfEmpty(content.ortsdaten.objekt);
        const objektteil    = nullIfEmpty(content.ortsdaten.objektteil);
        const objektnr      = nullIfEmpty(content.ortsdaten.objektnr);
        const objektart     = nullIfEmpty(content.ortsdaten.objektart);
        const wachfolge     = nullIfEmpty(content.ortsdaten.wachfolge);
        const wgs84_x       = nullIfNaN(parseFloat(content.ortsdaten.wgs84_x));
        const wgs84_y       = nullIfNaN(parseFloat(content.ortsdaten.wgs84_y));
        const geometry      = geometryStr(content.ortsdaten.geometry);
        const alarmzeit     = Datetime_to_SQLiteDate(content.einsatzdaten.alarmzeit);

        // Prüfen ob der Einsatz bereits in der DB vorhanden ist
        const existingRow = db.prepare("SELECT id FROM waip_einsaetze WHERE uuid = ?").get(content.einsatzdaten.uuid);

        let id;

        if (!existingRow) {
          // Neuer Einsatz: vollständiger INSERT
          const stmt = db.prepare(`
            INSERT INTO waip_einsaetze (
              uuid, els_einsatznummer, alarmzeit, ablaufzeit, einsatzart, stichwort, sondersignal, besonderheiten, einsatzdetails,
              ort, ortsteil, ortslage, strasse, hausnummer, ort_sonstiges, objekt, objektteil, objektnummer, objektart,
              wachenfolge, wgs84_x, wgs84_y, geometry
            ) VALUES (
              ?, ?, DATETIME(?, 'localtime'),
              DATETIME('now', '+${app_cfg.global.time_to_delete_waip} minutes', 'localtime'),
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            );
          `);
          const info = stmt.run(
            content.einsatzdaten.uuid, content.einsatzdaten.einsatznummer, alarmzeit,
            einsatzart, stichwort, sondersignal, besonderheiten, einsatzdetails,
            ort, ortsteil, ortslage, strasse, hausnummer, ort_sonstiges,
            objekt, objektteil, objektnr, objektart, wachfolge,
            wgs84_x, wgs84_y, geometry
          );
          id = info.lastInsertRowid;
        } else {
          // Bestehender Einsatz: UPDATE mit COALESCE, damit reduzierte Folge-Datensätze
          // keine vollständigen Daten in der DB überschreiben können. Felder werden nur
          // aktualisiert, wenn der neue Wert nicht NULL ist; ablaufzeit wird immer neu gesetzt.
          const stmt = db.prepare(`
            UPDATE waip_einsaetze SET
              alarmzeit    = COALESCE(DATETIME(?, 'localtime'), alarmzeit),
              ablaufzeit   = DATETIME('now', '+${app_cfg.global.time_to_delete_waip} minutes', 'localtime'),
              einsatzart   = COALESCE(?, einsatzart),
              stichwort    = COALESCE(?, stichwort),
              sondersignal = COALESCE(?, sondersignal),
              besonderheiten = COALESCE(?, besonderheiten),
              einsatzdetails = COALESCE(?, einsatzdetails),
              ort          = COALESCE(?, ort),
              ortsteil     = COALESCE(?, ortsteil),
              ortslage     = COALESCE(?, ortslage),
              strasse      = COALESCE(?, strasse),
              hausnummer   = COALESCE(?, hausnummer),
              ort_sonstiges = COALESCE(?, ort_sonstiges),
              objekt       = COALESCE(?, objekt),
              objektteil   = COALESCE(?, objektteil),
              objektnummer = COALESCE(?, objektnummer),
              objektart    = COALESCE(?, objektart),
              wachenfolge  = COALESCE(?, wachenfolge),
              wgs84_x      = COALESCE(?, wgs84_x),
              wgs84_y      = COALESCE(?, wgs84_y),
              geometry     = COALESCE(?, geometry)
            WHERE uuid = ?;
          `);
          stmt.run(
            alarmzeit,
            einsatzart, stichwort, sondersignal, besonderheiten, einsatzdetails,
            ort, ortsteil, ortslage, strasse, hausnummer, ort_sonstiges,
            objekt, objektteil, objektnr, objektart, wachfolge,
            wgs84_x, wgs84_y, geometry,
            content.einsatzdaten.uuid
          );
          id = existingRow.id;
        }

        // anschließend die zugehörigen Einsatzmittel per Schliefe in DB speichern
        let itemsProcessed = 0;

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
                em_station_name,
                em_funkrufname,
                em_zeitstempel_alarmierung,
                em_zeitstempel_ausgerueckt,
                em_zeitstempel_alarmierung_iso,
                em_zeitstempel_ausgerueckt_iso
              ) VALUES (
                (SELECT ID FROM waip_einsatzmittel WHERE em_funkrufname LIKE ?),
                ?,
                (SELECT ID FROM waip_wachen WHERE name_wache LIKE ? AND aktiv = 1),
                ?,
                ?,
                DATETIME(?),
                DATETIME(?),
                ?,
                ?
              );
            `);

            stmt.run(
              item.einsatzmittel,
              id,
              item.wachenname,
              item.wachenname,
              item.einsatzmittel,
              Datetime_to_SQLiteDate(item.zeit_alarmierung),
              Datetime_to_SQLiteDate(item.zeit_ausgerueckt),
              item.zeit_alarmierung_iso || null,
              item.zeit_ausgerueckt_iso || null
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
        reject(new Error("Fehler beim Speichern der Einsatzgrunddaten. " + error));
      }
    });
  };

  // letzten vorhanden Einsatz zu einer Wache für einen Client/User abfragen
  const db_einsatz_for_client_ermitteln = (socket, wachen_nr) => {
    return new Promise((resolve, reject) => {
      try {
        let sql_filter = `(SELECT wa.nr_wache FROM waip_wachen wa WHERE wa.id = em.em_station_id) LIKE ${wachen_nr} || '%' `;

        // wenn Wachen-ID 0 ist, dann % für SQL-Abfrage setzen
        if (parseInt(wachen_nr) == 0) {
          sql_filter = `(SELECT wa.nr_wache FROM waip_wachen wa WHERE wa.id = em.em_station_id) LIKE '%' `;
        }
        // wenn die Wachen-ID 1 bis 5 ist, handelt es sich um eine Leitstelle
        if (wachen_nr.toString().length === 1 && parseInt(wachen_nr) >= 1 && parseInt(wachen_nr) <= 5) {
          sql_filter = `(SELECT wa.nr_leitstelle FROM waip_wachen wa WHERE wa.id = em.em_station_id) LIKE ${wachen_nr} `;
        }

        // neuesten Einsatz für die gewählte Wachen-ID abfragen
        const stmt1 = db.prepare(`
          SELECT 
          em.em_waip_einsaetze_id AS waip_id
          FROM waip_einsatzmittel em
          WHERE 
          ${sql_filter}
          ORDER BY (SELECT zeitstempel FROM waip_einsaetze WHERE id = em.em_waip_einsaetze_id) DESC LIMIT 1
        `);
        const row1 = stmt1.get();

        if (row1 === undefined) {
          resolve(null);
        } else {
          // User-ID aus socket.data.user lesen
          const client_user = socket.data && socket.data.user ? socket.data.user : null;
          const user_id = client_user && client_user.id ? client_user.id : null;

          // Reset-Counter des Users ermitteln
          const stmt2 = db.prepare(`
            SELECT config_value FROM waip_user_config
            WHERE user_id = ? AND config_type = 'resetcounter';
          `);
          const row2 = stmt2.get(user_id);

          // Standard-Reset-Zeit aus app_cfg als Fallback
          reset_timestamp = app_cfg.global.default_time_for_standby;

          // Wenn ein benutzerdefinierter Reset-Counter vorhanden ist, diesen verwenden
          if (row2 !== undefined && row2.config_value) {
            reset_timestamp = row2.config_value;
          }

          // prüfen ob der Zeitstempel des Einsatzes + Reset-Counter nicht über der aktuellen Uhrzeit liegt
          const stmt3 = db.prepare(`
            SELECT we.id, DATETIME(we.zeitstempel, ? || ' minutes') reset_time
            FROM waip_einsaetze we
            WHERE we.id = ? 
            AND DATETIME(we.zeitstempel, ? || ' minutes') > DATETIME('now', 'localtime');
          `);
          const row3 = stmt3.get(reset_timestamp, row1.waip_id, reset_timestamp);

          if (row3 === undefined) {
            resolve(null);
          } else {
            resolve(row3);
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der Einsätze für Wachen-ID " + wachen_nr + "). " + error));
      }
    });
  };

  // Überprüfung ob ein Einsatz mit dieser UUID vorhanden ist
  const db_einsatz_check_uuid = (uuid) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, uuid FROM waip_einsaetze WHERE uuid LIKE ? ;
        `);
        const row = stmt.get(uuid);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler beim Prüfen der UUID " + uuid + " für einen Einsatz. " + error));
      }
    });
  };

  // Prüfen ob Wachalarm bereits in dieser Form an diesen Socket gesendet wurde (Doppelalarmierung vermeiden)
  const db_einsatz_check_history = (einsatzdaten, socket) => {
    return new Promise((resolve, reject) => {
      try {
        const uuidNamespace = app_cfg.global.uuidNamespace;

        // Nur die relevanten Felder für den Vergleich behalten
        const relevantFields = {
          id: einsatzdaten.id,
          einsatzart: einsatzdaten.einsatzart,
          stichwort: einsatzdaten.stichwort,
          sondersignal: einsatzdaten.sondersignal,
          objekt: einsatzdaten.objekt,
          ort: einsatzdaten.ort,
          ortsteil: einsatzdaten.ortsteil,
          strasse: einsatzdaten.strasse,
          besonderheiten: einsatzdaten.besonderheiten,
        };

        // Einsatzmittel-Namen extrahieren (Zeiten ignorieren) und sortieren für bessere Vergleichbarkeit
        const emAlarmiertNames = (einsatzdaten.em_alarmiert || [])
          .map((e) => (e && e.name ? e.name : ""))
          .filter(Boolean)
          .sort();
        const emWeitereNames = (einsatzdaten.em_weitere || [])
          .map((e) => (e && e.name ? e.name : ""))
          .filter(Boolean)
          .sort();

        // Einsatzdaten in kurze UUID-Strings umwandeln, diese UUIDs werden dann verglichen
        let uuid_einsatzdaten = uuidv5(JSON.stringify(relevantFields), uuidNamespace);
        let uuid_em_alarmiert = uuidv5(JSON.stringify(emAlarmiertNames), uuidNamespace);
        let uuid_em_weitere = uuidv5(JSON.stringify(emWeitereNames), uuidNamespace);

        // Abfrage ob zu Socket und Waip-ID bereits History-Daten hinterlegt sind
        const stmt = db.prepare(`
          SELECT * FROM waip_history 
          WHERE waip_uuid LIKE (
            SELECT uuid FROM waip_einsaetze WHERE id = ?
          ) AND socket_id LIKE ? ;
        `);

        const row = stmt.get(einsatzdaten.id, socket.id);

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

          stmt.run(einsatzdaten.id, socket.id, uuid_einsatzdaten, uuid_em_alarmiert, uuid_em_weitere);

          // Check-History = false
          resolve(false);
        } else {
          // wenn History-Daten hinterlegt sind, dann prüfen ob sich etwas verändert hat
          const isDoppelalarm = uuid_einsatzdaten === row.uuid_einsatz_grunddaten && uuid_em_alarmiert === row.uuid_em_alarmiert;

          // Nur aktualisieren wenn sich etwas geändert hat
          if (!isDoppelalarm) {
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
            stmt.run(uuid_einsatzdaten, uuid_em_alarmiert, uuid_em_weitere, einsatzdaten.id, socket.id);
          }

          resolve(isDoppelalarm);
        }
      } catch (error) {
        reject(new Error("Fehler beim Prüfen der Einsatz-Historie. " + error));
      }
    });
  };

  // Einsatzdaten entsprechend der WAIP-ID zusammentragen
  const db_einsatz_get_for_wache = (waip_id, wachen_nr) => {
    return new Promise((resolve, reject) => {
      try {
        // falls waip_id oder wachen_nur keine zahlen sind, Abbruch
        if (isNaN(waip_id) || isNaN(wachen_nr)) {
          throw `WAIP-ID ${waip_id} oder Wachennummer ${wachen_nr} sind keine validen Zahlen!`;
        } else {
          // TODO hier auch andere Wachennummern berücksichtigen (z.B. 521201b), siehe auch Rückmeldungen
          // wachen_nr muss 2, 4 oder 6 Zeichen lang sein
          let len = wachen_nr.toString().length;
          if (len != 1 && len != 2 && len != 4 && len != 6 && len == null) {
            throw `Wachennummer ${wachen_nr} hat keine valide Länge (1, 2, 4 oder 6)!`;
          }

          // FIXME: zentrale Abfrage zur Ausgabe der Alarmdaten wurde erneuert, asynchrone Rückgabe, Verweise und Verwendung prüfen!
          const stmt = db.prepare(`
              SELECT
                e.id,
                e.uuid,
                e.els_einsatznummer einsatznummer,
                DATETIME(e.zeitstempel) zeitstempel,
                e.einsatzart, 
                e.stichwort, 
                e.sondersignal, 
                e.objekt, 
                e.objektteil,
                e.ort, 
                e.ortsteil, 
                e.strasse, 
                e.hausnummer,
                e.einsatzdetails,
                e.besonderheiten, 
                e.wgs84_x, 
                e.wgs84_y,
                e.geometry
              FROM waip_einsaetze e
              WHERE e.id LIKE ?
              ORDER BY e.id DESC LIMIT 1;
            `);

          const einsatzdaten = stmt.get(waip_id.toString());

          if (einsatzdaten === undefined) {
            resolve(null);
          } else {
            // Filter für Einsatzmittel vorbereiten
            let em_sql_filter = `AND em_station_id IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE ${wachen_nr} || '%' AND aktiv = 1) `;
            let emnot_sql_filter = `AND em_station_id IN (SELECT id FROM waip_wachen WHERE nr_wache NOT LIKE ${wachen_nr} || '%' AND aktiv = 1) `;

            // wenn wachen_nr 0, dann % fuer Abfrage festlegen
            if (parseInt(wachen_nr) == 0) {
              wachen_nr = "%";
              em_sql_filter = `AND em_station_id IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE '%' AND aktiv = 1) `;
              emnot_sql_filter = `AND em_station_id IN (SELECT id FROM waip_wachen WHERE nr_wache NOT LIKE '%' AND aktiv = 1) `;
            }

            // wenn die Wachen-ID 1 bis 5 ist, handelt es sich um eine Leitstelle
            if (wachen_nr.toString().length === 1 && parseInt(wachen_nr) >= 1 && parseInt(wachen_nr) <= 5) {
              em_sql_filter = `AND em_station_id IN (SELECT id FROM waip_wachen WHERE nr_leitstelle LIKE ${wachen_nr} AND aktiv = 1) `;
              emnot_sql_filter = `AND em_station_id IN (SELECT id FROM waip_wachen WHERE nr_leitstelle NOT LIKE ${wachen_nr} AND aktiv = 1) `;
            }

            // Abfrage der alarmierten Einsatzmittel der Wache
            const stmt1 = db.prepare(`
                SELECT
                  em_funkrufname AS 'name',
                  em_zeitstempel_alarmierung AS 'zeit',
                  em_station_name AS 'wache',
                  em_zeitstempel_alarmierung_iso AS 'zeit_alarmierung_iso',
                  em_zeitstempel_ausgerueckt_iso AS 'zeit_ausgerueckt_iso'
                FROM waip_einsatzmittel
                WHERE
                  em_waip_einsaetze_id = ?
                  ${em_sql_filter}
                ;
              `);
            // Alle Einsatzmittel der Wache abfragen
            const em_alarmiert_all = stmt1.all(waip_id.toString());
            // nur Einsatzmittel als alarmiert zuordnen, wenn eine Alarmierungszeit gesetzt ist, das es sich sonst nicht um eine Alarmierung handelt
            einsatzdaten.em_alarmiert = em_alarmiert_all.filter((e) => e.zeit !== null && e.zeit !== undefined && e.zeit !== "");

            // Abfrage der weiteren Einsatzmittel zum Einsatz
            const stmt2 = db.prepare(`
                SELECT
                  em_funkrufname AS 'name',
                  em_zeitstempel_alarmierung AS 'zeit',
                  em_station_name AS 'wache',
                  em_zeitstempel_alarmierung_iso AS 'zeit_alarmierung_iso',
                  em_zeitstempel_ausgerueckt_iso AS 'zeit_ausgerueckt_iso'
                FROM waip_einsatzmittel
                WHERE
                  em_waip_einsaetze_id = ?
                  ${emnot_sql_filter}
                ;
              `);
            // weitere Einsatzmittel den Einsatzdaten zuordnen
            const em_weitere = stmt2.all(waip_id.toString());
            // weitere Einsatzmittel inkl. der alarmierten Einsatzmittel ohne Alarmierungszeit hinzufügen
            einsatzdaten.em_weitere = em_weitere.concat(em_alarmiert_all.filter((e) => e.zeit === null || e.zeit === undefined || e.zeit === ""));

            // Einsatzdaten zurückgeben
            resolve(einsatzdaten);
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Zusammenstellen der Einsatzdaten für WAIP-ID: " + waip_id + ". " + error));
      }
    });
  };

  // Einsatzdaten über die UUID zusammentragen
  const db_einsatz_get_by_uuid = (waip_uuid) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 
            e.id, 
            e.uuid, 
            e.els_einsatznummer einsatznummer,
            e.zeitstempel, 
            e.einsatzart, 
            e.stichwort, 
            e.sondersignal, 
            e.objekt, 
            e.objektteil,
            e.ort, 
            e.ortsteil, 
            e.strasse, 
            e.hausnummer,
            e.einsatzdetails, 
            e.besonderheiten,
            e.wgs84_x, 
            e.wgs84_y, 
            e.geometry
          FROM waip_einsaetze e 
          WHERE e.uuid LIKE ?;
        `);
        let einsatzdaten = stmt.get(waip_uuid);

        if (einsatzdaten === undefined) {
          throw `Abfrage der Einsatzdaten für UUID ${waip_uuid} lieferte kein Ergebnis!`;
        } else {
          // Einsatzmittel zum Einsatz finden
          const stmt1 = db.prepare(`
            SELECT
              e.em_station_id, e.em_funkrufname, e.em_zeitstempel_alarmierung, e.em_station_name,
              e.em_zeitstempel_alarmierung_iso, e.em_zeitstempel_ausgerueckt_iso
            FROM waip_einsatzmittel e
            JOIN waip_wachen w ON w.id = e.em_station_id AND w.aktiv = 1
            WHERE e.em_waip_einsaetze_id = ?;
          `);
          // Einsatzmittel den Einsatzdaten hinzufügen
          einsatzdaten.einsatzmittel = stmt1.all(einsatzdaten.id);

          // Wachen zum Einsatz finden und hinzufuegen
          const stmt2 = db.prepare(`
            SELECT DISTINCT
              e.em_station_id, e.em_station_name
            FROM waip_einsatzmittel e
            JOIN waip_wachen w ON w.id = e.em_station_id AND w.aktiv = 1
            WHERE e.em_waip_einsaetze_id = ?;
          `);
          einsatzdaten.wachen = stmt2.all(einsatzdaten.id);

          // Einsatzdaten zurückgeben
          resolve(einsatzdaten);
        }
      } catch (error) {
        reject(new Error("Fehler beim ermitteln eines Einsatzes über die UUID. " + error));
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
          WHERE els_einsatznummer LIKE ?;
        `);
        const row = stmt.get(einsatz_nr);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row.uuid);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der UUID eines Einsatzes mit der Einsatznummer " + einsatz_nr + error));
      }
    });
  };

  // mit ID die UUID eines Einsatzes finden
  const db_einsatz_get_uuid_by_id = (waip_id) => {
    const stmt = db.prepare(`SELECT uuid FROM waip_einsaetze WHERE id = ?;`);
    const row = stmt.get(String(waip_id));
    return row ? row.uuid : null;
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
        const row = stmt.get(waip_uuid);
        if (row === undefined) {
          throw `Keinen Einsatz mit der UUID ${waip_uuid} gefunden!`;
        } else {
          resolve(row.id);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der ID eines Einsatzes mit der UUID " + waip_uuid + error));
      }
    });
  };

  // alle aktivieren Einsaetze finden
  const db_einsatz_get_active = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 
            we.uuid, we.einsatzart, we.stichwort, we.ort, we.ortsteil, we.geometry,
            GROUP_CONCAT(DISTINCT wa.nr_leitstelle) l,
            GROUP_CONCAT(DISTINCT SUBSTR( wa.nr_wache, 0, 3 )) a,
            GROUP_CONCAT(DISTINCT SUBSTR( wa.nr_wache, 0, 5 )) b,
            GROUP_CONCAT(DISTINCT wa.nr_wache) c
          FROM waip_einsaetze we
          JOIN waip_einsatzmittel em ON em.em_waip_einsaetze_id = we.id
          JOIN waip_wachen wa ON wa.id = em.em_station_id AND wa.aktiv = 1
          GROUP BY we.id
          ORDER BY we.zeitstempel DESC, we.einsatzart, we.stichwort;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen aller aktiven Einsätze. " + error));
      }
    });
  };

  // alle potenziellen Socket-Rooms für einen Einsatz finden
  const db_einsatz_get_waip_rooms = (waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          -- Global
          SELECT CAST(w.nr_wache AS decimal) room FROM waip_wachen w
          WHERE w.nr_wache = 0
          UNION ALL
          -- Leitstellen
          SELECT CAST(w.nr_leitstelle AS decimal) room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.em_waip_einsaetze_id = ? GROUP BY w.nr_leitstelle
          UNION ALL
          -- Kreise
          SELECT CAST(w.nr_kreis AS decimal) room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.em_waip_einsaetze_id = ? GROUP BY w.nr_kreis
          UNION ALL
          -- Traeger
          SELECT CAST(w.nr_kreis || w.nr_traeger AS decimal) room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.em_waip_einsaetze_id = ? GROUP BY w.nr_kreis || w.nr_traeger
          UNION ALL
          -- Wachen
          SELECT CAST(w.nr_wache AS decimal) room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.em_waip_einsaetze_id = ? GROUP BY w.nr_wache
          UNION ALL
          -- Wachen-Alias-Nummern
          SELECT CAST(rp_output AS decimal) room FROM waip_replace
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = rp_input
          WHERE em.em_waip_einsaetze_id = ? AND rp_typ = 'station_alias' GROUP BY rp_output;
        `);
        const rows = stmt.all(waip_id, waip_id, waip_id, waip_id, waip_id);
        if (rows.length === 0) {
          throw `Kein Socket-Room für Einsatz ${waip_id} gefunden!`;
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der Socket-IO-Räume für Einsatz " + waip_id + ". " + error));
      }
    });
  };

  // veraltete Einsätze finden
  const db_einsaetze_get_old = () => {
    // BUG '-?' in Abfrage könnte falsch sein, ggf. durch '+ ablauf_minuten +' ersetzen
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, uuid, els_einsatznummer 
          FROM waip_einsaetze 
          WHERE DATETIME('now','localtime') >= ablaufzeit;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve();
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der zu löschender Einsätze. " + error));
      }
    });
  };

  // Status eines Einsatzes aktualisieren
  const db_einsatz_statusupdate = (einsatzstatus_data) => {
    // wenn keine Einsatznummer WAIP-Uuid gesetzt ist, einen Fehler ausgeben
    if (!einsatzstatus_data.einsatznummer && !einsatzstatus_data.waip_uuid) {
      throw "Einsatznummer oder WAIP-Uuid muss gesetzt sein!";
    }

    let uuid_query;
    // wenn Einsatznummer aber keiner WAIP-Uuid gesetzt ist, dann Einsatznummer für Abfrage verwenden
    if (einsatzstatus_data.einsatznummer && !einsatzstatus_data.waip_uuid) {
      uuid_query = `(SELECT uuid FROM waip_einsaetze WHERE els_einsatznummer = '${einsatzstatus_data.einsatznummer}')`;
    }
    // wenn WAIP-Uuid gesetzt ist, dann WAIP-Uuid für Abfrage verwenden
    if (einsatzstatus_data.waip_uuid) {
      uuid_query = `'${einsatzstatus_data.waip_uuid}'`;
    }

    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          UPDATE waip_einsaetze SET 
            ablaufzeit = DATETIME('now', 'localtime', '+${app_cfg.global.time_to_delete_waip} minutes')
          WHERE 
            waip_uuid LIKE ${uuid_query};
        `);
        const info = stmt.run();
        // Anzahl der aktualisierten Einsätze zurückgeben
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim Aktualisieren des Status eines Einsatzes. " + error));
      }
    });
  };

  // Alarmierte Wachen mit Koordinaten für OSRM-Routenberechnung
  const db_routen_stationen_get = (waip_id) => {
    const stmt = db.prepare(`
      SELECT DISTINCT
        w.id        AS station_id,
        w.nr_wache,
        w.name_wache,
        w.wgs84_x,
        w.wgs84_y
      FROM waip_einsatzmittel em
      JOIN waip_wachen w ON w.id = em.em_station_id
      WHERE em.em_waip_einsaetze_id = ?
        AND em.em_zeitstempel_alarmierung IS NOT NULL
        AND em.em_zeitstempel_alarmierung != ''
        AND w.wgs84_x IS NOT NULL AND w.wgs84_x != 0
        AND w.wgs84_y IS NOT NULL AND w.wgs84_y != 0
    `);
    return stmt.all(String(waip_id));
  };

  // Route für alle Einsatzmittel einer Wache in einem Einsatz speichern
  const db_route_speichern = (waip_id, station_id, route_full, route_half) => {
    const stmt = db.prepare(`
      UPDATE waip_einsatzmittel
      SET em_wgs84_route_full = ?, em_wgs84_route_half = ?
      WHERE em_waip_einsaetze_id = ? AND em_station_id = ?
    `);
    stmt.run(
      route_full ? JSON.stringify(route_full) : null,
      route_half ? JSON.stringify(route_half) : null,
      String(waip_id),
      String(station_id)
    );
  };

  // Gespeicherte Routen für einen Einsatz abrufen
  const db_routen_get = (waip_id) => {
    const stmt = db.prepare(`
      SELECT DISTINCT
        w.nr_wache,
        w.name_wache,
        em.em_wgs84_route_full,
        em.em_wgs84_route_half
      FROM waip_einsatzmittel em
      JOIN waip_wachen w ON w.id = em.em_station_id
      WHERE em.em_waip_einsaetze_id = ?
        AND (em.em_wgs84_route_full IS NOT NULL OR em.em_wgs84_route_half IS NOT NULL)
    `);
    return stmt.all(String(waip_id));
  };

  // Einsatzdaten vollständig löschen
  const db_einsatz_loeschen = (einsatz_id) => {
    return new Promise((resolve, reject) => {
      try {
        // History löschen
        const stmt1 = db.prepare(`
          DELETE FROM waip_history 
          WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE id = ?);
        `);
        stmt1.run(einsatz_id);
        // Rückmeldungen löschen
        const stmt2 = db.prepare(`
          DELETE FROM waip_rueckmeldungen 
          WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE id = ?);
        `);
        stmt2.run(einsatz_id);
        // Einsatzmittel löschen
        const stmt3 = db.prepare(`
          DELETE FROM waip_einsatzmittel 
          WHERE em_waip_einsaetze_id = ?;
        `);
        stmt3.run(einsatz_id);
        // Einsatz löschen
        const stmt4 = db.prepare(`
          DELETE FROM waip_einsaetze 
          WHERE id = ?;
        `);
        const info = stmt4.run(einsatz_id);
        // Anzahl der gelöschten Einsätze zurückgeben
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim Löschen der Daten zum Einsatz mit der ID " + einsatz_id + ". " + error));
      }
    });
  };

  // alle im System verfügbaren Wachen/Alarmmonitore abfragen
  const db_wache_get_all = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          -- Global
          SELECT DISTINCT
            'global' AS typ,
            CAST(nr_wache AS TEXT) AS nr,
            name_wache AS name
          FROM waip_wachen
          WHERE nr_wache IS '0' AND aktiv = 1
          UNION ALL
          -- Leitstellen
          SELECT
            'leitstelle' AS typ,
            CAST(nr_leitstelle AS TEXT) AS nr,
            name_leitstelle AS name
          FROM waip_wachen
          WHERE nr_wache IS NOT '0' AND aktiv = 1
          GROUP BY name_leitstelle
          UNION ALL
          -- Landkreise
          SELECT
            'kreis' AS typ,
            CAST(nr_kreis AS TEXT) AS nr,
            name_kreis AS name
          FROM waip_wachen
          WHERE nr_wache IS NOT '0' AND aktiv = 1
          GROUP BY name_kreis
          UNION ALL
          -- Träger
          SELECT DISTINCT
            'traeger' typ,
            nr_kreis || nr_traeger AS nr,
            CASE
              WHEN name_erweiterung = '' THEN name_traeger
              ELSE CONCAT(name_traeger, ' [', name_erweiterung , ']'  )
            END AS name
          FROM waip_wachen
          WHERE nr_wache IS NOT '0' AND aktiv = 1
          UNION ALL
          -- Wachen
          SELECT
            'wache' AS typ,
            CAST(nr_wache AS TEXT) AS nr,
            name_wache AS name
          FROM waip_wachen
          WHERE nr_wache IS NOT '0' AND aktiv = 1
          ORDER BY typ, name;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          throw `Keine Wachen / Alarmmonitore hinterlegt! Mindestens eine Standard-Wache muss vorhanden sein!`;
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der verfügbaren Wachen / Alarmmonitore. " + error));
      }
    });
  };

  // Prüffunktion um zu erkennen ob wachen_nr valide ist
  const db_wache_vorhanden = (wachen_nr) => {
    return new Promise((resolve, reject) => {
      try {
        // wachen_nr muss eine Zahl sein, sonst nicht valide
        if (isNaN(wachen_nr)) {
          throw `Wachennummer ${wachen_nr} ist keine Zahl!`;
        } else {
          // wenn wachen_nr eine Zahl ist, dann prüfen ob die Länge valide ist
          let len = wachen_nr.toString().length;
          // wachen_nr muss 2, 4 oder 6 Zeichen lang sein
          if (len != 1 && len != 2 && len != 4 && len != 6) {
            // Fehler: Wachennummer nicht plausibel.
            throw `Wachennummer ${wachen_nr} ist nicht plausibel! Länge: 1, 2, 4 oder 6`;
          } else {
            // "Type" der wachen_nr in String umwandeln, damit SQL-Anweisungen wirklich funktionieren
            wachen_nr = wachen_nr + "";
            // wachen_nr plausibel, jetzt je nach Länge passende SQL-Anweisung ausführen
            if (len == 1) {
              const stmt = db.prepare(`
                SELECT DISTINCT '1' length, nr_leitstelle nr, name_leitstelle name
                FROM waip_wachen
                WHERE nr_leitstelle LIKE ? AND aktiv = 1;
              `);
              const row = stmt.get(wachen_nr);
              if (row === undefined) {
                throw `keine Wachennummer ${wachen_nr} (0) gefunden!`;
              } else {
                resolve(row);
              }
            }
            if (len == 2) {
              const stmt = db.prepare(`
                SELECT '2' length, nr_kreis nr, name_kreis name
                FROM waip_wachen
                WHERE nr_kreis LIKE ? AND aktiv = 1
                GROUP BY name_kreis LIMIT 1
              `);
              const row = stmt.get(wachen_nr);
              if (row === undefined) {
                throw `keine Wachennummer ${wachen_nr} (2) gefunden!`;
              } else {
                resolve(row);
              }
            }
            if (len == 4) {
              const stmt = db.prepare(`
                SELECT '4' length, nr_kreis || nr_traeger nr,
                  CASE
                    WHEN name_erweiterung = '' THEN name_traeger
                    ELSE CONCAT(name_traeger, ' [', name_erweiterung , ']'  )
                  END AS name
                FROM waip_wachen
                WHERE nr_kreis LIKE SUBSTR(?,-4, 2)
                  AND nr_traeger LIKE SUBSTR(?,-2, 2)
                  AND aktiv = 1
                GROUP BY name_traeger LIMIT 1;
              `);
              const row = stmt.get(wachen_nr, wachen_nr);
              if (row === undefined) {
                throw `keine Wachennummer ${wachen_nr} (4) gefunden!`;
              } else {
                resolve(row);
              }
            }
            if (len == 6) {
              const stmt = db.prepare(`
                SELECT '6' length, nr_wache nr, name_wache name
                FROM waip_wachen
                WHERE nr_wache LIKE ? AND aktiv = 1;
              `);
              const row = stmt.get(wachen_nr);
              if (row === undefined) {
                throw `keine Wachennummer ${wachen_nr} (6) gefunden!`;
              } else {
                resolve(row);
              }
            }
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Überprüfen der Wachennummer " + wachen_nr + ". " + error));
      }
    });
  };

  // Einsatzmittel-Daten speichern
  const db_einsatzmittel_update = (einsatzmittel_data) => {
    return new Promise((resolve, reject) => {
      try {
        // Variablen vorbereiten
        const itemsProcessed = 0;
        const arr_funkkenner = [];

        // alle Einsatzmittel per Schliefe in DB in Tabelle waip_einsatzmittel speichern
        einsatzmittel_data.einsatzmittel.forEach((item, index, array) => {
          // Bei Status 3 die Zeit für Ausrücken setzen
          if (item.fms_status == 3) {
            item.em_zeitstempel_ausgerueckt = item.fms_zeitstempel;
          } else {
            item.em_zeitstempel_ausgerueckt = null;
          }

          // Abfrage vorbereiten
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO waip_einsatzmittel (
              id, 
              zeitstempel,
              em_waip_einsaetze_id, 
              els_einsatznummer,
              em_funkrufname,
              em_kennzeichen,
              em_typ,
              em_bezeichnung,
              em_fmsstatus,
              em_wgs84_x,
              em_wgs84_y,
              em_issi,
              em_opta,
              em_radiochannel,
              em_station_id,
              em_station_nr,
              em_station_name,
              em_zeitstempel_ausgerueckt,
              em_zeitstempel_fms,
              em_staerke_els
            ) VALUES (
              (SELECT ID FROM waip_einsatzmittel WHERE em_funkrufname LIKE ?),
              DATETIME('now', 'localtime'), 
              (SELECT ID FROM waip_einsaetze WHERE els_einsatznummer LIKE ?),
              ?, 
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              (SELECT id FROM waip_wachen WHERE name_wache LIKE ? AND aktiv = 1),
              (SELECT nr_wache FROM waip_wachen WHERE name_wache LIKE ? AND aktiv = 1),
              ?,
              ?,
              ?
            );
          `);

          //Abfrage ausführen
          const info = stmt.run(
            item.funkrufname,
            item.einsatznummer,
            item.funkrufname,
            item.kennzeichen,
            item.typ,
            item.bezeichnung,
            item.fms_status,
            item.wgs84_x,
            item.wgs84_y,
            item.issi,
            item.opta,
            item.radiochannel,
            item.wachenname,
            item.wachenname,
            item.wachenname,
            Datetime_to_SQLiteDate(item.em_zeitstempel_ausgerueckt),
            Datetime_to_SQLiteDate(item.fms_zeitstempel),
            item.staerke
          );

          // item.funkrufname an arr_rmld_uuid anhängen
          arr_funkkenner.push(item.funkrufname);

          // Schleife erhoehen
          itemsProcessed++;

          // Schleife beenden
          if (itemsProcessed === array.length) {
            resolve(arr_funkkenner);
          }
        });
      } catch (error) {
        reject(new Error("Fehler beim Speichern der Einsatzmittel-Daten. " + error));
      }
    });
  };

  // Einsatzmittel in gesprochenen Rufnamen umwandeln
  const db_tts_einsatzmittel = (einsatzmittel_obj) => {
    return new Promise((resolve, reject) => {
      try {
        // normierte Schreibweise "xx xx 00/00-00" festlegen
        let schreibweise = /[\/]\d{2}[-]\d{2}/g;
        let funkrufnummern = einsatzmittel_obj.name.match(schreibweise);

        // Schreibweise überprüfen und ggf. Übersetzung ermitteln
        if (funkrufnummern) {
          // Einsatzmitteltyp ermitteln
          let typ = funkrufnummern.toString().substring(1, 3);
          // Einsatzmittel-Nr ermitteln
          let nr = funkrufnummern.toString().substring(4, 6);
          nr = nr.toString().replace(/^0+/, "");

          // hinterlegte Ersetzungen finden
          const stmt = db.prepare(`
            SELECT rp_output name 
            FROM waip_replace 
            WHERE rp_typ = 'em_tts' AND rp_input = ?;
          `);

          const row = stmt.get(typ);

          if (row === undefined) {
            einsatzmittel_obj.tts_text = einsatzmittel_obj.name;
            resolve(einsatzmittel_obj);
          } else {
            einsatzmittel_obj.tts_text = row.name + " " + nr;
            resolve(row.name + " " + nr);
          }
          // Funkkenner des Einsatzmittels in gesprochen Text umwandeln
        } else {
          einsatzmittel_obj.tts_text = einsatzmittel_obj.name;
          resolve(einsatzmittel_obj);
        }
      } catch (error) {
        reject(new Error(`Fehler beim Übersetzen des Funkrufnamens ${funkrufname} für Text-to-Speech.` + error));
      }
    });
  };

  // Textersetzsungen für Ortsdaten
  const db_tts_ortsdaten = (text) => {
    return new Promise((resolve, reject) => {
      try {
        // hinterlegte Ersetzungen aus DB laden
        const stmt = db.prepare(`
          SELECT rp_input, rp_output
          FROM waip_replace
          WHERE rp_typ = 'orte_tts';
        `);
        const row = stmt.all();

        if (row === undefined) {
          resolve(text);
        } else {
          // row durchgehen und prüfen ob rp_input in text enthalten, dann 1:1 durch rp_output ersetzen
          for (const replacement of row) {
            const regex = new RegExp(`${replacement.rp_input}`, "gi");
            text = text.replace(regex, replacement.rp_output);
          }
          resolve(text);
        }
      } catch (error) {
        reject(new Error(`Fehler beim Laden der Textersetzungen für Ortsdaten: ${error.message}`));
      }
    });
  };

  // Client-Status aktualisieren / speichern
  const db_client_update_status = (socket, client_status) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Socket ID
        let socket_id = socket.id;

        // Client-IP-Adressen aus Socket ermitteln und als Array speichern
        let client_ips = [];

        // IP-Adresse aus verschiedenen Headern ermitteln
        if (socket.handshake.headers["x-forwarded-for"]) {
          // X-Forwarded-For Header enthält die ursprüngliche Client-IP
          client_ips.push(socket.handshake.headers["x-forwarded-for"].split(",")[0].trim());
        }

        if (socket.handshake.headers["forwarded"]) {
          // Forwarded Header nach RFC 7239
          const forwarded = socket.handshake.headers["forwarded"];
          const forMatch = forwarded.match(/for=([^;]+)/);
          if (forMatch) {
            client_ips.push(forMatch[1].trim());
          }
        }

        // Direkte Socket-Verbindung als Fallback
        if (socket.handshake.address) {
          client_ips.push(socket.handshake.address);
        }

        // Duplikate entfernen und als String zusammenführen
        client_ips = [...new Set(client_ips)].join(", ");

        // Namespace ermitteln, im dem sich der Socket aktuelle befindet
        let client_nsp = socket.nsp.name;

        // Raum ermitteln, in dem sich der Socket aktuell befindet
        let client_room = null;
        let roomKeys = Array.from(socket.rooms);
        if (roomKeys.length > 1) {
          client_room = roomKeys[1];
        }

        // Standby wenn Client-Status keine Nummer oder Null
        if (isNaN(client_status) || client_status == null) {
          client_status = "Standby";
        }

        // Nutzername und Berechtigungen aus socket.data.user lesen (wird beim WAIP-Event
        // frisch aus der DB geladen und ist zuverlaessiger als socket.request.user).
        const client_user = socket.data && socket.data.user ? socket.data.user : null;
        const user_name = client_user && client_user.user ? client_user.user : "Gast";
        const user_permissions = client_user && client_user.permissions ? client_user.permissions : "keine";

        // User-Agent
        let user_agent = socket.request.headers["user-agent"];
        if (user_agent === undefined) {
          user_agent = "unbekannt";
        }

        // Reset-Zeitstempel in Abhängigkeit der Einstellungen ermitteln
        let reset_timestamp = null;

        if (client_status !== "Standby") {
          // User-ID aus socket.data.user lesen
          const user_id = socket.data && socket.data.user && socket.data.user.id ? socket.data.user.id : null;

          // Reset-Counter des Users ermitteln
          const stmt1 = db.prepare(`
            SELECT config_value FROM waip_user_config
            WHERE user_id = ? AND config_type = 'resetcounter';
          `);
          const row1 = stmt1.get(user_id);

          // Standard-Reset-Zeit aus app_cfg als Fallback
          let time_for_standby = app_cfg.global.default_time_for_standby;

          // Wenn ein benutzerdefinierter Reset-Counter vorhanden ist, diesen verwenden
          if (row1 !== undefined && row1.config_value) {
            time_for_standby = row1.config_value;
          }

          // prüfen ob der Zeitstempel des Einsatzes + Reset-Counter nicht über der aktuellen Uhrzeit liegt
          const stmt2 = db.prepare(`
            SELECT we.id, DATETIME(we.zeitstempel, ? || ' minutes') reset_time
            FROM waip_einsaetze we
            WHERE we.id = ? 
            AND DATETIME(we.zeitstempel, ? || ' minutes') > DATETIME('now', 'localtime');
          `);
          const row2 = stmt2.get(time_for_standby, client_status, time_for_standby);

          if (row2 === undefined) {
            reset_timestamp = null;
          } else {
            reset_timestamp = row2.reset_time;
          }
        }

        // Client-Status in DB speichern
        const stmt2 = db.prepare(`
          INSERT OR REPLACE INTO waip_clients (
            id, 
            socket_id, 
            client_ips,
            client_nsp, 
            client_room,
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
            ?,
            ?
          );        
        `);
        const info = stmt2.run(
          socket_id,
          socket_id,
          client_ips,
          client_nsp,
          client_room,
          client_status,
          user_name,
          user_permissions,
          user_agent,
          reset_timestamp
        );
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler bei Aktualisierung des Clientstatus. Status:" + client_status + error));
      }
    });
  };

  // Verbundene Clients ermitteln
  const db_client_get_connected = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_clients;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim abfragen der verbundenen Clients:" + error));
      }
    });
  };

  // Monitoring-Kennzahlen für Check_MK bereitstellen
  const db_monitoring_get_stats = () => {
    return new Promise((resolve, reject) => {
      try {
        const einsatz = db.prepare(`
          SELECT
            COUNT(*) AS total,
            CAST((JULIANDAY('now', 'localtime') - JULIANDAY(MAX(zeitstempel))) * 24 * 60 AS INTEGER) AS last_min
          FROM waip_einsaetze;
        `).get();

        const wachen = db.prepare(`
          SELECT COUNT(*) AS total, SUM(aktiv) AS active FROM waip_wachen;
        `).get();

        resolve({ einsatz, wachen });
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der Monitoring-Statistiken: " + error));
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
        reject(new Error("Fehler beim löschen eines Clients. " + socket + error));
      }
    });
  };

  // Pruefen ob für einen Client ein Einsatz vorhanden ist
  const db_client_check_waip_id = (socket_id, waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT client_status id FROM waip_clients WHERE socket_id LIKE ?;
        `);
        const row = stmt.get(socket_id);
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
        reject(new Error("Fehler bei Einsatzprüfung für einen Client. " + socket_id + waip_id + error));
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
          do_log = app_cfg.development.dev_log;
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
        reject(new Error("Fehler beim Schreiben eines Log-Eintrags. " + typ + text + error));
      }
    });
  };

  // letzten 10000 Log-Einträge abfragen
  const db_log_get_10000 = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_log ORDER BY id DESC LIMIT 10000;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der letzten Log-Einträge. " + error));
      }
    });
  };

  // Client-Eintrag per Socket-ID finden
  // TODO Abfrage wird derzeit nicht gebraucht, ggf. loeschen
  const db_socket_get_by_id = (socket_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_clients WHERE socket_id = ?;
        `);
        const row = stmt.get(socket_id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen eines Client-Eintrags über die Socket-ID. " + socket_id + error));
      }
    });
  };

  // Sockets (Clients) finden, die in den Standby gehen sollen
  const db_socket_get_all_to_standby = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT socket_id FROM waip_clients
          WHERE reset_timestamp < DATETIME('now', 'localtime');
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen Socket-IDs für Clients in Standby gehen sollen. " + error));
      }
    });
  };

  // Konfiguration der Anzeigezeit eines Users speichern
  const db_user_set_config_time = (user_id, reset_counter) => {
    return new Promise((resolve, reject) => {
      try {
        // reset_counter validieren, ansonsten auf default setzen
        if (!(reset_counter >= 1 && reset_counter <= app_cfg.global.time_to_delete_waip)) {
          reset_counter = app_cfg.global.default_time_for_standby;
        }
        // Anzeigezeit speichern
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO waip_user_config
          (id, user_id, config_type, config_value)
          VALUES (
            (SELECT id FROM waip_user_config WHERE user_id = ? AND config_type = 'resetcounter'),
            ?,
            ?,
            ?
          );
        `);
        const info = stmt.run(user_id, user_id, "resetcounter", reset_counter);
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim speichern / aktualisieren der Einstellung der Anzeigezeit eines Benutzers. " + reset_counter + error));
      }
    });
  };

  // Einstellungen eines Benutzers laden
  const db_user_get_config = (user_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 
            COALESCE(
              (SELECT config_value FROM waip_user_config WHERE user_id = ? AND config_type = 'resetcounter'), 
              ${app_cfg.global.default_time_for_standby}
            ) AS resetcounter;
        `);
        const row = stmt.get(user_id);
        resolve(row);
      } catch (error) {
        reject(new Error("Fehler beim laden von Benutzer-Einstellungen. " + error));
      }
    });
  };

  // Prüfen ob die Anzeigezeit für einen Benutzer abgelaufen ist
  const db_client_get_alarm_anzeigbar = (socket, waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        // Namespace ermitteln, im dem sich der Socket aktuelle befindet
        const client_nsp = socket.nsp.name;

        // Anzeigezeit für einen Alarmmonitor ermitteln
        if (client_nsp === "/waip") {
          // User-ID aus socket.data.user lesen
          const user_id = socket.data && socket.data.user && socket.data.user.id ? socket.data.user.id : null;

          // Reset-Counter des Users ermitteln
          const stmt1 = db.prepare(`
            SELECT config_value FROM waip_user_config
            WHERE user_id = ? AND config_type = 'resetcounter';
          `);
          let row1 = stmt1.get(user_id);

          // sollte kein Reset-Counter vorhanden sein, dann die Standard-Reset-Zeit aus app_cfg verwenden
          if (row1 == null) {
            // wenn row1 keine werte hat, das objekt config_value auf den default setzen
            row1 = {};
            row1.config_value = app_cfg.global.default_time_for_standby;
          }

          // prüfen ob der Zeitstempel des Einsatzes + Reset-Counter nicht über der aktuellen Uhrzeit liegt
          const stmt2 = db.prepare(`
            SELECT DATETIME(we.zeitstempel, ? || ' minutes') reset_time
            FROM waip_einsaetze we
            WHERE we.id = ? 
            AND DATETIME(we.zeitstempel, ? || ' minutes') > DATETIME('now', 'localtime');
          `);
          const row2 = stmt2.get(row1.config_value, waip_id, row1.config_value);

          // null zurückgeben, wenn der Einsatz nicht mehr angezeigt werden kann, ansonsten die Uhrzeit der Reset-Time
          if (row2 == null) {
            resolve(null);
          } else {
            resolve(row2.reset_time);
          }
        }

        // null zurückgeben, wenn kein Namespace ermittelt werden konnte
        resolve(null);
      } catch (error) {
        reject(new Error("Fehler beim Prüfen ob der Alarm für einen Nutzer angezeigt werden kann. " + waip_id + error));
      }
    });
  };

  // alle Benutzer laden
  const db_user_get_all = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, user, description, permissions, ip_address FROM waip_user;
        `);
        const rows = stmt.all();
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

  // Berechtigung eines Nutzers für einen Einsatz überpruefen
  const db_user_check_permission_for_waip = (socket, waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        // User-Daten aus socket.data.user lesen.
        // socket.data.user wird beim WAIP-Event in socket.js frisch aus der DB geladen
        // und ist damit unabhaengig vom Passport-Snapshot des WebSocket-Handshakes.
        // So werden Race Conditions vermieden, bei denen socket.request.user noch
        // nicht oder inkonsistent gesetzt war (z.B. kurz nach Verbindungsaufbau).
        const user = socket.data && socket.data.user ? socket.data.user : null;
        const user_id = user && user.id ? user.id : null;
        const permissions = user && user.permissions ? user.permissions : null;

        // wenn keine user_id oder permissions vorhanden, kein Recht
        if (!user_id || !permissions) {
          resolve(false);
          return;
        }

        // wenn admin, dann true, ansonsten Berechtigung abfragen
        if (permissions == "admin") {
          resolve(true);
        } else {
          // Berechtigungen aus DB abfragen -> 4,52,62,6690,....
          const stmt = db.prepare(`
            SELECT GROUP_CONCAT(DISTINCT wa.nr_wache) || ',' || GROUP_CONCAT(DISTINCT wa.nr_leitstelle) wache FROM waip_einsatzmittel em
            LEFT JOIN waip_wachen wa ON wa.id = em.em_station_id
            WHERE em_waip_einsaetze_id = ?;
          `);
          const row = stmt.get(waip_id);
          // keine Wache für Benutzer hinterlegt oder alle Stationen unbekannt, dann false
          if (row === undefined || row.wache === null || row.wache === undefined) {
            resolve(false);
          } else {
            // Berechtigungen mit Wache vergleichen, wenn gefunden, dann true, sonst false
            let permission_arr = permissions.split(",");
            const found = permission_arr.some((r) => row.wache.search(RegExp("," + r + "|\\b" + r)) >= 0);
            if (found) {
              resolve(true);
            } else {
              resolve(false);
            }
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Überprüfen der Berechtigungen eines Benutzers für einen Einsatz. " + (socket.data.user || "kein User") + " " + waip_id + " " + error));
      }
    });
  };

  // Berechtigung eines Nutzer für eine Rückmeldung überpruefen
  const db_user_check_permission_for_rmld = (socket, wache_nr) => {
    return new Promise((resolve, reject) => {
      try {
        // User-ID und Berechtigung aus Socket ermitteln
        const user_id = socket.data && socket.data.user && socket.data.user.id ? socket.data.user.id : null;
        let permissions = socket.data && socket.data.user && socket.data.user.permissions ? socket.data.user.permissions : null;

        // wenn keine user_id oder permissions übergeben wurden, dann false
        if (!user_id || !permissions) {
          resolve(false);
          return;
        }

        // wenn admin, dann true, ansonsten Berechtigung abfragen
        if (permissions == "admin") {
          resolve(true);
        } else {
          // keine Wache für Benutzer hinterlegt, dann false
          if (wache_nr === undefined) {
            resolve(false);
          } else {
            // wenn in den Berechtigungen eine Leitstellen-nummer vorhanden ist (1-5) dann muss user.permission um die Nummern der Landkreise ergänzt werden
            if (permissions.match(/^[1-5]$/)) {
              // permission.match in variable speichern
              const matched_permission = permissions.match(/^[1-5]$/)[0];

              // Nummern der Kreise für Leitstelle aus DB laden, entsprechend der matched_permission
              const stmt = db.prepare(`
                SELECT GROUP_CONCAT(DISTINCT ww.nr_kreis) AS permission FROM waip_wachen ww
                WHERE ww.nr_leitstelle = ?;
              `);
              const row = stmt.get(matched_permission);
              if (row) {
                permissions += "," + row.permission;
              }
            }

            // Berechtigungen mit Wache vergleichen, wenn gefunden, dann true, sonst false
            let permission_arr = permissions.split(",");
            const found = permission_arr.some((r) => wache_nr.toString().search(RegExp("," + r + "|\\b" + r)) >= 0);
            if (found) {
              resolve(true);
            } else {
              resolve(false);
            }
          }
        }
      } catch (error) {
        reject(
          new Error("Fehler beim Überprüfen der Berechtigungen eines Benutzers für eine Rückmeldung. " + socket.id + " " + wache_nr + " " + error)
        );
      }
    });
  };

  const db_rmld_check_einsatz = (rmld_obj) => {
    return new Promise((resolve, reject) => {
      try {
        // UUID mittels Einsatznummer oder UUID abgleichen
        if (rmld_obj.einsatznummer && !rmld_obj.waip_uuid) {
          var stmt = db.prepare(`SELECT e.uuid FROM waip_einsaetze e WHERE e.els_einsatznummer = ? ;`);
          var parameter = rmld_obj.einsatznummer;
        } else {
          var stmt = db.prepare(`SELECT e.uuid FROM waip_einsaetze e WHERE e.uuid = ? ;`);
          var parameter = rmld_obj.waip_uuid;
        }
        const row = stmt.get(parameter);
        if (row === undefined) {
          resolve();
        } else {
          resolve(row.uuid);
        }
      } catch (error) {
        reject(new Error("Fehler beim Prüfen eines Einsatzes für eine Rückmeldung. " + rmld_obj + error));
      }
    });
  };

  const db_rmld_single_save = (rmld_obj) => {
    return new Promise((resolve, reject) => {
      try {
        // wenn keine Einsatznummer WAIP-Uuid gesetzt ist, einen Fehler ausgeben
        if (!rmld_obj.einsatznummer && !rmld_obj.waip_uuid) {
          throw "Einsatznummer oder WAIP-Uuid muss gesetzt sein!";
        }

        // if rmld_obj.response_alias is not set, then set to null
        if (!rmld_obj.response_alias) {
          rmld_obj.response_alias = null;
        }

        // if rmld_obj.rmld_address is not set, then set to null
        if (!rmld_obj.rmld_address) {
          rmld_obj.rmld_address = null;
        }

        // if rmld_obj.response_role is not set, then set to null
        if (!rmld_obj.response_role) {
          rmld_obj.response_role = null;
        }

        // Verschiedenen Funktionen innerhalb der Rückmeldungen auf 1 oder 0 setzen
        if (rmld_obj.response_capability_agt) {
          rmld_obj.response_capability_agt = 1;
        } else {
          rmld_obj.response_capability_agt = 0;
        }
        if (rmld_obj.response_capability_ma) {
          rmld_obj.response_capability_ma = 1;
        } else {
          rmld_obj.response_capability_ma = 0;
        }
        if (rmld_obj.response_capability_fzf) {
          rmld_obj.response_capability_fzf = 1;
        } else {
          rmld_obj.response_capability_fzf = 0;
        }
        if (rmld_obj.response_capability_med) {
          rmld_obj.response_capability_med = 1;
        } else {
          rmld_obj.response_capability_med = 0;
        }

        // if rmld_obj.time_arrival is not set, then set to null
        if (!rmld_obj.time_arrival) {
          rmld_obj.time_arrival = null;
        }

        // if rmld_obj.type_decision is not set, then set to null
        if (!rmld_obj.type_decision) {
          rmld_obj.type_decision = null;
        }

        // if rmld_obj.time_decision is not set, then set to null
        if (!rmld_obj.time_decision) {
          rmld_obj.time_decision = null;
        }

        // if rmld_obj.time_receive is not set, then set to null
        if (!rmld_obj.time_receive) {
          rmld_obj.time_receive = null;
        }

        // if rmld_obj.wache_nr is not set, then set to null
        if (!rmld_obj.wache_nr) {
          rmld_obj.wache_nr = null;
        }

        // if rmld_obj.wache_nr is number, convert to string
        if (typeof rmld_obj.wache_nr === "number") {
          rmld_obj.wache_nr = rmld_obj.wache_nr.toString();
        }

        let uuid_query;
        // wenn Einsatznummer aber keiner WAIP-Uuid gesetzt ist, dann Einsatznummer für Abfrage verwenden
        if (rmld_obj.einsatznummer && !rmld_obj.waip_uuid) {
          uuid_query = `(SELECT uuid FROM waip_einsaetze WHERE els_einsatznummer = '${rmld_obj.einsatznummer}')`;
        }
        // wenn WAIP-Uuid gesetzt ist, dann WAIP-Uuid für Abfrage verwenden
        if (rmld_obj.waip_uuid) {
          uuid_query = `'${rmld_obj.waip_uuid}'`;
        }

        // Abfrage für Insert / Replace vorbereiten
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO waip_rueckmeldungen (
              id, waip_uuid, rmld_uuid, rmld_alias, rmld_address, rmld_role, 
              rmld_capability_agt, rmld_capability_ma, rmld_capability_fzf, rmld_capability_med,
              time_receive, type_decision, time_decision, time_arrival, wache_id, wache_nr, wache_name)
            VALUES (
              (SELECT id FROM waip_rueckmeldungen WHERE rmld_uuid = ?),
              ${uuid_query},
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              (SELECT id FROM waip_wachen WHERE nr_wache = ?),
              (SELECT nr_wache FROM waip_wachen WHERE nr_wache = ?),
              (SELECT name_wache FROM waip_wachen WHERE nr_wache = ?)
            ); 
          `);

        // Daten in Datenbank speichern
        const info = stmt.run(
          rmld_obj.response_uuid,
          rmld_obj.response_uuid,
          rmld_obj.response_alias,
          rmld_obj.response_address,
          rmld_obj.response_role,
          rmld_obj.response_capability_agt,
          rmld_obj.response_capability_ma,
          rmld_obj.response_capability_fzf,
          rmld_obj.response_capability_med,
          rmld_obj.time_receive,
          rmld_obj.type_decision,
          rmld_obj.time_decision,
          rmld_obj.time_arrival,
          rmld_obj.wache_nr,
          rmld_obj.wache_nr,
          rmld_obj.wache_nr
        );

        resolve(rmld_obj.response_uuid);
      } catch (error) {
        reject(new Error("Fehler beim verarbeiten einer Rückmeldung. " + rmld_obj + error));
      }
    });
  };

  // bestimmte Rückmeldungen zu einem Einsatz einer Wache laden
  const db_rmlds_get_for_wache = (wachen_nr, waip_id, arr_rmld_uuid) => {
    return new Promise((resolve, reject) => {
      try {
        // wachen_nr muss 2, 4 oder 6 Zeichen lang sein
        let len = wachen_nr.toString().length;
        if (len != 1 && len != 2 && len != 4 && len != 6 && len == null) {
          throw `Wachennummer ${wachen_nr} hat keine valide Länge (1, 2, 4 oder 6)!`;
        }

        // Filter für Wachen-Nummer vorbereiten
        let wache_sql_filter = `AND wache_id IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE ${wachen_nr} || '%') `;

        // wenn wachen_nr 0, dann % fuer Abfrage festlegen
        if (parseInt(wachen_nr) == 0) {
          wache_sql_filter = `AND wache_id IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE '%') `;
        }

        // wenn die Wachen-ID 1 bis 5 ist, handelt es sich um eine Leitstelle
        if (wachen_nr.toString().length === 1 && parseInt(wachen_nr) >= 1 && parseInt(wachen_nr) <= 5) {
          wache_sql_filter = `AND wache_id IN (SELECT id FROM waip_wachen WHERE nr_leitstelle LIKE ${wachen_nr}) `;
        }

        // Abfrage für Rückmeldungen arr_rmld_uuid, in abhängigkeit ob arr_rmld_uuid gesetzt
        if (arr_rmld_uuid) {
          const stmt = db.prepare(`
            SELECT * 
            FROM waip_rueckmeldungen 
            WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE ID = ?)
            ${wache_sql_filter}
            AND type_decision = ? 
            AND rmld_uuid IN (SELECT value FROM json_each(?));
          `);

          const rows = stmt.all(waip_id, "accept", JSON.stringify(arr_rmld_uuid));

          if (rows.length === 0) {
            resolve(null);
          } else {
            resolve(rows);
          }
        } else {
          const stmt = db.prepare(`
            SELECT * 
            FROM waip_rueckmeldungen 
            WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE ID = ?)
            ${wache_sql_filter}
            AND type_decision = ? ;
          `);

          const rows = stmt.all(waip_id, "accept");

          if (rows.length === 0) {
            resolve(null);
          } else {
            resolve(rows);
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim laden von Rückmeldungen. " + wachen_nr + waip_id + arr_rmld_uuid + error));
      }
    });
  };

  // Benutzer-Objekt für Authorisierung aus der Datenbank laden
  const auth_deserializeUser = (id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 
            id, 
            user, 
            permissions,
            (SELECT config_value FROM waip_user_config WHERE user_id = ? AND config_type = 'resetcounter') reset_counter
          FROM waip_user 
          WHERE id = ?;
        `);
        const row = stmt.get(id, id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_deserializeUser. " + id + error));
      }
    });
  };

  // Authorisierung über IP-Adresse
  const auth_ipstrategy = (profile_ip) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT user, id FROM waip_user WHERE ip_address = ?;
        `);
        const row = stmt.get(profile_ip);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_ipstrategy. " + profile_ip + error));
      }
    });
  };

  // Abfrage des verschlüsselten Passwords zum Abgleich
  const auth_localstrategy_cryptpassword = (user) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT password FROM waip_user WHERE user = ?;
        `);
        const row = stmt.get(user);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_localstrategy_cryptpassword. " + user + error));
      }
    });
  };

  // User und Id für Authorisierung
  const auth_localstrategy_userid = (user) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT user, id FROM waip_user WHERE user = ?;
        `);
        const row = stmt.get(user);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_localstrategy_userid. " + user + error));
      }
    });
  };

  // Authorisierung mittels Client-Zertifikat (CN)
  const auth_certstrategy_userid = (cn) => {
    return new Promise(async (resolve, reject) => {
      try {
        const auth_regex = app_cfg.global.authRegex || "([a-zA-Z0-9_.-]+)"; // Default Regex falls nicht gesetzt
        const a_regex = new RegExp(auth_regex);
        const a_match = cn.match(a_regex);

        if (!a_match) {
          // Abbruch, Nutzername nicht ermittelbar
          resolve(null);
        } else {
          // prüfen ob CN als User bereits in Datenbank enthalten ist
          const user_name = a_match[0];

          // User aus DB abfragen
          const user_obj = await auth_localstrategy_userid(user_name);

          if (user_obj !== null) {
            // User in DB gefunden, zurückgeben
            resolve(user_obj);
          } else {
            // User nicht in DB gefunden, neuen User anlegen
            let permissions = "keine";

            // Berechtigung aus CN ermitteln
            const rights_regex = app_cfg.global.rightsRegex || "([a-zA-Z0-9_.-]+)"; // Default Regex falls nicht gesetzt
            const r_regex = new RegExp(rights_regex);
            const r_match = cn.match(r_regex);
            // Berechtigung setzen
            if (r_match) {
              permissions = r_match[1];
            }

            // User anlegen
            await auth_create_new_user(user_name, null, "Nutzer mit Zertifikat", permissions, null);

            // User-Objekt abfragen
            const user_obj = await auth_localstrategy_userid(user_name);

            // User zurueckgeben
            resolve(user_obj);
          }
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_certstrategy_userid. " + cn + error));
      }
    });
  };

  // sicherstellen das User Rechte für die API hat
  const auth_ensureApi = (id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT permissions FROM waip_user WHERE id = ?;
        `);
        const row = stmt.get(id);

        if (row === undefined) {
          resolve(false);
        } else {
          if (row.permissions == "api") {
            resolve(true);
          } else {
            resolve(false);
          }
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_ensureApi. " + id + error));
      }
    });
  };

  // sicherstellen das User Admin-Rechte hat
  const auth_ensureAdmin = (id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT permissions FROM waip_user WHERE id = ?;
        `);
        const row = stmt.get(id);
        if (row === undefined) {
          resolve(false);
        } else {
          if (row.permissions == "admin") {
            resolve(true);
          } else {
            resolve(false);
          }
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_ensureAdmin. " + id + error));
      }
    });
  };

  // Neuen User anlegen
  const auth_create_new_user = (user, password, description, permissions, ip_address) => {
    return new Promise((resolve, reject) => {
      try {
        // Prüfen ob User bereits in Datenbank vorhanden
        const stmt1 = db.prepare(`
          SELECT user FROM waip_user WHERE user = ?
        `);
        const row1 = stmt1.get(user);

        // wenn User bereits vorhanden, dann Error ausgeben
        if (row1 !== undefined) {
          throw new Error("Es existiert bereits ein Benutzer mit diesem Namen! " + user);
        }

        const stmt2 = db.prepare(`
          INSERT INTO waip_user ( 
            user, 
            password,
            description,
            permissions, 
            ip_address 
          ) VALUES ( 
            ?, 
            ?, 
            ?, 
            ?, 
            ? 
          );
        `);
        const info = stmt2.run(user, password, description, permissions, ip_address);
        resolve(info.lastInsertRowid);
      } catch (error) {
        reject(new Error("Fehler beim Anlegen eines neuen Users. " + user + error));
      }
    });
  };

  // einen Nutzer aus der Datebank löschen
  const auth_deleteUser = (user_id) => {
    return new Promise((resolve, reject) => {
      try {
        // Credentials loeschen
        const stmt1 = db.prepare(`
          DELETE FROM waip_user_credentials WHERE user_id = ?;
        `);
        stmt1.run(user_id);
        // Config loeschen
        const stmt2 = db.prepare(`
          DELETE FROM waip_user_config WHERE user_id = ?;
        `);
        stmt2.run(user_id);
        // Nutzer loeschen
        const stmt3 = db.prepare(`
          DELETE FROM waip_user WHERE id = ?;
        `);
        const info = stmt3.run(user_id);
        if (info === undefined) {
          resolve(null);
        } else {
          resolve(info.changes);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_deleteUser. " + user_id + error));
      }
    });
  };

  // einen Nutzer in der Datenbank bearbeiten
  const auth_editUser = (query) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(query);
        const row = stmt.run();
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_editUser. " + id + error));
      }
    });
  };

  // einen Nutzer in der Datenbank anhand seiner ID suchen
  const auth_getUser = (user_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, user, description FROM waip_user WHERE id = ?;
        `);
        const row = stmt.run(user_id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_getUser. " + user_id + error));
      }
    });
  };

  // die Alarmmonitore fuer einen Nutzer laden
  const db_get_user_waips = (user_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Permission fuer Nutzer laden
        const stmt = db.prepare(`
          SELECT permissions FROM waip_user WHERE id = ?;
        `);
        const user_permissions = stmt.get(user_id);
        if (user_permissions === undefined) {
          resolve(null);
        } else {
          let arr_user_waips = [];
          let has_waips = false;
          // wenn user_permissions nur eine Nummer ist, dann diese als Array zurückgeben
          if (user_permissions.permissions.match(/^[0-9]+$/)) {
            arr_user_waips.push(user_permissions);
            has_waips = true;
          }
          // wenn user_permissions mehrere Nummern sind, dann diese als Array zurückgeben
          if (user_permissions.permissions.match(/^[0-9,]+$/)) {
            arr_user_waips = user_permissions.permissions.split(",");
            has_waips = true;
          }
          if (has_waips) {
            // alle Wachen laden
            const alle_wachen = await db_wache_get_all();

            // alle_wachen enthält unteranderem nr_wache, nr_leitstelle, nr_kreis
            // alle_wachen reduzieren um die Wachen-Nummern, welche in arr_user_waips enthalten sind
            const rows = alle_wachen.filter((wache) => {
              return arr_user_waips.some((r) => {
                if (r.length === 1) {
                  // wenn r nur eine Zahl (1-5) dann genau nur diese Zahl vergleichen, sonst startsWith
                  return wache.nr === r;
                }
                // wenn r mehr als eine Zahl, dann mit startsWith vergleichen (12, 123, 1234, 12345, 123456)
                return wache.nr.startsWith(r);
              });
            });
            // gefilterte Wachen zurückgeben
            resolve(rows);
          } else {
            // null zurückgeben wenn kein Wachenrecht gefunden
            resolve(null);
          }
        }
      } catch (error) {
        reject(new Error("Fehler bei db_get_user_waips. " + user_id + error));
      }
    });
  };

  // die Einsaetze fuer einen Nutzer laden
  const db_get_user_dbrds = (user_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Permission fuer Nutzer laden
        const stmt = db.prepare(`
          SELECT permissions FROM waip_user WHERE id = ?;
        `);
        const user_permissions = stmt.get(user_id);
        if (user_permissions === undefined) {
          resolve(null);
        } else {
          let arr_user_waips = [];
          let has_waips = false;
          // wenn user_permissions nur eine Nummer ist, dann diese als Array zurückgeben
          if (user_permissions.permissions.match(/^[0-9]+$/)) {
            arr_user_waips.push(user_permissions);
            has_waips = true;
          }
          // wenn user_permissions mehrere Nummern sind, dann diese als Array zurückgeben
          if (user_permissions.permissions.match(/^[0-9,]+$/)) {
            arr_user_waips = user_permissions.permissions.split(",");
            has_waips = true;
          }
          if (has_waips) {
            // alle vorhanden Einsätze laden
            const alle_einsaetze = await db_einsatz_get_active();

            if (alle_einsaetze) {
              // alle Einsaetze entfernen die nicht zur Berechtigung des Users passen
              const einsatz_l = alle_einsaetze.filter((einsatz) => {
                return arr_user_waips.some((r) => {
                  return einsatz.l === r;
                });
              });
              const einsatz_a = alle_einsaetze.filter((einsatz) => {
                return arr_user_waips.some((r) => {
                  return einsatz.a === r;
                });
              });
              const einsatz_b = alle_einsaetze.filter((einsatz) => {
                return arr_user_waips.some((r) => {
                  return einsatz.b === r;
                });
              });
              const einsatz_c = alle_einsaetze.filter((einsatz) => {
                return arr_user_waips.some((r) => {
                  return einsatz.c === r;
                });
              });
              // übergebe alle einsätze die rausgefiltert wurden
              resolve([...new Set([...einsatz_l, ...einsatz_a, ...einsatz_b, ...einsatz_c])]);
            } else {
              resolve(null);
            }
          } else {
            // null zurückgeben wenn kein Wachenrecht gefunden
            resolve(null);
          }
        }
      } catch (error) {
        reject(new Error("Fehler bei db_get_user_dbrds. " + user_id + error));
      }
    });
  };

  // Alle Wachen laden
  const db_wachen_get_all_full = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`SELECT * FROM waip_wachen ORDER BY nr_wache ASC;`);
        const rows = stmt.all();
        resolve(rows);
      } catch (error) {
        reject(new Error("Fehler beim Laden aller Wachen. " + error));
      }
    });
  };

  // Wache bearbeiten
  const db_wache_update = (wache) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
        UPDATE waip_wachen SET
          nr_leitstelle = ?,
          name_leitstelle = ?,
          kfz_leitstelle = ?,
          nr_wache = ?,
          name_wache = ?,
          nr_kreis = ?,
          name_kreis = ?,
          kfz_kreis = ?,
          nr_traeger = ?,
          name_traeger = ?,
          nr_standort = ?,
          nr_abteilung = ?,
          name_beschreibung = ?,
          name_erweiterung = ?,
          wgs84_x = ?,
          wgs84_y = ?,
          aktiv = ?
        WHERE id = ?;
      `);
        const info = stmt.run(
          wache.nr_leitstelle,
          wache.name_leitstelle,
          wache.kfz_leitstelle,
          wache.nr_wache,
          wache.name_wache,
          wache.nr_kreis,
          wache.name_kreis,
          wache.kfz_kreis,
          wache.nr_traeger,
          wache.name_traeger,
          wache.nr_standort,
          wache.nr_abteilung,
          wache.name_beschreibung,
          wache.name_erweiterung,
          wache.wgs84_x,
          wache.wgs84_y,
          wache.aktiv === "on" ? 1 : 0,
          wache.id
        );
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim Bearbeiten der Wache. " + error));
      }
    });
  };

  // Wache löschen
  const db_wache_delete = (id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`DELETE FROM waip_wachen WHERE id = ?;`);
        const info = stmt.run(id);
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim Löschen der Wache. " + error));
      }
    });
  };

  // Neue Wache anlegen
  const db_wache_create = (wache) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
        INSERT INTO waip_wachen (
          nr_leitstelle,
          name_leitstelle,
          kfz_leitstelle,
          nr_wache,
          name_wache,
          nr_kreis,
          name_kreis,
          kfz_kreis,
          nr_traeger,
          name_traeger,
          nr_standort,
          nr_abteilung,
          name_beschreibung,
          wgs84_x,
          wgs84_y,
          aktiv
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        );
      `);
        const info = stmt.run(
          wache.nr_leitstelle,
          wache.name_leitstelle,
          wache.kfz_leitstelle,
          wache.nr_wache,
          wache.name_wache,
          wache.nr_kreis,
          wache.name_kreis,
          wache.kfz_kreis,
          wache.nr_traeger,
          wache.name_traeger,
          wache.nr_standort,
          wache.nr_abteilung,
          wache.name_beschreibung,
          wache.wgs84_x,
          wache.wgs84_y,
          wache.aktiv === "on" ? 1 : 0
        );
        resolve(info.lastInsertRowid);
      } catch (error) {
        reject(new Error("Fehler beim Anlegen einer neuen Wache. " + error));
      }
    });
  };

  return {
    db_alarmdaten_filter_aktiv,
    db_einsatz_speichern,
    db_einsatz_for_client_ermitteln,
    db_einsatz_check_uuid,
    db_einsatz_check_history,
    db_einsatz_get_for_wache,
    db_einsatz_get_by_uuid,
    db_einsatz_get_uuid_by_enr,
    db_einsatz_get_waipid_by_uuid,
    db_einsatz_get_active,
    db_einsatz_get_waip_rooms,
    db_einsaetze_get_old,
    db_einsatz_statusupdate,
    db_einsatz_loeschen,
    db_wache_get_all,
    db_wache_vorhanden,
    db_einsatzmittel_update,
    db_tts_einsatzmittel,
    db_tts_ortsdaten,
    db_client_update_status,
    db_client_get_connected,
    db_monitoring_get_stats,
    db_client_delete,
    db_client_check_waip_id,
    db_log,
    db_log_get_10000,
    db_socket_get_by_id,
    db_socket_get_all_to_standby,
    db_user_set_config_time,
    db_user_get_config,
    db_user_get_all,
    db_client_get_alarm_anzeigbar,
    db_user_check_permission_for_waip,
    db_user_check_permission_for_rmld,
    db_rmld_check_einsatz,
    db_rmld_single_save,
    db_rmlds_get_for_wache,
    auth_deserializeUser,
    auth_ipstrategy,
    auth_localstrategy_cryptpassword,
    auth_localstrategy_userid,
    auth_certstrategy_userid,
    auth_ensureApi,
    auth_ensureAdmin,
    auth_create_new_user,
    auth_deleteUser,
    auth_editUser,
    auth_getUser,
    db_get_user_waips,
    db_get_user_dbrds,
    db_wachen_get_all_full,
    db_wache_update,
    db_wache_delete,
    db_wache_create,
    db_routen_stationen_get,
    db_route_speichern,
    db_routen_get,
    db_einsatz_get_uuid_by_id,
  };
};
