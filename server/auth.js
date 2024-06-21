const sql_cfg = require("./sql_cfg");

module.exports = (app, app_cfg, sql, async, bcrypt, passport, io) => {
  let session = require("express-session");
  let cookieParser = require("cookie-parser");
  let flash = require("req-flash");
  let SQLiteStore = require("connect-sqlite3")(session);
  let LocalStrategy = require("passport-local").Strategy;
  let IpStrategy = require("passport-ip").Strategy;
  let passportSocketIo = require("passport.socketio");
  let sessionStore = new SQLiteStore({
    //db: app_cfg.global.database,
    //concurrentDB: true
  });

  app.use(
    session({
      store: sessionStore,
      key: "connect.sid",
      secret: app_cfg.global.sessionsecret,
      resave: false,
      saveUninitialized: true,
      cookie: {
        maxAge: 60 * 60 * 1000,
      }, // Standard ist eine Stunde
    })
  );
  app.use(cookieParser());
  app.use(flash());
  app.use(passport.initialize());
  app.use(passport.session());

  io.use(
    passportSocketIo.authorize({
      cookieParser: cookieParser, // the same middleware you registrer in express
      key: "connect.sid", // the name of the cookie where express/connect stores its session_id
      secret: app_cfg.global.sessionsecret, // the session_secret to parse the cookie
      store: sessionStore, // we NEED to use a sessionstore. no memorystore please
      success: function (data, accept) {
        //console.log('successful connection to socket.io');
        accept(null, true);
      },
      fail: function (data, message, error, accept) {
        //console.log('failed connection to socket.io:', data, message);
        accept(null, true);
      },
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
          const row = await sql.auth_localstrategy_cryptpassword(user);
          if (!row) return done(null, false);
          const res = await bcrypt.compare(password, row.password);
          if (!res) return done(null, false);
          const userRow = await sql.auth_localstrategy_userid(user);
          return done(null, userRow);
        } catch (error) {
          console.error(error);
        }
      }
    )
  );

  // Benutzerauthentifizierung per IP-Adresse
  passport.use(
    new IpStrategy(
      {
        range: app_cfg.global.ip_auth_range,
      },
      async (profile, done) => {
        let profile_ip = profile.id;
        profile_ip = profile_ip.replace(/^(::ffff:)/, "");
        try {
          const row = await sql.auth_ipstrategy(profile_ip);
          if (!row) {
            return done(null, false);
          } else {
            return done(null, row);
          }
        } catch (error) {
          console.error(error);
        }
      }
    )
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
      console.error(error);
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
      const permissions = await sql.auth_ensureAdmin(req.user.id);
      if (permissions == "admin") {
        // req.user is available for use here
        return next();
      } else {
        let err = new Error(
          "Sie verfügen nicht über die notwendigen Berechtigungen!"
        );
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

  const createUser = async (req, res) => {
    try {
      const row = await sql.auth_createUser(req.body.username);
      if (row) {
        req.flash(
          "errorMessage",
          "Es existiert bereits ein Benutzer mit diesem Namen!"
        );
        res.redirect("/adm_edit_users");
      } else {
        const hash = await bcrypt.hash(
          req.body.password,
          app_cfg.global.saltRounds
        );
        const result = await sql.auth_create_new_user(
          req.body.username,
          hash,
          req.body.permissions,
          req.body.ip
        );
        if (result) {
          req.flash("successMessage", "Neuer Benutzer wurde angelegt.");
          res.redirect("/adm_edit_users");
        } else {
          req.flash("errorMessage", "Da ist etwas schief gegangen...");
          res.redirect("/adm_edit_users");
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  const deleteUser = async (req, res) => {
    try {
      if (req.user.id == req.body.id) {
        req.flash("errorMessage", "Sie können sich nicht selbst löschen!");
        res.redirect("/adm_edit_users");
      } else {
        const result = await sql.auth_deleteUser(req.body.id);
        if (result) {
          req.flash(
            "successMessage",
            "Benutzer '" + req.body.username + "' wurde gelöscht!"
          );
          res.redirect("/adm_edit_users");
        } else {
          req.flash("errorMessage", "Da ist etwas schief gegangen...");
          res.redirect("/adm_edit_users");
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  const editUser = async (req, res) => {
    try {
      req.runquery = false;
      req.query = "UPDATE waip_users SET ";

      if (req.body.password.length == 0) {
        req.flash("successMessage", "Passwort wurde nicht geändert.");
      } else {
        const hash = await bcrypt.hash(
          req.body.password,
          app_cfg.global.saltRounds
        );
        req.flash("successMessage", "Passwort geändert.");
        req.query += "password = '" + hash + "', ";
        req.runquery = true;
      }

      if (req.user.id == req.body.modal_id && req.body.permissions != "admin") {
        req.flash(
          "errorMessage",
          "Sie können Ihr Recht als Administrator nicht selbst ändern!"
        );
      } else {
        req.query +=
          "permissions = '" +
          req.body.permissions +
          "', ip_address ='" +
          req.body.ip +
          "'";
        req.runquery = true;
      }

      if (req.runquery == true) {
        req.query += " WHERE id = " + req.body.modal_id;
        console.log(req.query);
        const result = await sql.auth_editUser(req.query);
        if (result) {
          req.flash("successMessage", "Benutzer aktualisiert.");
          res.redirect("/adm_edit_users");
        } else {
          req.flash("errorMessage", "Da ist etwas schief gegangen...");
          res.redirect("/adm_edit_users");
          throw new Error("Fehler beim Ändern eines Benutzers.");
        }
      } else {
        req.flash("errorMessage", "Da ist etwas schief gegangen...");
        res.redirect("/adm_edit_users");
      }
    } catch (error) {
      console.error(error);
    }
  };

  return {
    ensureAuthenticated: ensureAuthenticated,
    ensureAdmin: ensureAdmin,
    createUser: createUser,
    deleteUser: deleteUser,
    editUser: editUser,
  };
};
