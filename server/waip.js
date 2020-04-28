module.exports = function (io, sql, tw, async, app_cfg) {

  // Einsatzmeldung in Datenbank speichern
  function einsatz_speichern(einsatz_rohdaten) {
    // Einsatzmeldung (JSON) speichern
    sql.db_einsatz_speichern(einsatz_rohdaten, function (waip_id) {
      sql.db_log('WAIP', 'DEBUG: Neuer Einsatz mit der ID ' + waip_id);
      // nach dem Speichern anhand der waip_id die beteiligten Wachennummern zum Einsatz ermitteln      
      sql.db_get_einsatz_rooms(waip_id, function (socket_rooms) {
        if (socket_rooms) {
          socket_rooms.forEach(function (rooms) {
            // fuer jede Wache(rooms.room) die verbundenen Sockets(Clients) ermitteln und den Einsatz verteilen
            var room_sockets = io.sockets.adapter.rooms[rooms.room];
            if (typeof room_sockets !== 'undefined') {
              //Object.keys(room_sockets.sockets).forEach(function (socketId) {
              Object.keys(room_sockets).forEach(function (socket) {
                einsatz_verteilen(waip_id, socket, rooms.room);
                sql.db_log('WAIP', 'Einsatz ' + waip_id + ' wird an ' + socket.id + ' (' + rooms.room + ') gesendet');
              });
            };
          });
        } else {
          sql.db_log('Fehler-WAIP', 'Fehler: Keine Wache für den Einsatz mit der ID ' + waip_id + ' vorhanden!');
        };
      });
      sql.db_get_twitter_list(waip_id, function (twitter_data) {
        if (twitter_data) {
          console.log('Daten Twitter: ' + JSON.stringify(twitter_data));

          // tw.tw_screen_name, tw_consumer_key, tw.tw_consumer_secret, tw.tw_access_token_key, tw.tw_access_token_secret, we.uuid, we.einsatzart, wa.name_wache
          tw.alert_twitter_list(twitter_data, function (result) {
            if (!result) {
              sql.db_log('Twitter', 'Einsatz-Rückmeldung erfolgreichen an Twitter-Liste gesendet. ' + result);
            } else {
              sql.db_log('Twitter', 'Fehler beim senden der Einsatz-Rueckmeldung an Twitter: ' + result);
            };
          });

        } else {
          sql.db_log('Twitter', 'Keine Twitter-Liste für Einsatz ' + waip_id + ' hinterlegt.');
        };
      });
    });
  };

  // Einsatz an Client verteilen
  function einsatz_verteilen(waip_id, socket, wachen_nr) {
    // Einsatzdaten für eine Wache aus Datenbank laden
    var user_obj = socket.request.user;
    sql.db_get_einsatzdaten(waip_id, wachen_nr, user_obj.id, function (einsatzdaten) {
      if (einsatzdaten) {
        // Berechtigung ueberpruefen
        sql.db_check_permission(user_obj, waip_id, function (valid) {
          //console.log(permissions + ' ' + wachen_nr);
          //if (permissions == wachen_nr || permissions == 'admin') {} else {
          if (!valid) {
            einsatzdaten.objekt = '';
            einsatzdaten.besonderheiten = '';
            einsatzdaten.strasse = '';
            //einsatzdaten.wgs84_x = einsatzdaten.wgs84_x.substring(0, einsatzdaten.wgs84_x.indexOf('.') + 3);
            //einsatzdaten.wgs84_y = einsatzdaten.wgs84_y.substring(0, einsatzdaten.wgs84_y.indexOf('.') + 3);
            einsatzdaten.wgs84_x = '';
            einsatzdaten.wgs84_y = '';
          };
          // Einsatz senden
          //  io.sockets.to(socket_id).emit('io.neuerEinsatz', einsatzdaten)
          socket.emit('io.neuerEinsatz', einsatzdaten);
          sql.db_log('WAIP', 'Einsatz ' + waip_id + ' fuer Wache ' + wachen_nr + ' an Socket ' + socket.id + ' gesendet');
          sql.db_update_client_status(socket, waip_id);
          // Sound erstellen
          tts_erstellen(app_cfg, socket.id, einsatzdaten, function (tts) {
            if (tts) {
              // Sound senden
              sql.db_log('WAIP', 'ttsfile: ' + tts);
              //io.sockets.to(socket_id).emit('io.playtts', tts);
              socket.emit('io.playtts', tts);
            };
          });
        });
      } else {
        // Standby senden
        //io.sockets.to(socket_id).emit('io.standby', null);
        socket.emit('io.standby', null);
        sql.db_log('WAIP', 'Kein Einsatz fuer Wache ' + wachen_nr + ' vorhanden, Standby an Socket ' + socket.id + ' gesendet..');
        sql.db_update_client_status(socket, null);
      };
    });
  };

  function reuckmeldung_verteilen_by_uuid(waip_uuid, rmld_uuid) {
    // Einsatz-ID mittels Einsatz-UUID ermitteln
    sql.db_get_waipid_by_uuid(waip_uuid, function (waip_id) {
      // am Einsatz beteilite Socket-Räume ermitteln
      sql.db_get_einsatz_rooms(waip_id, function (socket_rooms) {
        
        if (socket_rooms) {
          // wenn Raum zum Einsatz vorhanden ist, dann Rueckmeldung aus DB laden und an diesen versenden
          sql.db_get_single_response_by_rmlduuid(rmld_uuid, function (rmld) {
            
            if (rmld) {
              
              // Rückmeldung an Clients/Räume senden
              socket_rooms.forEach(function (rooms) {
                var room_sockets = io.sockets.adapter.rooms[rooms.room];
                console.log('rooms: ' + JSON.stringify(socket_rooms));
                console.log('rooms: ' + JSON.stringify(rooms));
                room_sockets.emit('io.response', rmld);
                sql.db_log('RMLD', 'Rückmeldung ' + rmld_uuid + ' für den Einsatz mit der ID ' + waip_id + ' an Raum ' + rooms.room + ' gesendet.');
                sql.db_log('RMLD', 'DEBUG: ' + JSON.stringify(rmld));
              });
            };
          });
        };
      });
    });
  };

  function rueckmeldung_verteilen_for_client(waip_id, socket, wachen_id) {
    if (typeof socket !== 'undefined') {
      sql.db_get_response_for_wache(waip_id, wachen_id, function (rmld) {
        if (rmld) {
          // Rueckmeldung nur an den einen Socket senden
          socket.emit('io.response', rmld);
          sql.db_log('RMLD', 'Vorhandene Rückmeldungen an Socket ' + socket.id + ' gesendet.');
          sql.db_log('RMLD', 'DEBUG: ' + JSON.stringify(rmld));
        } else {
          sql.db_log('RMLD', 'Keine Rückmeldungen für Einsatz-ID' + waip_id + ' und Wachen-ID ' + wachen_id + ' vorhanden.');
        };
      });
    };
  };

  function tts_erstellen(app_cfg, socket_id, einsatzdaten, callback) {
    // unnoetige Zeichen aus socket_id entfernen
    var id = socket_id.replace(/\W/g, '');
    // Pfade der Sound-Dateien defeinieren
    var wav_tts = process.cwd() + app_cfg.global.soundpath + id + '.wav';
    var mp3_tmp = process.cwd() + app_cfg.global.soundpath + id + '_tmp.mp3';
    var mp3_tts = process.cwd() + app_cfg.global.soundpath + id + '.mp3';
    var mp3_url = app_cfg.global.mediapath + id + '.mp3';
    // Unterscheiden des Alarmgongs nach Einsatzart
    if (einsatzdaten.einsatzart == "Brandeinsatz" || einsatzdaten.einsatzart == "Hilfeleistungseinsatz") {
      var mp3_bell = process.cwd() + app_cfg.global.soundpath + 'bell_long.mp3';
    } else {
      var mp3_bell = process.cwd() + app_cfg.global.soundpath + 'bell_short.mp3';
    };
    // Zusammensetzen der Sprachansage
    async.map(JSON.parse(einsatzdaten.em_alarmiert), sql.db_tts_einsatzmittel, function (err, einsatzmittel) {
      // Grunddaten
      var tts_text = einsatzdaten.einsatzart + ', ' + einsatzdaten.stichwort;
      if (einsatzdaten.objekt) {
        var tts_text = tts_text + '. ' + einsatzdaten.objekt + ', ' + einsatzdaten.ort + ', ' + einsatzdaten.ortsteil;
      } else {
        var tts_text = tts_text + '. ' + einsatzdaten.ort + ', ' + einsatzdaten.ortsteil;
      };
      // Einsatzmittel
      tts_text = tts_text + '. Für ' + einsatzmittel.join(", ");
      // Unterscheidung nach Sondersignal
      if (einsatzdaten.sondersignal == 1) {
        tts_text = tts_text + ', mit Sondersignal';
      } else {
        tts_text = tts_text + ', ohne Sonderrechte';
      };
      // Abschluss
      tts_text = tts_text + '. Ende der Durchsage!';
      // ungewollte zeichen aus Sprachansage entfernen
      tts_text = tts_text.replace(/:/g, " ");
      tts_text = tts_text.replace(/\//g, " ");
      tts_text = tts_text.replace(/-/g, " ");
      // Sprachansage als mp3 erstellen
      switch (process.platform) {
        //if (process.platform === "win32") {
        case 'win32':
          // Powershell
          var proc = require('child_process');
          var commands = [
            // TTS-Schnittstelle von Windows
            'Add-Type -AssemblyName System.speech;' +
            '$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;' +
            // Ausgabedatei und Sprachtext
            '$speak.SetOutputToWaveFile(\"' + wav_tts + '\");' +
            '$speak.Speak(\"' + tts_text + '\");' +
            '$speak.Dispose();' +
            // speak.wav in mp3 umwandeln
            'ffmpeg -nostats -hide_banner -loglevel 0 -y -i ' + wav_tts + ' -vn -ar 44100 -ac 2 -ab 128k -f mp3 ' + mp3_tmp + ';' +
            // Gong und Ansage zu einer mp3 zusammensetzen
            'ffmpeg -nostats -hide_banner -loglevel 0 -y -i \"concat:' + mp3_bell + '|' + mp3_tmp + '\" -acodec copy ' + mp3_tts + ';' +
            'rm ' + wav_tts + ';' +
            'rm ' + mp3_tmp + ';'
          ];
          var options = {
            shell: true
          };
          var childD = proc.spawn('powershell', commands);
          childD.stdin.setEncoding('ascii');
          childD.stderr.setEncoding('ascii');
          childD.stderr.on('data', function (data) {
            sql.db_log('Fehler-TTS', data);
            callback && callback(null);
          });
          childD.on('exit', function () {
            callback && callback(mp3_url);
          });
          childD.stdin.end();
          break;
        case 'linux':
          // bash
          var proc = require('child_process');
          var commands = [
            // TTS-Schnittstelle SVOX PicoTTS
            '-c', `
            pico2wave --lang=de-DE --wave=` + wav_tts + ` \"` + tts_text + `\"
            ffmpeg -nostats -hide_banner -loglevel 0 -y -i ` + wav_tts + ` -vn -ar 44100 -ac 2 -ab 128k -f mp3 ` + mp3_tmp + `
            ffmpeg -nostats -hide_banner -loglevel 0 -y -i \"concat:` + mp3_bell + `|` + mp3_tmp + `\" -acodec copy ` + mp3_tts + `
            rm ` + wav_tts + `
            rm ` + mp3_tmp
          ];
          var options = {
            shell: true
          };
          console.log(commands);
          var childD = proc.spawn('/bin/sh', commands);
          childD.stdin.setEncoding('ascii');
          childD.stderr.setEncoding('ascii');
          childD.on('exit', function (code, signal) {
            if (code > 0) {
              sql.db_log('Fehler-TTS', 'Exit-Code ' + code + '; Fehler beim erstellen der TTS-Datei');
              callback && callback(null);
            } else {
              callback && callback(mp3_url);
            };
          });
          childD.stdin.end();
          break;
          //  } else {
        default:
          sql.db_log('Fehler-TTS', 'TTS für dieses Server-Betriebssystem nicht verfügbar');
          callback && callback(null);
      };
    });
  };

  // Aufräumen (alle 10 Sekunden)
  setInterval(function () {
    // alle User-Einstellungen prüfen und ggf. Standby senden
    sql.db_get_sockets_to_standby(function (socket_ids) {
      if (socket_ids) {
        console.log()
        socket_ids.forEach(function (row) {
          var socket = io.sockets.connected[row.socket_id];
          socket.emit('io.standby', null);
          socket.emit('io.stopaudio', null);
          sql.db_log('WAIP', 'Standby an Socket ' + socket.id + ' gesendet');
          sql.db_update_client_status(socket, null);
        });
      };
    });
    // Nach alten Einsaetzen suchen und diese ggf. loeschen
    sql.db_get_alte_einsaetze(app_cfg.global.time_to_delete_waip, function (waip_id) {
      if (waip_id) {
        sql.db_log('WAIP', 'Einsatz mit der ID ' + waip_id + ' ist veraltet und kann gelöscht werden.')
        //beteiligte Wachen ermitteln
        sql.db_get_einsatz_rooms(waip_id, function (data) {
          if (data) {
            data.forEach(function (row) {
              // fuer jede Wache(row.room) die verbundenen Sockets(Clients) ermitteln und Standby senden
              var room_stockets = io.sockets.adapter.rooms[row.room];
              if (typeof room_stockets !== 'undefined') {
                Object.keys(room_stockets).forEach(function (socket) {
                  // Standby senden
                  // TODO: Standby nur senden, wenn kein anderer (als der zu löschende) Einsatz angezeigt wird
                  sql.db_check_client_waipid(socket.id, waip_id, function (same_id) {
                    if (same_id) {
                      socket.emit('io.standby', null);
                      socket.emit('io.stopaudio', null);
                      sql.db_log('WAIP', 'Standby an Socket ' + socket.id + ' gesendet');
                      sql.db_update_client_status(socket, null);
                    };
                  });
                });
              };
            });
          };
          // Einsatz löschen
          sql.db_log('WAIP', 'Einsatz ' + waip_id + ' wird gelöscht');
          sql.db_einsatz_loeschen(waip_id);
        });
      };
    });
    // TODO: löschen alter Sounddaten nach alter (15min) und socket-id (nicht mehr verbunden)
    const fs = require('fs');
    fs.readdirSync(process.cwd() + app_cfg.global.soundpath).forEach(file => {
      // nur die mp3s von alten clients loeschen
      if (file.substring(0, 4) != 'bell' && file.substring(file.length - 3) == 'mp3' && file.substring(file.length - 8) != '_tmp.mp3') {
        sql.db_get_socket_by_id(file.substring(0, file.length - 4), function (data) {
          if (!data) {
            fs.unlink(process.cwd() + app_cfg.global.soundpath + file, function (err) {
              if (err) return sql.db_log('Fehler-WAIP', err);
              sql.db_log('WAIP', file + ' wurde erfolgreich geloescht');
            });
          };
        });
      };
    })
  }, 10000);

  function dbrd_verteilen(dbrd_uuid, socket) {
    sql.db_get_einsatzdaten_by_uuid(dbrd_uuid, function(einsatzdaten) {
      if (einsatzdaten) {        
        sql.db_check_permission(socket.request.user, einsatzdaten.id, function(valid) {
          if (!valid) {
            delete einsatzdaten.objekt;
            delete einsatzdaten.besonderheiten;
            delete einsatzdaten.strasse;
            delete einsatzdaten.wgs84_x;
            delete einsatzdaten.wgs84_y;
          };
          socket.emit('io.Einsatz', einsatzdaten);
          sql.db_log('DBRD', 'Einsatzdaten für Dashboard' + dbrd_uuid + ' an Socket ' + socket.id + ' gesendet');
          sql.db_update_client_status(socket, waip_id);
        });
      } else {
        var err = new Error('Der angefragte Einsatz ist nicht - oder nicht mehr - vorhanden!');
        err.status = 404;
        next(err);
      };
    });
  };




  // TODO: Funktion um Clients "neuzustarten" (Seite remote neu laden)

  return {
    einsatz_speichern: einsatz_speichern,
    einsatz_verteilen: einsatz_verteilen,
    dbrd_verteilen: dbrd_verteilen,
    rueckmeldung_verteilen_for_client: rueckmeldung_verteilen_for_client,
    reuckmeldung_verteilen_by_uuid: reuckmeldung_verteilen_by_uuid
  };
};