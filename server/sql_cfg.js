module.exports = (bcrypt, app_cfg) => {
  // Datenbank einrichten
  const Database = require("better-sqlite3");
  const db = new Database(app_cfg.global.database);
  db.pragma("foreign_keys");
  db.pragma("journal_mode = WAL");

  // Datenbank erstellen, falls nicht vorhanden
  const stmt = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE
    type='table' and name='waip_einsaetze';
  `);

  const row = stmt.get();

  if (row === undefined) {
    console.log("Datenbank scheint leer. Tabellen werden angelegt.");

    let sqlInit = `

      -- Tabelle für Einsätze
      CREATE TABLE IF NOT EXISTS waip_einsaetze (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        uuid TEXT,
        zeitstempel DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'LOCALTIME')),
        ablaufzeit DATETIME,         -- neu  
        els_einsatz_id INTEGER,      -- neu
        els_einsatznummer TEXT,      -- vorher: einsatznummer TEXT,
        alarmzeit TEXT,
        einsatzart TEXT,
        stichwort TEXT,
        sondersignal INTEGER,
        besonderheiten TEXT,
        einsatzdetails TEXT,         -- neu
        landkreis TEXT,              -- neu
        ort TEXT,
        ortsteil TEXT,
        ortslage TEXT,               -- neu
        strasse TEXT,
        hausnummer TEXT,             -- neu
        ort_sonstiges TEXT,          -- voher: sonstiger_ort TEXT,
        objekt TEXT,
        objektteil TEXT,             -- neu
        objektnummer INTEGER,        -- vorher: objektnr TEXT,
        objektart TEXT,
        wachenfolge INTEGER,
        wgs84_x REAL,                -- vorher: TEXT
        wgs84_y REAL,                -- vorher: TEXT
        geo_h3_index,                -- vorher: wgs84_area TEXT,
        UNIQUE (id, uuid)
      );
      
      -- Tabelle für Einsatzmittel
      CREATE TABLE IF NOT EXISTS waip_einsatzmittel (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        zeitstempel DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP)),
        em_waip_einsaetze_id INTEGER NOT NULL,       -- vorher: waip_einsaetze_ID
        els_einsatznummer TEXT,                      -- neu
        em_funkrufname TEXT,                         -- vorher: einsatzmittel TEXT,
        em_kennzeichen TEXT,                         -- neu
        em_typ TEXT,                                 -- neu
        em_bezeichnung TEXT,                         -- neu
        em_fmsstatus TEXT,                           -- vorher: status TEXT,
        em_wgs84_x REAL,                             -- vorher: wgs84_x TEXT,
        em_wgs84_y REAL,                             -- vorher: wgs84_y TEXT,
        em_h3_index TEXT,                            -- neu
        em_issi TEXT,                                -- neu
        em_opta TEXT,                                -- neu
        em_radiochannel TEXT,                        -- neu
        em_station_id TEXT,                          -- vorher: waip_wachen_ID INTEGER,
        em_station_nr TEXT,                          -- neu
        em_station_name TEXT,                        -- vorher: wachenname TEXT,
        em_zeitstempel_alarmierung DATETIME,         -- vorher: zeitstempel TEXT,
        em_zeitstempel_ausgerueckt DATETIME,         -- neu
        em_zeitstempel_fms DATETIME,                 -- neu
        em_staerke_els TEXT                         -- vorher: staerke TEXT
      );

      -- Tabelle für Wachen
      CREATE TABLE IF NOT EXISTS waip_wachen (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        nr_kreis TEXT,              -- vorher: INTEGER
        nr_traeger TEXT,
        nr_standort TEXT,           -- neu
        nr_abteilung TEXT,          -- neu
        nr_wache INTEGER,
        kfz_leitstelle TEXT,        -- neu
        kfz_kreis TEXT,             -- neu
        name_leitstelle TEXT,       -- neu
        name_kreis TEXT,
        name_traeger TEXT,
        name_wache TEXT,
        name_beschreibung TEXT,     -- neu
        wgs84_x REAL,               -- vorher: wgs84_x TEXT,
        wgs84_y REAL                -- vorher: wgs84_y TEXT
      );
      
      -- Tabelle für Historie
      CREATE TABLE IF NOT EXISTS waip_history (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        waip_uuid TEXT,
        socket_id TEXT,
        uuid_einsatz_grunddaten TEXT,
        uuid_em_alarmiert TEXT,
        uuid_em_weitere TEXT
      );
    
      -- Tabelle der Clients
      CREATE TABLE IF NOT EXISTS waip_clients (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        connect_time DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'LOCALTIME')),
        socket_id TEXT,
        client_ip TEXT,
        room_name TEXT,
        client_status TEXT,
        user_name TEXT,
        user_permissions TEXT,
        user_agent TEXT,
        reset_timestamp DATETIME
      );

      -- Tabelle für einzelne Rückmeldungen
      CREATE TABLE IF NOT EXISTS waip_rueckmeldungen (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        zeitstempel DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP)), --neu
        waip_uuid TEXT,
        rmld_uuid TEXT,
        rmld_alias TEXT,               -- vorher: alias
        rmld_adress TEXT,              -- neu   
        -- geloescht: INTEGER einsatzkraft, maschinist, fuehrungskraft
        rmld_role TEXT,                -- neu
        rmld_capability_agt INTEGER,   -- vorher: agt
        rmld_capability_ma INTEGER,    -- neu
        rmld_capability_fzf INTEGER,   -- neu
        rmld_capability_med INTEGER,   -- neu
        time_receive DATETIME,         -- neu
        type_decision TEXT,            -- neu
        time_decision DATETIME,        -- vorher: set_time
        time_arrival DATETIME,         -- vorher: arrival_time
        wache_id INTEGER,
        wache_nr INTEGER,
        wache_name TEXT,
        group_nr INTEGER               -- neu (Gruppe der Alarmierung)
      );

      -- Tabelle für Benutzer
      CREATE TABLE IF NOT EXISTS waip_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT,
        password TEXT,
        description TEXT,              -- neu
        permissions TEXT,
        ip_address TEXT,
        reference TEXT                 -- neu
      );

      -- Tabelle für Benutzer-Anmeldeinformationen
      CREATE TABLE IF NOT EXISTS waip_user_credentials  (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,                -- neu
        external_id TEXT,               -- neu
        public_key TEXT,              -- neu
        FOREIGN KEY(user_id) REFERENCES waip_users(id)
      );

      -- Tabelle für Einstellungen der Benutzer
      CREATE TABLE IF NOT EXISTS waip_user_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        config_type TEXT,               -- neu
        config_value TEXT,              -- neu
        FOREIGN KEY(user_id) REFERENCES waip_users(id)
      );
      
      -- Tabelle für Übersetzungen erstellen
      CREATE TABLE IF NOT EXISTS waip_replace (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        rp_typ TEXT,                    -- neu (z.B. em_tts)
        rp_input TEXT,                  -- vorher: einsatzmittel_typ TEXT,
        rp_output TEXT                  -- vorher: einsatzmittel_rufname TEXT
      );
        
      -- Tabelle für automatische Exports
      CREATE TABLE IF NOT EXISTS waip_export (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        export_typ TEXT,
        export_name TEXT,
        export_text TEXT,
        export_filter TEXT,
        export_recipient TEXT
      );
      
      -- Tabelle zur Protokollierung (Log)
      CREATE TABLE IF NOT EXISTS waip_log (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        log_time DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'LOCALTIME')),
        log_typ TEXT,
        log_text TEXT
      );

    `;

    // weitere Standardwerte für ersten Start hinzufügen
    sqlInit = sqlInit + app_cfg.sqlite.startup;

    // Datenbank mit Tabellen und Inhalten erstellen
    db.exec(sqlInit);

    // Standard-Admin hinterlegen
    const hash_adm = bcrypt.hashSync(app_cfg.global.defaultpass, app_cfg.global.saltRounds);
    const insert_adm = db.prepare(`
      INSERT INTO waip_user ( 
        user, password, permissions, ip_address 
      ) VALUES ( 
        ?, ?, 'admin', ?
      );`);
    insert_adm.run(app_cfg.global.defaultuser, hash_adm, app_cfg.global.defaultuserip);

    // Standard-API-User hinterlegen
    const hash_apiuser = bcrypt.hashSync(app_cfg.global.defaultapipass, app_cfg.global.saltRounds);
    const insert_apiuser = db.prepare(`
      INSERT INTO waip_user ( 
        user, password, permissions, ip_address 
      ) VALUES ( 
        ?, ?, 'api', ?
      );`);
    insert_apiuser.run(app_cfg.global.defaultapiuser, hash_apiuser, app_cfg.global.defaultuserip);
  } else {
    // alte Clients (Sockets) bei Neustart des Servers entfernen
    const stmt = db.prepare("DELETE FROM waip_clients");
    const info = stmt.run();

    console.log("Datenbank existiert bereits, keine Erstellung notwendig. Temporäre Daten in Waip_clients wurden gelöscht:", info.changes);
  }

  console.log("Datenbank geöffnet.");

  return db;
};
