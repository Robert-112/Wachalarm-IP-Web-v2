module.exports = (io, sql, fs, logger, app_cfg) => {
  // Module laden
  const { parse } = require("json2csv");
  const async = require("async");
  const nodemailer = require("nodemailer");
  let proc = require("child_process");

  const waip_speichern = (einsatz_daten) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Roh-Einsatzdaten  in Datenbank speichern und ID des Einsatzes zurückbekommen
        const waip_id = await sql.db_einsatz_speichern(einsatz_daten);
        logger.db_log("waip", `Neuen Einsatz mit der ID ${waip_id} gespeichert.`);

        // nach dem Speichern anhand der waip_id die beteiligten Wachennummern / Socket-Räume zum Einsatz ermitteln
        const waip_raeume = await sql.db_einsatz_get_rooms(waip_id);

        // waip_rooms muss größer 1 sein, da sonst nur der Standard-Raum '0' vorhanden ist
        if (waip_raeume.length > 1) {
          waip_raeume.forEach(async (waip_raum) => {
            // fuer jeden Websocket-Raum (z.B. Wache oder Träger) die verbundenen Sockets(Clients) ermitteln  
            const sockets = await io.of("/waip").in(waip_raum).fetchSockets();          
            sockets.forEach((socket) => {
              // Einsatzdaten an Client senden
              waip_verteilen(waip_id, socket, waip_raum);
              logger.db_log("waip", `Einsatz ${waip_id} wird an ${socket.id} (${waip_raum}) gesendet.`);
            });
          });
        } else {
          // wenn kein Raum (keine Wache) ausser '0' zurueckgeliefert wird, dann Einsatz direkt wieder loeschen weil keine Wachen dazu hinterlegt
          logger.log("warn", `Keine Wache für den Einsatz mit der ID ${waip_id} vorhanden! Einsatz wird gelöscht!`);
          // FIXME db_einsatz_loeschen liefert die Anzahl der gelöschten Daten zurück, hier beachten
          sql.db_einsatz_loeschen(waip_id);
        }
      } catch (error) {
        reject(new Error("Fehler beim Speichern der Waip-Einsatzdaten. " + error));
      }
    });
  };

  const waip_verteilen = (waip_id, socket, wachen_nr) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Einsatzdaten für eine Wache aus Datenbank laden und an Client verteilen
        let user_obj = socket.request.user;

        const einsatzdaten = await sql.db_einsatz_get_by_waipid(waip_id, wachen_nr, user_obj.id);

        if (!einsatzdaten) {
          // wenn keine Einsatzdaten, dann Standby senden
          socket.emit("io.standby", null);
          sql.db_client_update_status(socket, null);
          logger.db_log("waip", `Kein Einsatz für Wache ${wachen_nr} vorhanden, Standby an Socket ${socket.id} gesendet.`);
        } else {
          // Berechtigung des Users ueberpruefen
          const valid = await sql.db_user_check_permission(user_obj, waip_id);

          // Wenn nutzer nicht angemeldet, Daten entfernen
          if (!valid) {
            einsatzdaten.objekt = "";
            einsatzdaten.besonderheiten = "";
            einsatzdaten.strasse = "";
            einsatzdaten.wgs84_x = "";
            einsatzdaten.wgs84_y = "";
          }

          // pruefen ob Einsatz bereits genau so beim Client angezeigt wurde (Doppelalarmierung)
          const result = await sql.db_einsatz_check_history(waip_id, einsatzdaten, socket.id);

          if (!result) {
            // Einsatz an Client senden
            socket.emit("io.new_waip", einsatzdaten);

            // Protokollieren
            logger.db_log("waip", `Einsatz ${waip_id} für Wache ${wachen_nr} an Socket ${socket.id} gesendet.`);
        
            sql.db_client_update_status(socket, waip_id);

            // Sound erstellen
            const tts = await tts_erstellen(app_cfg, socket.id, einsatzdaten);
            if (tts) {
              // Sound-Link senden
              socket.emit("io.playtts", tts);
              logger.log("log", `ttsfile ${tts}`);
            }
          } else {
            // Log das Einsatz explizit nicht an Client gesendet wurde
            logger.db_log("waip", `Einsatz ${waip_id} für Wache ${wachen_nr} nicht an Socket ${socket.id} gesendet, da bereits angezeigt (Doppelalarmierung).`);
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Verteilen der Waip-Einsatzdaten. " + error));
      }
    });
  };

  const rmld_verteilen_by_uuid = (waip_uuid, rmld_uuid) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Einsatz-ID mittels Einsatz-UUID ermitteln
        const waip_id = await sql.db_einsatz_get_waipid_by_uuid(waip_uuid);

        // am Einsatz beteiligte Socket-Räume ermitteln
        const socket_rooms = await sql.db_einsatz_get_rooms(waip_id);

        // Rückmeldungen an alle relevanten Alarmmonitore verteilen
        if (socket_rooms) {
          socket_rooms.forEach((row) => {
            // fuer jede Wache(row.room) die verbundenen Sockets(Clients) ermitteln
            let room_sockets = io.nsps["/waip"].adapter.rooms[row.room];

            if (typeof room_sockets !== "undefined") {
              // an jeden Socket in Rückmeldung senden
              Object.keys(room_sockets.sockets).forEach(async (socket_id) => {
                // wenn Raum zum Einsatz aufgerufen ist, dann Rueckmeldung aus DB laden und an diesen versenden
                const rmld_obj = await sql.db_rmld_get_by_rmlduuid(rmld_uuid);
                if (rmld_obj) {
                  // Rückmeldung an Clients/Räume senden, wenn richtiger Einsatz angezeigt wird
                  const same_id = await sql.db_client_check_waip_id(socket_id, waip_id);
                  if (same_id) {
                    let socket = io.of("/waip").connected[socket_id];
                    socket.emit("io.new_rmld", rmld_obj);
                    const logMessage1 = `Rückmeldung ${rmld_uuid} für den Einsatz mit der ID ${waip_id} an Wache ${row.room} gesendet.`;
                    sql.db_log("RMLD", logMessage1);
                    const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(rmld_obj)}`;
                    sql.db_log("DEBUG", logMessage2);
                  }
                }
              });
            }
          });
        }

        // Dashboards ermitteln, welche den Einsatz geladen haben
        const dbrd_sockets = await sql.db_socket_get_dbrd(waip_id);

        if (dbrd_sockets) {
          // Rueckmeldung auslesen
          const rmld_obj = await sql.db_rmld_get_by_rmlduuid(rmld_uuid);
          if (rmld_obj) {
            // Rückmeldung an Dashboards senden
            dbrd_sockets.forEach(function (row) {
              let socket = io.of("/dbrd").connected[row.socket_id];
              socket.emit("io.new_rmld", rmld_obj);
              const logMessage1 = `Rückmeldung ${rmld_uuid} für den Einsatz mit der ID ${waip_id} an Dashboard ${waip_uuid} gesendet.`;
              sql.db_log("RMLD", logMessage1);
              const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(rmld_obj)}`;
              sql.db_log("DEBUG", logMessage2);
            });
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Verteilen der Rückmeldungen für einen Einsatz. " + error));
      }
    });
  };

  const rmld_verteilen_for_one_client = (waip_id, socket, wachen_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Rueckmeldung an einen bestimmten Client senden
        if (typeof socket.id !== "undefined") {
          const rmld_obj = await sql.db_rmld_get_fuer_wache(waip_id, wachen_id);

          if (rmld_obj) {
            // Rueckmeldung nur an den einen Socket senden
            socket.emit("io.new_rmld", rmld_obj);
            const logMessage = `Vorhandene Rückmeldungen an Socket ${socket.id} gesendet.`;
            sql.db_log("RMLD", logMessage);
            const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(rmld_obj)}`;
            sql.db_log("DEBUG", logMessage2);
          } else {
            const logMessage = `Keine Rückmeldungen für Einsatz-ID ${waip_id} und Wachen-ID ${wachen_id} vorhanden.`;
            sql.db_log("RMLD", logMessage);
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Verteilen der Rückmeldungen für einen Client. " + error));
      }
    });
  };

  const dbrd_verteilen = (dbrd_uuid, socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Einsatzdaten laden
        const einsatzdaten = await sql.db_einsatz_get_by_uuid(dbrd_uuid);
        if (!einsatzdaten) {
          // Standby senden wenn Einsatz nicht vorhanden
          // BUG hier kein standby senden, sondern nicht vorhanden
          socket.emit("io.standby", null);
          const logMessage = `Der angefragte Einsatz ${dbrd_uuid} ist nicht - oder nicht mehr - vorhanden!, Standby an Socket ${socket.id} gesendet.`;
          sql.db_log("DBRD", logMessage);
          sql.db_client_update_status(socket, null);
        } else {
          const valid = await sql.db_user_check_permission(socket.request.user, einsatzdaten.id);
          // Daten entfernen wenn kann authentifizierter Nutzer
          if (!valid) {
            delete einsatzdaten.objekt;
            delete einsatzdaten.besonderheiten;
            delete einsatzdaten.strasse;
            delete einsatzdaten.wgs84_x;
            delete einsatzdaten.wgs84_y;
          }
          // Einsatzdaten senden
          socket.emit("io.Einsatz", einsatzdaten);
          // Rueckmeldungen verteilen
          rmld_verteilen_for_one_client(einsatzdaten.id, socket, 0);
          const logMessage = `Einsatzdaten für Dashboard ${dbrd_uuid} an Socket ${socket.id} gesendet`;
          sql.db_log("DBRD", logMessage);
          sql.db_client_update_status(socket, einsatzdaten.id);
        }
      } catch (error) {
        reject(new Error("Fehler beim Verteilen der Rückmeldungen für einen Client. " + error));
      }
    });
  };

  // TODO WAIP: Funktion um Clients remote "neuzustarten" (Seite neu laden), niedrige Prioritaet

  const tts_erstellen = (app_cfg, socket_id, einsatzdaten) => {
    return new Promise((resolve, reject) => {
      try {
        // unnoetige Zeichen aus socket_id entfernen, um diese als Dateinamen zu verwenden
        let id = socket_id.replace(/\W/g, "");
        // Pfade der Sound-Dateien defeinieren
        let wav_tts = process.cwd() + app_cfg.global.soundpath + id + ".wav";
        let mp3_tmp = process.cwd() + app_cfg.global.soundpath + id + "_tmp.mp3";
        let mp3_tts = process.cwd() + app_cfg.global.soundpath + id + ".mp3";
        let mp3_url = app_cfg.global.mediapath + id + ".mp3";
        // unterscheiden des Alarmgongs nach Einsatzart
        let mp3_bell;
        if (einsatzdaten.einsatzart == "Brandeinsatz" || einsatzdaten.einsatzart == "Hilfeleistungseinsatz") {
          mp3_bell = process.cwd() + app_cfg.global.soundpath + "bell_long.mp3";
        } else {
          mp3_bell = process.cwd() + app_cfg.global.soundpath + "bell_short.mp3";
        }
        // Zusammensetzen der Sprachansage
        // TODO db_tts_einsatzmittel -> Resolve bringt nur noch ein Argument!
        async.map(JSON.parse(einsatzdaten.em_alarmiert), sql.db_tts_einsatzmittel, (err, einsatzmittel) => {
          // Grunddaten
          let tts_text = einsatzdaten.einsatzart + ", " + einsatzdaten.stichwort;
          if (einsatzdaten.objekt) {
            tts_text = tts_text + ". " + einsatzdaten.objekt + ", " + einsatzdaten.ort + ", " + einsatzdaten.ortsteil;
          } else {
            tts_text = tts_text + ". " + einsatzdaten.ort + ", " + einsatzdaten.ortsteil;
          }
          // Einsatzmittel
          tts_text = tts_text + ". Für " + einsatzmittel.join(", ");
          // Unterscheidung nach Sondersignal
          if (einsatzdaten.sondersignal == 1) {
            tts_text = tts_text + ", mit Sondersignal";
          } else {
            tts_text = tts_text + ", ohne Sonderrechte";
          }
          // Abschluss
          tts_text = tts_text + ". Ende der Durchsage!";
          // ungewollte zeichen aus Sprachansage entfernen
          tts_text = tts_text.replace(/:/g, " ");
          tts_text = tts_text.replace(/\//g, " ");
          tts_text = tts_text.replace(/-/g, " ");
          // Sprachansage als mp3 erstellen
          switch (process.platform) {
            // Windows
            case "win32":
              // Powershell
              let pwshell_commands = [
                // TTS-Schnittstelle von Windows ansprechen
                "Add-Type -AssemblyName System.speech;" +
                  "$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
                  // Ausgabedatei und Sprachtext
                  '$speak.SetOutputToWaveFile("' +
                  wav_tts +
                  '");' +
                  '$speak.Speak("' +
                  tts_text +
                  '");' +
                  "$speak.Dispose();" +
                  // speak.wav in mp3 umwandeln
                  "ffmpeg -nostats -hide_banner -loglevel 0 -y -i " +
                  wav_tts +
                  " -vn -ar 44100 -ac 2 -ab 128k -f mp3 " +
                  mp3_tmp +
                  ";" +
                  // Gong und Ansage zu einer mp3 zusammensetzen
                  'ffmpeg -nostats -hide_banner -loglevel 0 -y -i "concat:' +
                  mp3_bell +
                  "|" +
                  mp3_tmp +
                  '" -acodec copy ' +
                  mp3_tts +
                  ";" +
                  "rm " +
                  wav_tts +
                  ";" +
                  "rm " +
                  mp3_tmp +
                  ";",
              ];
              let pwshell_options = {
                shell: true,
              };
              let pwshell_childD = proc.spawn("powershell", pwshell_commands);
              pwshell_childD.stdin.setEncoding("ascii");
              pwshell_childD.stderr.setEncoding("ascii");
              pwshell_childD.stderr.on("data", (data) => {
                sql.db_log("Fehler-TTS", data);
                reject(new Error("Fehler beim Erstellen der TTS-Datei", data));
              });
              pwshell_childD.on("exit", () => {
                resolve(mp3_url);
              });
              pwshell_childD.stdin.end();
              break;
            // LINUX
            case "linux":
              // bash
              let lxshell_commands = [
                // TTS-Schnittstelle SVOX PicoTTS
                "-c",
                `
                pico2wave --lang=de-DE --wave=` +
                  wav_tts +
                  ` \"` +
                  tts_text +
                  `\"
                ffmpeg -nostats -hide_banner -loglevel 0 -y -i ` +
                  wav_tts +
                  ` -vn -ar 44100 -ac 2 -ab 128k -f mp3 ` +
                  mp3_tmp +
                  `
                ffmpeg -nostats -hide_banner -loglevel 0 -y -i \"concat:` +
                  mp3_bell +
                  `|` +
                  mp3_tmp +
                  `\" -acodec copy ` +
                  mp3_tts +
                  `
                rm ` +
                  wav_tts +
                  `
                rm ` +
                  mp3_tmp,
              ];
              let lxshell_options = {
                shell: true,
              };
              logger.log("debug", `Erstellung der TTS-Datei: ${commands}`);
              let lxshell_childD = proc.spawn("/bin/sh", lxshell_commands);
              lxshell_childD.stdin.setEncoding("ascii");
              lxshell_childD.stderr.setEncoding("ascii");
              lxshell_childD.on("exit", (code, signal) => {
                if (code > 0) {
                  sql.db_log("Fehler-TTS", "Exit-Code " + code + "; Fehler beim erstellen der TTS-Datei");
                  reject(new Error("Fehler beim Erstellen der TTS-Datei", code));
                } else {
                  resolve(mp3_url);
                }
              });
              lxshell_childD.stdin.end();
              break;
            // anderes OS
            default:
              reject(new Error("TTS für dieses Server-Betriebssystem nicht verfügbar!"));
          }
        });
      } catch (error) {
        reject(new Error("Fehler beim Erstellen der TTS-Datei: " + error));
      }
    });
  };

  // Define a function to be executed every 10 seconds
  const system_cleanup = () => {
    // (alle 10 Sekunden)

    sql.db_socket_get_all_to_standby((socket_ids) => {
      // alle User-Einstellungen prüfen und ggf. Standby senden
      if (socket_ids) {
        socket_ids.forEach((row) => {
          let socket = io.of("/waip").connected[row.socket_id];
          if (typeof socket !== "undefined") {
            socket.emit("io.standby", null);
            socket.emit("io.stopaudio", null);
            sql.db_log("WAIP", `Standby an Socket ${socket.id} gesendet`);
            sql.db_client_update_status(socket, null);
          }
        });
      }
    });

    sql.db_einsaetze_get_old(app_cfg.global.time_to_delete_waip, (old_waips) => {
      // FIXME war zuvor eine Schleife die zurückgeliefert wurde!!!!
      // wurde in Version 2 geändert in ein Object, welches jetzt hier in einer Schleife abzuarbeiten ist

      // nach alten Einsaetzen suchen und diese ggf. loeschen
      if (old_waips) {
        // iterate trough old_waips with for each
        old_waips.forEach((waip) => {
          // Einsatz mit der ID "waip.id" ist veraltet und kann gelöscht werden

          sql.db_log("WAIP", `Einsatz mit der ID ${waip.id} ist veraltet und kann gelöscht werden.`);
          // Dashboards trennen, deren Einsatz geloescht wurde
          sql.db_socket_get_dbrd(waip.id, (socket_ids) => {
            // TODO TEST: Dashboard-Trennen-Funktion testen
            if (socket_ids) {
              socket_ids.forEach((row) => {
                let socket = io.of("/dbrd").connected[row.socket_id];
                if (typeof socket !== "undefined") {
                  socket.emit("io.deleted", null);
                  sql.db_log("DBRD", `Dashboard mit dem Socket ${socket.id} getrennt, da Einsatz gelöscht.`);
                  sql.db_client_update_status(socket, null);
                }
              });
            }
          });

          // beteiligte Wachen zum Einsatz ermitteln
          sql.db_einsatz_get_rooms(waip.id, (data) => {
            if (data) {
              data.forEach((row) => {
                // fuer jede Wache (row.room) die verbundenen Sockets(Clients) ermitteln und Standby senden
                let room_sockets = io.nsps["/waip"].adapter.rooms[row.room];
                if (typeof room_sockets !== "undefined") {
                  Object.keys(room_sockets.sockets).forEach((socket_id) => {
                    // Standby senden
                    let socket = io.of("/waip").connected[socket_id];
                    sql.db_client_check_waip_id(socket.id, waip.id, (same_id) => {
                      if (same_id) {
                        socket.emit("io.standby", null);
                        socket.emit("io.stopaudio", null);
                        sql.db_log("WAIP", "Standby an Socket " + socket.id + " gesendet");
                        sql.db_client_update_status(socket, null);
                      }
                    });
                  });
                }
              });
            }
          });

          sql.db_export_get_rmld(waip.einsatznummer, waip.uuid, (full_rmld) => {
            // beteiligte Wachen aus den Einsatz-Rueckmeldungen filtern
            let arry_wachen = full_rmld.map((a) => a.wache_nr);
            logger.log("debug", "Export-Liste RMLD: " + JSON.stringify(arry_wachen));
            sql.db_export_get_recipient(arry_wachen, (export_data) => {
              // SQL gibt ist eine Schliefe (db.each), fuer jedes Ergebnis wird eine CSV/Mail erstellt
              if (export_data) {
                // je Export eine CSV erstellen, die nur die gewuenschten Rueckmeldungen enthaelt
                let part_rmld = full_rmld.filter((obj) => String(obj.wache_nr).startsWith(String(export_data.export_filter)));
                // CSV-Spalten definieren
                let csv_col = [
                  "id",
                  "einsatznummer",
                  "waip_uuid",
                  "rmld_uuid",
                  "alias",
                  "einsatzkraft",
                  "maschinist",
                  "fuehrungskraft",
                  "agt",
                  "set_time",
                  "arrival_time",
                  "wache_id",
                  "wache_nr",
                  "wache_name",
                ];
                let opts = {
                  csv_col,
                };
                try {
                  let csv = parse(part_rmld, opts);
                  // CSV Dateiname und Pfad festlegen
                  let csv_filename = export_data.export_name.replace(/[|&;$%@"<>()+,]/g, "");
                  csv_filename = csv_filename.replace(/ /g, "_");
                  csv_filename = "einsatz_" + part_rmld[0].einsatznummer + "_export_" + csv_filename + ".csv";
                  csv_path = process.cwd() + app_cfg.rmld.backup_path;
                  // CSV in Backup-Ordner speichern, falls aktiviert
                  if (app_cfg.rmld.backup_to_file) {
                    // Ordner erstellen
                    fs.mkdir(
                      csv_path,
                      {
                        recursive: true,
                      },
                      (err) => {
                        if (err) {
                          sql.db_log("EXPORT", "Fehler beim Erstellen des Backup-Ordners: " + err);
                        }
                        // CSV speichern
                        fs.writeFile(csv_path + csv_filename, csv, (err) => {
                          if (err) {
                            sql.db_log("EXPORT", "Fehler beim speichern der Export-CSV: " + err);
                          }
                        });
                      }
                    );
                  }
                  // CSV per Mail versenden, falls aktiviert
                  if (app_cfg.rmld.backup_to_mail) {
                    // pruefen ob Mail plausibel ist
                    let validmail = /\S+@\S+\.\S+/;
                    if (validmail.test(export_data.export_recipient)) {
                      // Mail-Server
                      let transport = nodemailer.createTransport({
                        host: app_cfg.rmld.mailserver_host,
                        port: app_cfg.rmld.mailserver_port,
                        secure: app_cfg.rmld.secure_mail,
                        auth: {
                          user: app_cfg.rmld.mail_user,
                          pass: app_cfg.rmld.mail_pass,
                        },
                        tls: {
                          rejectUnauthorized: app_cfg.rmld.unauthorized_mail,
                        },
                      });
                      let mail_message = {
                        from: "Wachalarm-IP-Web <" + app_cfg.rmld.mail_from + ">",
                        to: export_data.export_recipient,
                        subject: "Automatischer Export Wachalarm-IP-Web - " + export_data.export_name + " - Einsatz " + part_rmld[0].einsatznummer,
                        html:
                          "Hallo,<br><br>anbei der automatische Export aller Einsatz-R&uuml;ckmeldungen f&uuml;r den Einsatz " +
                          part_rmld[0].einsatznummer +
                          "<br><br>Mit freundlichen Gr&uuml;&szlig;en<br><br>" +
                          app_cfg.public.company +
                          "<br>",
                        attachments: [
                          {
                            filename: csv_filename,
                            content: csv,
                          },
                        ],
                      };
                      transport.sendMail(mail_message, (err, info) => {
                        if (err) {
                          sql.db_log("EXPORT", "Fehler beim senden der Export-Mail an " + export_data.export_recipient + ": " + err);
                        } else {
                          sql.db_log("EXPORT", "Mail an " + export_data.export_recipient + " gesendet: " + JSON.stringify(info));
                        }
                      });
                    } else {
                      sql.db_log("EXPORT", "Fehler beim versenden der Export-Mail an " + export_data.export_recipient + " - keine richtige Mail-Adresse!");
                    }
                  }
                } catch (err) {
                  sql.db_log("EXPORT", "Fehler beim erstellen der Export-CSV: " + err);
                }
              }
            });

            // alte Rueckmeldungen loeschen
            sql.db_rmld_loeschen(waip.uuid);
            sql.db_log("WAIP", `Rückmeldungen zu Einsatz ${waip.id} gelöscht.`);

            // alten Einsatz loeschen
            // FIXME db_einsatz_loeschen liefert die Anzahl der gelöschten Daten zurück, hier beachten
            sql.db_einsatz_loeschen(waip.id);
            sql.db_log("WAIP", `Einsatz-Daten zu Einsatz ${waip.id} gelöscht.`);
          });
        });
      }
    });

    // loeschen alter Sounddaten nach alter (15min) und socket-id (nicht mehr verbunden)
    fs.readdirSync(process.cwd() + app_cfg.global.soundpath).forEach((file) => {
      // nur die mp3s von alten clients loeschen
      if (file.substring(0, 4) != "bell" && file.substring(file.length - 3) == "mp3" && file.substring(file.length - 8) != "_tmp.mp3") {
        // Socket-ID aus Datei-Namen extrahieren
        socket_name = file.substring(0, file.length - 4);
        // Socket-ID anpassen, damit die SQL-Abfrage ein Ergebnis liefert
        socket_name = socket_name.replace("waip", "/waip#");
        sql.db_socket_get_by_id(socket_name, (data) => {
          if (!data) {
            fs.unlink(process.cwd() + app_cfg.global.soundpath + file, (err) => {
              if (err) return sql.db_log("Fehler-WAIP", err);
              sql.db_log("WAIP", `Veraltete Sound-Datei ${file} wurde gelöscht.`);
            });
          }
        });
      }
    });
  };

  // System alle xxx Sekunden aufräumen
  setInterval(system_cleanup, app_cfg.global.system_cleanup_time);

  return {
    waip_speichern: waip_speichern,
    waip_verteilen: waip_verteilen,
    rmld_verteilen_for_one_client: rmld_verteilen_for_one_client,
    rmld_verteilen_by_uuid: rmld_verteilen_by_uuid,
    dbrd_verteilen: dbrd_verteilen,
  };
};
