const fs = require("fs");
const path = require("path");

module.exports = (bcrypt, app_cfg) => {
  // Datenbank einrichten
  const Database = require("better-sqlite3");
  const db = new Database(app_cfg.global.database, app_cfg.development.dev_sqlite ? { verbose: console.log } : {});
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
    console.log("START - Datenbank scheint leer. Tabellen werden angelegt.");

    let sqlInit = `

      -- Tabelle für Einsätze
      CREATE TABLE IF NOT EXISTS waip_einsaetze (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        uuid TEXT,
        zeitstempel DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'LOCALTIME')),
        ablaufzeit DATETIME,            -- neu  
        els_einsatznummer TEXT,         -- vorher: einsatznummer TEXT,
        alarmzeit DATETIME,             -- vorher: alarmzeit TEXT,
        einsatzart TEXT,
        stichwort TEXT,
        sondersignal INTEGER,
        besonderheiten TEXT,
        einsatzdetails TEXT,            -- neu
        ort TEXT,
        ortsteil TEXT,
        ortslage TEXT,                  -- neu
        strasse TEXT,
        hausnummer TEXT,                -- neu
        ort_sonstiges TEXT,             -- voher: sonstiger_ort TEXT,
        objekt TEXT,
        objektteil TEXT,                -- neu
        objektnummer INTEGER,           -- vorher: objektnr TEXT,
        objektart TEXT,
        wachenfolge INTEGER,
        wgs84_x REAL,                   -- vorher: TEXT
        wgs84_y REAL,                   -- vorher: TEXT
        geometry TEXT,                  -- vorher: wgs84_area TEXT,     
        UNIQUE (id, uuid)
      );
      
      -- Tabelle für Einsatzmittel
      CREATE TABLE IF NOT EXISTS waip_einsatzmittel (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        zeitstempel DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'LOCALTIME')),
        em_waip_einsaetze_id INTEGER NOT NULL,       -- vorher: waip_einsaetze_ID
        els_einsatznummer TEXT,                      -- neu
        em_funkrufname TEXT,                         -- vorher: einsatzmittel TEXT,
        em_kennzeichen TEXT,                         -- neu
        em_typ TEXT,                                 -- neu
        em_bezeichnung TEXT,                         -- neu
        em_fmsstatus TEXT,                           -- vorher: status TEXT,
        em_wgs84_x REAL,                             -- vorher: wgs84_x TEXT,
        em_wgs84_y REAL,                             -- vorher: wgs84_y TEXT,
        em_wgs84_route_full TEXT,                    -- neu (Darstellung Einsatzroute, Version 2.0.4)
        em_wgs84_route_half TEXT,                    -- neu (Darstellung Einsatzroute, Version 2.0.4)
        em_issi TEXT,                                -- neu
        em_opta TEXT,                                -- neu
        em_radiochannel TEXT,                        -- neu
        em_station_id TEXT,                          -- vorher: waip_wachen_ID INTEGER,
        em_station_nr TEXT,                          -- neu
        em_station_name TEXT,                        -- vorher: wachenname TEXT,
        em_zeitstempel_alarmierung DATETIME,         -- vorher: zeitstempel TEXT,
        em_zeitstempel_ausgerueckt DATETIME,         -- neu
        em_zeitstempel_fms DATETIME,                 -- neu
        em_zeitstempel_alarmierung_iso TEXT,         -- neu: ISO-Zeit Alarmierung
        em_zeitstempel_ausgerueckt_iso TEXT,         -- neu: ISO-Zeit Ausruecken
        em_staerke_els TEXT                          -- vorher: staerke TEXT
      );

      -- Tabelle für Wachen
      CREATE TABLE IF NOT EXISTS waip_wachen (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        nr_leitstelle TEXT,             -- neu (Version 2.0.4)
        nr_kreis TEXT,                  -- vorher: INTEGER
        nr_traeger TEXT,
        nr_standort TEXT,               -- neu
        nr_abteilung TEXT,              -- neu
        nr_wache INTEGER,
        kfz_leitstelle TEXT,            -- neu
        kfz_kreis TEXT,                 -- neu
        name_leitstelle TEXT,           -- neu
        name_kreis TEXT,
        name_traeger TEXT,
        name_wache TEXT,
        name_beschreibung TEXT,         -- neu
        name_erweiterung TEXT,          -- neu (Version 2.0.4)
        wgs84_x REAL,                   -- vorher: wgs84_x TEXT,
        wgs84_y REAL,                   -- vorher: wgs84_y TEXT
        aktiv INTEGER DEFAULT 1         -- neu: 1 = aktiv, 0 = inaktiv
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
        client_ips TEXT,
        client_nsp TEXT,
        client_room TEXT,
        client_status TEXT,
        reset_timestamp DATETIME,
        user_name TEXT,
        user_permissions TEXT,
        user_agent TEXT,
        netzkopplung INTEGER,             -- neu: 1 = Internet-Testadressen erreichbar (Verdacht auf Netzkopplung)
        netzkopplung_checked_at DATETIME  -- neu: Zeitpunkt der letzten Pruefung
      );

      -- Tabelle für einzelne Rückmeldungen
      CREATE TABLE IF NOT EXISTS waip_rueckmeldungen (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        zeitstempel DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'LOCALTIME')), --neu
        waip_uuid TEXT,
        rmld_uuid TEXT,
        rmld_alias TEXT,                -- vorher: alias
        rmld_address TEXT,              -- neu   
                                        -- geloescht: INTEGER einsatzkraft, maschinist, fuehrungskraft
        rmld_role TEXT,                 -- neu
        rmld_capability_agt INTEGER,    -- vorher: agt
        rmld_capability_ma INTEGER,     -- neu
        rmld_capability_fzf INTEGER,    -- neu
        rmld_capability_med INTEGER,    -- neu
        time_receive DATETIME,          -- neu
        type_decision TEXT,             -- neu
        time_decision DATETIME,         -- vorher: set_time
        time_arrival DATETIME,          -- vorher: arrival_time
        wache_id INTEGER,
        wache_nr INTEGER,
        wache_name TEXT
      );

      -- Tabelle für Benutzer
      CREATE TABLE IF NOT EXISTS waip_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT,
        password TEXT,
        description TEXT,               -- neu
        permissions TEXT,
        ip_address TEXT,
        reference TEXT                  -- neu
      );

      -- Tabelle für erweiterte Benutzer-Anmeldeinformationen
      CREATE TABLE IF NOT EXISTS waip_user_credentials  (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,                -- neu
        external_id TEXT,               -- neu
        public_key TEXT,                -- neu
        FOREIGN KEY(user_id) REFERENCES waip_user(id)
      );

      -- Tabelle für Einstellungen der Benutzer
      CREATE TABLE IF NOT EXISTS waip_user_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        config_type TEXT,               -- neu
        config_value TEXT,              -- neu
        FOREIGN KEY(user_id) REFERENCES waip_user(id)
      );
      
      -- Tabelle für Übersetzungen erstellen
      CREATE TABLE IF NOT EXISTS waip_replace (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
        rp_typ TEXT,                    -- neu (z.B. em_tts)
        rp_input TEXT,                  -- vorher: einsatzmittel_typ TEXT,
        rp_output TEXT                  -- vorher: einsatzmittel_rufname TEXT
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
    sqlInit = sqlInit + fs.readFileSync(path.resolve(__dirname, "../sql_seed.sql"), "utf8");

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

    console.log("START - Datenbank existiert bereits, keine Erstellung notwendig. Temporäre Daten in Waip_clients wurden gelöscht:", info.changes);

    // Migration: Spalte 'aktiv' zu waip_wachen hinzufügen (falls noch nicht vorhanden)
    try {
      db.exec("ALTER TABLE waip_wachen ADD COLUMN aktiv INTEGER DEFAULT 1");
      console.log("START - Migration: Spalte 'aktiv' zur Tabelle waip_wachen hinzugefügt (alle bestehenden Wachen auf aktiv gesetzt).");
    } catch (e) {
      // Spalte existiert bereits, kein Handlungsbedarf
    }

    // Migration: Spalte 'description' zu waip_user hinzufügen (falls noch nicht vorhanden)
    try {
      db.exec("ALTER TABLE waip_user ADD COLUMN description TEXT");
      console.log("START - Migration: Spalte 'description' zur Tabelle waip_user hinzugefuegt.");
    } catch (e) {
      // Spalte existiert bereits, kein Handlungsbedarf
    }

    // Migration: ISO-Zeit-Spalten zu waip_einsatzmittel hinzufügen (falls noch nicht vorhanden)
    try {
      db.exec("ALTER TABLE waip_einsatzmittel ADD COLUMN em_zeitstempel_alarmierung_iso TEXT");
      console.log("START - Migration: Spalte 'em_zeitstempel_alarmierung_iso' zur Tabelle waip_einsatzmittel hinzugefuegt.");
    } catch (e) {
      // Spalte existiert bereits, kein Handlungsbedarf
    }

    try {
      db.exec("ALTER TABLE waip_einsatzmittel ADD COLUMN em_zeitstempel_ausgerueckt_iso TEXT");
      console.log("START - Migration: Spalte 'em_zeitstempel_ausgerueckt_iso' zur Tabelle waip_einsatzmittel hinzugefuegt.");
    } catch (e) {
      // Spalte existiert bereits, kein Handlungsbedarf
    }

    // Migration: Routen-Spalten zu waip_einsatzmittel hinzufügen (falls noch nicht vorhanden)
    try {
      db.exec("ALTER TABLE waip_einsatzmittel ADD COLUMN em_wgs84_route_full TEXT");
      console.log("START - Migration: Spalte 'em_wgs84_route_full' zur Tabelle waip_einsatzmittel hinzugefuegt.");
    } catch (e) {
      // Spalte existiert bereits, kein Handlungsbedarf
    }

    try {
      db.exec("ALTER TABLE waip_einsatzmittel ADD COLUMN em_wgs84_route_half TEXT");
      console.log("START - Migration: Spalte 'em_wgs84_route_half' zur Tabelle waip_einsatzmittel hinzugefuegt.");
    } catch (e) {
      // Spalte existiert bereits, kein Handlungsbedarf
    }

    // Migration: Netzkopplungs-Pruefung zu waip_clients hinzufügen (falls noch nicht vorhanden)
    try {
      db.exec("ALTER TABLE waip_clients ADD COLUMN netzkopplung INTEGER");
      console.log("START - Migration: Spalte 'netzkopplung' zur Tabelle waip_clients hinzugefuegt.");
    } catch (e) {
      // Spalte existiert bereits, kein Handlungsbedarf
    }

    try {
      db.exec("ALTER TABLE waip_clients ADD COLUMN netzkopplung_checked_at DATETIME");
      console.log("START - Migration: Spalte 'netzkopplung_checked_at' zur Tabelle waip_clients hinzugefuegt.");
    } catch (e) {
      // Spalte existiert bereits, kein Handlungsbedarf
    }
  }

  console.log("START - Datenbank geöffnet.");

  return db;
};
