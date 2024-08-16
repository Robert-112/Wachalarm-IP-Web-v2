module.exports = (sql, app_cfg) => {
  // aktuelles Datum und Zeit als ISO-String
  const date = new Date().toISOString();

  // Funktion für besseres console.log
  log = function (type, message) {
    let log_message = `[${date}] [${type.toUpperCase()}] ${message}`;

    switch (type) {
      case "log":
        console.log(log_message);
        break;
      case "info":
        console.info(log_message);
        break;
      case "warn":
        console.warn(log_message);
        break;
      case "error":
        console.error(log_message);
        break;
      case "debug":
        if (app_cfg.global.development) {
          console.debug(log_message);
        }
        break;
      default:
        console.log(log_message);
        break;
    }
  };

  // Funktion für Log in der Datenbank
  db_log = function (type, message) {
    let log_message = `[${date}] [INFO] DB-Log: ${type} - ${message}`;
    console.info(log_message);
    sql.db_log(type, message);
  };

  return {
    log: log,
    db_log: db_log,
  };
};
