// Basis-Konfiguration laden und generische App-UUID erzeugen
const app_cfg = require("./server/app_cfg.js");
// Module laden
const fs = require("fs");
const express = require("express");
const app = express();
const http = require("http");
const https = require("https");
const webserver = https.createServer(
  {
    key: fs.readFileSync("./misc/server.key", "utf8"),
    cert: fs.readFileSync("./misc/server.cert", "utf8"),
  },
  app
);
const io = require("socket.io")(webserver, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
});

const path = require("path");
const favicon = require("serve-favicon");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const passport = require("passport");
const { v4: uuidv4 } = require("uuid");

// generische App-UUID erzeugen
app_cfg.global.app_id = uuidv4();
app_cfg.public.version = require("./package.json").version;

// Express-Einstellungen definieren
app.set("views", path.join(__dirname, "views"));
app.locals.basedir = app.get("views");
app.set("view engine", "pug");
if (!app_cfg.global.development) {
  app.set("view cache", true);
}
app.use(favicon(path.join(__dirname, "public", "favicon.ico")));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: false,
  })
);

// Scripte einbinden
let sql_cfg = require("./server/sql_cfg.js")(bcrypt, app_cfg);
let sql = require("./server/sql_qry.js")(sql_cfg, app_cfg);
let logger = require("./server/logger.js")(sql, app_cfg);
let waip = require("./server/waip.js")(io, sql, fs, logger, app_cfg);
let saver = require("./server/saver.js")(app_cfg, sql, waip, uuidv4, logger);
let socket = require("./server/socket.js")(io, sql, app_cfg, logger, waip);
let auth = require("./server/auth.js")(app, app_cfg, sql, bcrypt, passport, io, logger);
let routes = require("./server/routing.js")(app, sql, app_cfg, passport, auth, saver, logger);

// Server starten
webserver.listen(app_cfg.global.https_port, () => {
  sql.db_log("Anwendung", "Wachalarm-IP-Webserver auf Port " + app_cfg.global.https_port + " gestartet");
});

// Redirect all HTTP traffic to HTTPS
http
  .createServer((req, res) => {
    let host = req.headers.host;
    // prüfen ob host gesetzt, sonst 404
    if (typeof host !== "undefined" && host) {
      // Anfrage auf https umleiten
      host = host.replace(/:\d+$/, ":" + app_cfg.global.https_port);
      res.writeHead(301, {
        Location: "https://" + host + req.url,
      });
      res.end();
    } else {
      // HTTP status 404: NotFound
      res.writeHead(404, {
        "Content-Type": "text/plain",
      });
      res.write("404 Not Found - use https instead!\n");
      res.end();
    }
  })
  .listen(app_cfg.global.http_port);
