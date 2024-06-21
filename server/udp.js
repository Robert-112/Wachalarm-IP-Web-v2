module.exports = (app_cfg, sql, saver) => {

  // Module laden
  let dgram = require('dgram');
  let udp_server = dgram.createSocket('udp4');

  // UDP-Server für Schnittstelle starten
  udp_server.bind(app_cfg.global.udpport);
  udp_server.on('listening', () => {
    let address = udp_server.address();
    sql.db_log('Anwendung', 'UDP Server auf ' + address.address + ':' + address.port + ' gestartet.');
  });

  // Warten auf Einsatzdaten
  udp_server.on('message', (message, remote) => {
    saver.save_new_waip(message.toString('utf8'), remote.address + ':' + remote.port, 'udp')
  });

  // UDP-Daten senden
  const send_message = (message) => {
    udp_server.send(message, 0, message.length, app_cfg.global.udpport, 'localhost', (err) => {
      if (err) throw err;
      sql.db_log('WAIP', 'UDP-Testalarm an localhost:' + app_cfg.global.udpport + ' gesendet.');
    });
  };

  return {
    send_message: send_message
  };
};