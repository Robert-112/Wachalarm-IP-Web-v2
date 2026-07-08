module.exports = (app, app_cfg, sql, bcrypt, passport, io, logger) => {
  const session = require("express-session");
  const SQLiteSessionStore = require("./session_store.js")(app_cfg, logger);
  const LocalStrategy = require("passport-local").Strategy;
  const CertStrategy = require("passport-trusted-header").Strategy;
  const sessionStore = new SQLiteSessionStore();

  // JWT-Authentifizierung
  const jwt = require("jsonwebtoken");
  const passportJWT = require("passport-jwt");
  let ExtractJwt = passportJWT.ExtractJwt;
  let JwtStrategy = passportJWT.Strategy;
  let jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: app_cfg.global.jwtsecret,
  };

  const sessionMiddleware = session({
    store: sessionStore,
    key: "connect.sid",
    secret: app_cfg.global.sessionsecret,
    resave: false,
    saveUninitialized: true,
    // rolling: true sorgt dafür, dass bei jeder Antwort das Ablaufdatum des Cookies erneuert wird,
    // solange der Client aktiv bleibt.
    rolling: true,
    cookie: {
      maxAge: app_cfg.global.session_cookie_max_age,
    },
  });

  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  function onlyForHandshake(middleware) {
    return (req, res, next) => {
      const isHandshake = req._query.sid === undefined;
      if (isHandshake) {
        middleware(req, res, next);
      } else {
        next();
      }
    };
  }

  io.engine.use(onlyForHandshake(sessionMiddleware));
  io.engine.use(onlyForHandshake(passport.session()));
  io.engine.use(
    onlyForHandshake((req, res, next) => {
      if (req.user) {
        next();
      } else {
        //res.writeHead(401);
        //res.end();
        next();
      }
    })
  );

  // Benutzerauthentifizierung per Login
  passport.use(
    new LocalStrategy(
      {
        usernameField: "user",
      },
      async (user, password, done) => {
        try {
          // Verschlüsseltes Passwort aus DB abfragen
          const row = await sql.auth_localstrategy_cryptpassword(user);
          if (!row) return done(null, false);
          // Passwort-Hash mit dem aus der DB vergleichen
          const res = await bcrypt.compare(password, row.password);
          if (!res) return done(null, false);
          // Benutzerdaten zurückgeben
          const userRow = await sql.auth_localstrategy_userid(user);
          return done(null, userRow);
        } catch (error) {
          logger.log("error", "Fehler bei der Benutzer-Authentifizierung: " + error);
        }
      }
    )
  );

  // Optionen für die Trusted Header Strategie, Schreibweise der Header ist entscheidend!
  var certOptions = {
    headers: ["x-ssl-client-dn"],
  };

  // Trusted Header Strategie für Client-Zertifikate
  passport.use(
    new CertStrategy(certOptions, async (requestHeaders, done) => {
      try {
        // Überprüfen, ob der Header x-ssl-client-dn vorhanden ist und daraus DN und CN extrahieren
        const dn = requestHeaders["x-ssl-client-dn"];
        const cn = dn.split(",")[0].split("=")[1];

        // User anhand des CN (Common Name) aus der Datenbank holen
        let user_id = await sql.auth_certstrategy_userid(cn);
        if (user_id) {
          logger.log("debug", "Benutzer gefunden für CN: " + cn);
          return done(null, user_id);
        }
        logger.log("debug", "Kein Benutzer gefunden für CN: " + cn);
        // Kein Benutzer gefunden, Authentifizierung fehlgeschlagen
        return done(null, false);
      } catch (error) {
        logger.log("error", "Fehler bei der Authentifizierung mit Client-Zertifikat: " + error);
      }
    })
  );

  // JWT-Authentifizierung
  passport.use(
    new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
      // User anhand der ID aus dem Token holen
      let user_id = await sql.auth_getUser(jwt_payload.id);
      if (user_id) {
        return done(null, user_id);
      }
      return done(null, false);
    })
  );

  // Funktion die den Benutzer anhand der ID speichert
  passport.serializeUser((user, done) => {
    return done(null, user.id);
  });

  // Funktion die den Benutzer anhand der ID wiederherstellt
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await sql.auth_deserializeUser(id);
      if (!user) {
        return done(null, false);
      } else {
        return done(null, user);
      }
    } catch (error) {
      logger.log("error", "Fehler bei passport.deserializeUser: " + error);
    }
  });

  // Funktion die prueft ob der Benutzer angemeldet ist
  const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
      // req.user is available for use here
      return next();
    }
    // denied. redirect to login
    let err = new Error("Sie sind nicht angemeldet!");
    err.status = 401;
    next(err);
  };

  const ensureAdmin = async (req, res, next) => {
    if (req.isAuthenticated()) {
      const is_admin = await sql.auth_ensureAdmin(req.user.id);
      if (is_admin) {
        // req.user is available for use here
        return next();
      } else {
        let err = new Error("Sie verfügen nicht über die notwendigen Berechtigungen!");
        err.status = 401;
        next(err);
      }
    } else {
      // denied. redirect to login
      let err = new Error("Sie sind nicht angemeldet!");
      err.status = 401;
      next(err);
    }
  };

  const ensureApi = (user_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        const api_user = await sql.auth_ensureApi(user_id);
        if (api_user) {
          // User wird mit seiner ID identifiziert
          let payload = { id: user_id };
          // Gültigkeit des API-Tokens auf 15 Minuten begrenzen
          let token = jwt.sign(payload, jwtOptions.secretOrKey, { expiresIn: "15m" });
          resolve(token);
        } else {
          resolve(null);
        }
      } catch (error) {
        logger.log("error", "Fehler beim Prüfen der API-Berechtigung für einen User: " + error);
        resolve(null);
      }
    });
  };

  const createUser = async (req, res) => {
    try {
      const hash = await bcrypt.hash(req.body.password, app_cfg.global.saltRounds);
      const result = await sql.auth_create_new_user(req.body.username, hash, req.body.description || "", req.body.permissions, req.body.ip);
      if (result) {
        return res.redirect(
          "/adm_edit_users?success=" + encodeURIComponent("Neuer Benutzer wurde angelegt.")
        );
      } else {
        throw new Error("Fehler beim Erstellen eines neuen Benutzers. " + req.body.username);
      }
    } catch (error) {
      logger.log("error", "Fehler beim Erstellen eines neuen Benutzers: " + error);
      return res.redirect(
        "/adm_edit_users?error=" +
          encodeURIComponent("Fehler beim Erstellen eines neuen Benutzers. Bitte Log-Datei prüfen.")
      );
    }
  };

  const deleteUser = async (req, res) => {
    try {
      if (req.user.id == req.body.id) {
        return res.redirect(
          "/adm_edit_users?error=" + encodeURIComponent("Sie können sich nicht selbst löschen!")
        );
      } else {
        const result = await sql.auth_deleteUser(req.body.id);
        if (result) {
          return res.redirect(
            "/adm_edit_users?success=" +
              encodeURIComponent("Benutzer '" + req.body.username + "' wurde gelöscht!")
          );
        } else {
          throw new Error("Fehler beim Löschen eines Benutzers. " + req.body.username);
        }
      }
    } catch (error) {
      logger.log("error", "Fehler beim Löschen eines Benutzers: " + error);
      return res.redirect(
        "/adm_edit_users?error=" +
          encodeURIComponent("Fehler beim Löschen eines Benutzers. Bitte Log-Datei prüfen.")
      );
    }
  };

  const editUser = async (req, res) => {
    try {
      let runquery = false;
      let query = "UPDATE waip_user SET ";
      let messages = [];

      if (req.body.password && req.body.password.length > 0) {
        const hash = await bcrypt.hash(req.body.password, app_cfg.global.saltRounds);
        messages.push("Passwort geändert.");
        query += "password = '" + hash + "', ";
        runquery = true;
      }

      if (req.user.id == req.body.modal_id && req.body.permissions != "admin") {
        return res.redirect(
          "/adm_edit_users?error=" +
            encodeURIComponent("Sie können Ihr Recht als Administrator nicht selbst ändern!")
        );
      } else {
        query += "description = '" + (req.body.description || "").replace(/'/g, "''") + "', permissions = '" + req.body.permissions + "', ip_address ='" + req.body.ip + "'";
        runquery = true;
      }

      if (runquery) {
        query += " WHERE id = " + req.body.modal_id;
        logger.log("debug", "Edit User Query: " + query);
        const result = await sql.auth_editUser(query);
        if (result) {
          const successMsg = messages.concat(["Benutzer aktualisiert."]).join(" ");
          return res.redirect(
            "/adm_edit_users?success=" + encodeURIComponent(successMsg)
          );
        } else {
          throw new Error("Fehler beim Ändern eines Benutzers.");
        }
      } else {
        return res.redirect(
          "/adm_edit_users?error=" +
            encodeURIComponent("Fehler beim Ändern eines Benutzers.")
        );
      }
    } catch (error) {
      logger.log("error", "Fehler beim Ändern eines Benutzers: " + error);
      return res.redirect(
        "/adm_edit_users?error=" +
          encodeURIComponent("Fehler beim Ändern eines Benutzers. Bitte Log-Datei prüfen.")
      );
    }
  };

  return {
    ensureAuthenticated: ensureAuthenticated,
    ensureAdmin: ensureAdmin,
    ensureApi: ensureApi,
    createUser: createUser,
    deleteUser: deleteUser,
    editUser: editUser,
  };
};
