module.exports = function (app, sql, app_cfg, passport, auth, saver, logger) {
  // Hilfsfunktion zum prüfen ob der Inhaltstyp JSON ist
  const checkContentType = (req, res, next) => {
    if (!req.is("application/json")) {
      const msg = `Der Inhalt der Anfrage wurde mit ungültigem oder nicht erlaubtem Medientyp übermittelt (${req.originalUrl}).`;
      res.status(415).send(msg);
      logger.log("error", msg);
    } else {
      next();
    }
  };

  // Hilfsfunktion zum Ermitteln der Client-IP
  const getRemoteIp = (req) => {
    // Prüfe verschiedene Header in der Reihenfolge ihrer Zuverlässigkeit
    const headers = [req.headers["x-real-ip"], req.headers["x-forwarded-for"], req.socket.remoteAddress];

    for (const header of headers) {
      if (!header) continue;

      // Bei x-forwarded-for nehmen wir die erste IP (Client-IP)
      if (header === req.headers["x-forwarded-for"]) {
        const ips = header.split(",").map((ip) => ip.trim());
        if (ips.length > 0) return ips[0];
      } else {
        return header;
      }
    }

    // Fallback auf localhost wenn keine IP gefunden wurde
    return "127.0.0.1";
  };

  /* ########################### */
  /* ##### Statische Seiten #### */
  /* ########################### */

  // Startseite
  app.get("/", async (req, res, next) => {
    try {
      let user_waips = null;
      let user_dbrds = null;
      if (req.user) {
        // Alarmmonitore und aktuelle Dashboards fuer den User laden
        user_waips = await sql.db_get_user_waips(req.user.id);
        user_dbrds = await sql.db_get_user_dbrds(req.user.id);
      }
      res.render("page_home", {
        public: app_cfg.public,
        title: "Wachalarm IP-Web",
        user: req.user,
        user_waips: user_waips,
        user_dbrds: user_dbrds,
        session_max_age: app_cfg.global.session_cookie_max_age,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Startseite. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Ueber die Anwendung
  app.get("/ueber", (req, res) => {
    res.render("about", {
      public: app_cfg.public,
      title: "Über",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
    });
  });

  // Impressum
  app.get("/impressum", (req, res) => {
    if (app_cfg.public.ext_imprint) {
      res.redirect(app_cfg.public.url_imprint);
    } else {
      res.render("imprint", {
        public: app_cfg.public,
        title: "Impressum",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
      });
    }
  });

  // Datenschutzerklaerung
  app.get("/datenschutz", (req, res) => {
    if (app_cfg.public.ext_privacy) {
      res.redirect(app_cfg.public.url_privacy);
    } else {
      res.render("privacy", {
        public: app_cfg.public,
        title: "Datenschutzerklärung",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
      });
    }
  });

  /* ##################### */
  /* ######## API ######## */
  /* ##################### */

  // Aufruf von /api
  app.get("/api", (req, res, next) => {
    const err = new Error(`Der Aufruf dieser Seite ist nicht gestattet. 
     Kontaktieren Sie den Betreiber der Seite für weitere Informationen.`);
    logger.log("error", err);
    err.status = 403;
    next(err);
  });

  // API-Token abrufen
  app.post(
    "/api/get_token",
    passport.authenticate("local", {
      //TODO bessere Rückmeldung ohne Umleitung auf Seite
      failureRedirect: "/api",
      failureFlash: "Authentifizierung fehlgeschlagen! Bitte prüfen Sie Benutzername und Passwort.",
      failureMessage: true,
    }),
    async (req, res) => {
      const new_token = await auth.ensureApi(req.user.id);
      if (new_token) {
        res.json({ message: "Neues Zugangs-Token generiert", token: new_token });
      } else {
        res.status(401).json({ msg: "Keine Berechtigung zur Nutzung der Rest-API" });
      }
    }
  );

  // POST von neuen oder aktualisierten Einsätzen
  app.post("/api/einsatzdaten", passport.authenticate("jwt", { session: false }), checkContentType, async (req, res) => {
    try {
      // Client-IP ermitteln
      const remote_ip = getRemoteIp(req);
      // Einsatz speichern
      await saver.save_einsatz(req.body, remote_ip);
      // Protokollieren
      const msg = "Einsatzdaten erfolgreich übermittelt und verarbeitet (/api/einsatzdaten).";
      logger.log("log", msg);
      // OK zurücksenden
      res.status(200);
      res.send(msg);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/einsatzdaten).";
      logger.log("error", msg + " " + error);
      res.status(500);
      res.send(msg);
    }
  });

  // POST des aktuellen Status eines Einsatzes (laufend, abgeschlossen)
  app.post("/api/einsatzstatus", passport.authenticate("jwt", { session: false }), checkContentType, async (req, res) => {
    try {
      // Client-IP ermitteln
      const remote_ip = getRemoteIp(req);
      // Rückmeldungen speichern
      await saver.save_einsatzstatus(req.body, remote_ip);
      const msg = "Einsatzstatus erfolgreich aktualisiert (/api/einsatzstatus).";
      logger.log("log", msg);
      // OK zurücksenden
      res.status(200);
      res.send(msg);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/einsatzstatus).";
      logger.log("error", msg + " " + error);
      res.status(500);
      res.send(msg);
    }
  });

  // POST von neuen oder aktualisierten Rückmeldungen
  app.post("/api/rueckmeldung", passport.authenticate("jwt", { session: false }), checkContentType, async (req, res) => {
    try {
      // Client-IP ermitteln
      const remote_ip = getRemoteIp(req);
      // Rückmeldungen speichern
      await saver.save_rmld(req.body, remote_ip);
      const msg = "Rückmeldungen erfolgreich übermittelt und verarbeitet (/api/rueckmeldung).";
      logger.log("log", msg);
      // OK zurücksenden
      res.status(200);
      res.send(msg);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/rueckmeldung).";
      logger.log("error", msg + " " + error);
      res.status(500);
      res.send(msg);
    }
  });

  // POST von neuen oder aktualisierten Statusmeldungen
  app.post("/api/einsatzmittel", passport.authenticate("jwt", { session: false }), checkContentType, async (req, res) => {
    try {
      // Client-IP ermitteln
      const remote_ip = getRemoteIp(req);
      // Einsatzmittel speichern
      await saver.save_einsatzmittel(req.body, remote_ip);
      logger.log("log", "Einsatzmittel erfolgreich übermittelt und verarbeitet (/api/einsatzmittel).");
      res.sendStatus(200);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/einsatzmittel).";
      logger.log("error", msg + " " + error);
      res.status(500);
      res.send(msg);
    }
  });

  /* ##################### */
  /* ####### Login ####### */
  /* ##################### */

  // Loginseite
  app.get("/login", (req, res) => {
    res.render("login", {
      public: app_cfg.public,
      title: "Login",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
      error: req.query.error || null,
    });
  });

  // Login-Formular verarbeiten
  app.post("/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        const msg = encodeURIComponent("Authentifizierung fehlgeschlagen! Bitte prüfen Sie Benutzername und Passwort.");
        return res.redirect("/login?error=" + msg);
      }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        if (req.body.rememberme) {
          // der Benutzer muss sich fuer 5 Jahre nicht anmelden
          req.session.cookie.maxAge = 5 * 365 * 24 * 60 * 60 * 1000;
        }
        return res.redirect("/");
      });
    })(req, res, next);
  });

  app.get("/login_cert", (req, res, next) => {
    passport.authenticate("trusted-header", (err, user, info) => {
      if (err) {
        return res.redirect("/login?error=" + encodeURIComponent("Interner Fehler bei der Zertifikats-Authentifizierung."));
      }
      if (!user) {
        return res.redirect(
          "/login?error=" +
            encodeURIComponent("Authentifizierung mittels Client-Zertifikat fehlgeschlagen! Bitte wenden Sie sich an den Administrator.")
        );
      }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        // der Benutzer muss sich fuer 1 Tag nicht anmelden
        req.session.cookie.maxAge = 1 * 24 * 60 * 60 * 1000;
        return res.redirect("/");
      });
    })(req, res, next);
  });

  // Logout verarbeiten
  app.post("/logout", function (req, res) {
    req.session.destroy(function (err) {
      res.redirect("/");
    });
  });

  /* ######################### */
  /* ##### Session Utils ##### */
  /* ######################### */

  // Keep-Alive für Session (wird vom Client periodisch aufgerufen)
  app.get("/session/keepalive", (req, res) => {
    try {
      if (req.session) {
        // Touch erneuert das Ablaufdatum im Store (bei entsprechendem Store) und rolling sendet neues Cookie
        req.session.touch();
        res.json({ status: "ok", expires: req.session.cookie.expires });
      } else {
        res.status(440).json({ status: "no-session" });
      }
    } catch (error) {
      logger.log("error", "Fehler beim KeepAlive der Session: " + error);
      res.status(500).json({ status: "error" });
    }
  });

  /* ######################### */
  /* ##### Monitoring     ##### */
  /* ######################### */

  // Check_MK Local Check: gibt Anwendungsstatus im Check_MK-Format aus (mehrere Services).
  // Nur von localhost erreichbar; keine Session-Auth erforderlich.
  app.get("/check_mk", async (req, res, next) => {
    const client_ip = req.ip;
    if (client_ip !== "127.0.0.1" && client_ip !== "::1" && client_ip !== "::ffff:127.0.0.1") {
      return res.status(403).end();
    }
    try {
      const [rows, stats] = await Promise.all([
        sql.db_client_get_connected(),
        sql.db_monitoring_get_stats(),
      ]);

      const lines = [];

      // Service 1: verbundene Clients
      const clients = rows || [];
      const total = clients.length;
      const waip  = clients.filter((c) => c.client_nsp === "/waip").length;
      const dbrd  = clients.filter((c) => c.client_nsp === "/dbrd").length;
      const alarm = clients.filter((c) => c.client_status && c.client_status !== "Standby").length;
      lines.push(`0 waip_clients total=${total};;;0;|waip=${waip};;;0;|dbrd=${dbrd};;;0;|alarm=${alarm};;;0; ${total} Clients (${waip}x /waip, ${dbrd}x /dbrd, ${alarm}x im Einsatz)`);

      // Service 2: Einsätze in der Datenbank
      const einsatz_total = stats.einsatz.total ?? 0;
      const last_min      = stats.einsatz.last_min;
      const last_text     = last_min != null ? `letzter vor ${last_min} min` : "keine Einsätze vorhanden";
      lines.push(`0 waip_einsaetze count=${einsatz_total};;;0;|last_min=${last_min ?? ""};;;0; ${einsatz_total} Einsätze in DB (${last_text})`);

      // Service 3: konfigurierte Wachen
      const wachen_total  = stats.wachen.total  ?? 0;
      const wachen_active = stats.wachen.active ?? 0;
      lines.push(`0 waip_wachen active=${wachen_active};;;0;|total=${wachen_total};;;0; ${wachen_active}/${wachen_total} Wachen aktiv konfiguriert`);

      // Service 4: Prozess-Laufzeit
      const uptime_s = Math.floor(process.uptime());
      const uptime_h = Math.floor(uptime_s / 3600);
      const uptime_m = Math.floor((uptime_s % 3600) / 60);
      lines.push(`0 waip_uptime seconds=${uptime_s};;;0; Laufzeit: ${uptime_h}h ${uptime_m}min`);

      res.type("text").send(lines.join("\n") + "\n");
    } catch (error) {
      logger.log("error", "Fehler beim Abrufen der Monitoring-Daten fuer Check_MK: " + error);
      res.type("text").send("3 waip_clients - Datenbankabfrage fehlgeschlagen\n");
    }
  });

  /* ######################### */
  /* ##### Einstellungen ##### */
  /* ######################### */

  // Einstellungen anzeigen
  app.get("/einstellungen", auth.ensureAuthenticated, async (req, res, next) => {
    try {
      const data = await sql.db_user_get_config(req.user.id);
      res.render("user/user_config", {
        public: app_cfg.public,
        title: "Einstellungen",
        user: req.user,
        user_reset_counter: data.resetcounter,
        session_max_age: app_cfg.global.session_cookie_max_age,
        error: req.query.error || null,
        success: req.query.success || null,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite für die Einstellungen. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Einstellungen zur Anzeigezeit speichern
  app.post("/einstellungen_zeit", auth.ensureAuthenticated, async (req, res) => {
    try {
      await sql.db_user_set_config_time(req.user.id, req.body.set_reset_counter);
      res.redirect("/einstellungen?success=" + encodeURIComponent("Einstellungen für die Anzeigezeit wurden erfolgreich gespeichert"));
    } catch (error) {
      res.redirect("/einstellungen?error=" + encodeURIComponent("Fehler beim Speichern der Einstellungen für die Anzeigezeit. " + error));
    }
  });

  /* ##################### */
  /* ##### Wachalarm ##### */
  /* ##################### */

  // /waip nach /waip/0 umleiten
  app.get("/waip", async (req, res, next) => {
    try {
      const data = await sql.db_wache_get_all();
      res.render("overviews/overview_waip", {
        public: app_cfg.public,
        title: "Alarmmonitor",
        list_wachen: data,
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /waip. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Alarmmonitor aufrufen /waip/<wachennummer>
  app.get("/waip/:wachen_id", async (req, res, next) => {
    try {
      const parameter_id = req.params.wachen_id;
      const rmldOff = req.query.rmld === "off"; // optionaler Parameter zum Deaktivieren der Rückmeldungen
      const soundOff = req.query.sound === "off"; // optionaler Parameter zum Deaktivieren der Audio-Blockadeprüfung
      const wache = await sql.db_wache_vorhanden(parameter_id);
      if (wache) {
        res.render("waip", {
          public: app_cfg.public,
          title: "Alarmmonitor - " + wache.name,
          wachen_id: parameter_id,
          data_wache: wache.name,
          map_service: app_cfg.public.map_service,
          app_id: app_cfg.global.app_id,
          user: req.user,
          session_max_age: app_cfg.global.session_cookie_max_age,
          rmld_off: rmldOff,
          sound_off: soundOff,
        });
      } else {
        const err = new Error(`Wache ${parameter_id} nicht vorhanden!`);
        err.status = 404;
        next(err);
      }
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /waip/${req.params.wachen_id}. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  /* ######################## */
  /* ###### Dashboard ####### */
  /* ######################## */

  // Dashboard-Übersicht anzeigen
  app.get("/dbrd", async (req, res, next) => {
    try {
      const data = await sql.db_einsatz_get_active();
      res.render("overviews/overview_dbrd", {
        public: app_cfg.public,
        title: "Dashboard",
        map_service: app_cfg.public.map_service,
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        dataSet: data,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /dbrd. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Dashboard für einen Einsatz anzeigen
  app.get("/dbrd/:dbrd_uuid", async (req, res, next) => {
    try {
      let dbrd_uuid = req.params.dbrd_uuid;
      const wache = await sql.db_einsatz_check_uuid(dbrd_uuid);
      if (wache) {
        res.render("dbrd", {
          public: app_cfg.public,
          title: "Dashboard",
          dbrd_uuid: dbrd_uuid,
          map_service: app_cfg.public.map_service,
          app_id: app_cfg.global.app_id,
          user: req.user,
          session_max_age: app_cfg.global.session_cookie_max_age,
        });
      } else {
        throw `Dashboard oder Einsatz mit der UUID ${dbrd_uuid} nicht (mehr) vorhanden!`;
      }
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /dbrd/<dbrd_uuid>. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  /* ########################## */
  /* ##### Administration ##### */
  /* ########################## */

  // verbundene Clients anzeigen
  app.get("/adm_show_clients", auth.ensureAdmin, async (req, res, next) => {
    try {
      const data = await sql.db_client_get_connected();
      res.render("admin/adm_show_clients", {
        public: app_cfg.public,
        title: "Verbundene PCs/Benutzer",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        dataSet: data,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /adm_show_clients. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // laufende Einsaetze anzeigen
  app.get("/adm_show_missions", auth.ensureAdmin, async (req, res, next) => {
    try {
      const data = await sql.db_einsatz_get_active();
      res.render("admin/adm_show_missions", {
        public: app_cfg.public,
        title: "Akutelle Einsätze",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        dataSet: data,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /adm_show_missions. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Logdatei
  app.get("/adm_show_log", auth.ensureAdmin, async (req, res, next) => {
    try {
      const data = await sql.db_log_get_10000();
      res.render("admin/adm_show_log", {
        public: app_cfg.public,
        title: "Log-Datei",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        dataSet: data,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /adm_show_log. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Benutzer editieren
  app.get("/adm_edit_users", auth.ensureAdmin, async (req, res, next) => {
    try {
      const data = await sql.db_user_get_all();
      res.render("admin/adm_edit_users", {
        public: app_cfg.public,
        title: "Benutzer und Rechte verwalten",
        user: req.user,
        users: data,
        session_max_age: app_cfg.global.session_cookie_max_age,
        error: req.query.error || null,
        success: req.query.success || null,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /adm_edit_users. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  app.post("/adm_edit_users", auth.ensureAdmin, (req, res) => {
    if (req.user && req.user.permissions == "admin") {
      switch (req.body["modal_method"]) {
        case "DELETE":
          auth.deleteUser(req, res);
          break;
        case "EDIT":
          auth.editUser(req, res);
          break;
        case "ADDNEW":
          auth.createUser(req, res);
          break;
      }
    } else {
      res.redirect("/adm_edit_users");
    }
  });

  // Wachen-Administration anzeigen
  app.get("/adm_edit_wachen", auth.ensureAdmin, async (req, res, next) => {
    try {
      const wachen = await sql.db_wachen_get_all_full();
      res.render("admin/adm_edit_wachen", {
        public: app_cfg.public,
        title: "Wachen verwalten",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        wachen,
        error: req.query.error || null,
        success: req.query.success || null,
      });
    } catch (error) {
      const err = new Error("Fehler beim Laden der Seite /adm_edit_wachen. " + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Wache bearbeiten
  app.post("/adm_edit_wachen/edit", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_wache_update(req.body);
      res.redirect("/adm_edit_wachen?success=" + encodeURIComponent("Wache erfolgreich bearbeitet."));
    } catch (error) {
      res.redirect("/adm_edit_wachen?error=" + encodeURIComponent("Fehler beim Bearbeiten der Wache. " + error));
    }
  });

  // Wache löschen
  app.post("/adm_edit_wachen/delete", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_wache_delete(req.body.id);
      res.redirect("/adm_edit_wachen?success=" + encodeURIComponent("Wache erfolgreich gelöscht."));
    } catch (error) {
      res.redirect("/adm_edit_wachen?error=" + encodeURIComponent("Fehler beim Löschen der Wache. " + error));
    }
  });

  // Neue Wache anlegen
  app.post("/adm_edit_wachen/create", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_wache_create(req.body);
      res.redirect("/adm_edit_wachen?success=" + encodeURIComponent("Wache erfolgreich angelegt."));
    } catch (error) {
      res.redirect("/adm_edit_wachen?error=" + encodeURIComponent("Fehler beim Anlegen der Wache. " + error));
    }
  });

  // Ersetzungen-Administration anzeigen
  app.get("/adm_edit_replace", auth.ensureAdmin, async (req, res, next) => {
    try {
      const replace = await sql.db_replace_get_all_full();
      res.render("admin/adm_edit_replace", {
        public: app_cfg.public,
        title: "Ersetzungen verwalten",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        replace,
        error: req.query.error || null,
        success: req.query.success || null,
      });
    } catch (error) {
      const err = new Error("Fehler beim Laden der Seite /adm_edit_replace. " + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Ersetzung bearbeiten
  app.post("/adm_edit_replace/edit", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_replace_update(req.body);
      res.redirect("/adm_edit_replace?success=" + encodeURIComponent("Ersetzung erfolgreich bearbeitet."));
    } catch (error) {
      res.redirect("/adm_edit_replace?error=" + encodeURIComponent("Fehler beim Bearbeiten der Ersetzung. " + error));
    }
  });

  // Ersetzung löschen
  app.post("/adm_edit_replace/delete", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_replace_delete(req.body.id);
      res.redirect("/adm_edit_replace?success=" + encodeURIComponent("Ersetzung erfolgreich gelöscht."));
    } catch (error) {
      res.redirect("/adm_edit_replace?error=" + encodeURIComponent("Fehler beim Löschen der Ersetzung. " + error));
    }
  });

  // Neue Ersetzung anlegen
  app.post("/adm_edit_replace/create", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_replace_create(req.body);
      res.redirect("/adm_edit_replace?success=" + encodeURIComponent("Ersetzung erfolgreich angelegt."));
    } catch (error) {
      res.redirect("/adm_edit_replace?error=" + encodeURIComponent("Fehler beim Anlegen der Ersetzung. " + error));
    }
  });

  /* ###################### */
  /* ##### Testseiten ##### */
  /* ###################### */

  // Wachalarm-Uhr testen
  app.get("/test_clock", function (req, res) {
    res.render("tests/test_clock", {
      public: app_cfg.public,
      title: "Test Datum/Uhrzeit",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
    });
  });

  // Alarmmonitor testen
  app.get("/test_wachalarm", function (req, res) {
    res.render("tests/test_wachalarm", {
      public: app_cfg.public,
      title: "Test Wachalarm",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
    });
  });

  // Dashboard testen
  app.get("/test_dashboard", function (req, res) {
    res.render("tests/test_dashboard", {
      public: app_cfg.public,
      title: "Test Dashboard",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
    });
  });

  /* ######################## */
  /* ##### Fehlerseiten ##### */
  /* ######################## */

  // 404 abfangen und an error handler weiterleiten
  app.use((req, res, next) => {
    let err = new Error("Seite nicht gefunden!");
    err.status = 404;
    next(err);
  });

  // error handler
  app.use((err, req, res, next) => {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = app_cfg.development.dev_log ? err : {};
    // render the error page
    res.status(err.status || 500);
    res.render("page_error", {
      public: app_cfg.public,
      user: req.user,
    });
  });
};
