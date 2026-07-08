const fs = require("fs");
const path = require("path");

// .env laden (kein externes Paket noetig)
try {
  const lines = fs.readFileSync(path.resolve(__dirname, "../.env"), "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env nicht gefunden – Umgebungsvariablen des Systems werden verwendet
}

const app_cfg = {};

app_cfg.global = {
  http_port: Number(process.env.HTTP_PORT) || 3001,
  database: process.env.DATABASE || "./database.sqlite3",
  sessions_database: process.env.SESSIONS_DATABASE || "./sessions",
  db_limit: Number(process.env.DB_LIMIT) || 500,
  db_limit_log: Number(process.env.DB_LIMIT_LOG) || 100000,
  soundpath: process.env.SOUNDPATH || "/public/media/",
  mediapath: process.env.MEDIAPATH || "/media/",
  uuidNamespace: process.env.UUID_NAMESPACE || "59cc72ec-4ff5-499d-81e2-ec49c1d01252",
  time_to_delete_waip: Number(process.env.TIME_TO_DELETE_WAIP) || 30,
  default_time_for_standby: Number(process.env.DEFAULT_TIME_FOR_STANDBY) || 15,
  system_cleanup_time: Number(process.env.SYSTEM_CLEANUP_TIME) || 10000,
  defaultuser: process.env.DEFAULT_USER || "me",
  defaultpass: process.env.DEFAULT_PASS || "123",
  defaultapiuser: process.env.DEFAULT_API_USER || "apiuser",
  defaultapipass: process.env.DEFAULT_API_PASS || "apiuser123",
  defaultuserip: process.env.DEFAULT_USER_IP || "127.0.0.1",
  saltRounds: Number(process.env.SALT_ROUNDS) || 10,
  sessionsecret: process.env.SESSION_SECRET || "0987654321abcdef#xyz",
  jwtsecret: process.env.JWT_SECRET || "1234567890abcdef#xyz",
  session_cookie_max_age: Number(process.env.SESSION_COOKIE_MAX_AGE) || 60000,
  authRegex: process.env.AUTH_REGEX || "(\\d+)[\\.\\-](\\d+)[\\.\\-](\\w+)",
  rightsRegex: process.env.RIGHTS_REGEX || "\\.(\\d+)[.-]",
};

app_cfg.development = {
  dev_log: (process.env.DEV_LOG ?? "true") === "true",
  dev_sqlite: (process.env.DEV_SQLITE ?? "true") === "true",
};

app_cfg.public = {
  url: process.env.PUBLIC_URL || "https://waip.nix.nix",
  app_name: process.env.APP_NAME || "Wachalarm IP-Web",
  app_info: process.env.APP_INFO ?? "(Development Version)",
  company: process.env.COMPANY || "Netzwerk 112",
  // "tile" fuer Tile-Server, "wms" fuer WMS-Server (Backup: Tile-Server)
  map_service: {
    type: process.env.MAP_SERVICE_TYPE || "wms",
    tile_url: process.env.MAP_TILE_URL || "https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png",
    wms_url: process.env.MAP_WMS_URL || "",
    wms_layers: process.env.MAP_WMS_LAYERS || "OSM-WMS",
    wms_format: process.env.MAP_WMS_FORMAT || "image/png",
    wms_transparent: (process.env.MAP_WMS_TRANSPARENT ?? "true") === "true",
    wms_version: process.env.MAP_WMS_VERSION || "1.1.1",
  },
  ext_imprint: (process.env.EXT_IMPRINT ?? "false") === "true",
  url_imprint: process.env.URL_IMPRINT || "https://www.nix.nix/impressium",
  ext_privacy: (process.env.EXT_PRIVACY ?? "false") === "true",
  url_privacy: process.env.URL_PRIVACY || "https://www.nix.nix/datenschutz",
  show_login: (process.env.SHOW_LOGIN ?? "true") === "true",
};

app_cfg.osrm = {
  enabled: (process.env.OSRM_ENABLED ?? "false") === "true",
  host: process.env.OSRM_HOST || "localhost",
  port: Number(process.env.OSRM_PORT) || 5000,
};

app_cfg.tts = {
  provider: process.env.TTS_PROVIDER || "local",
  piper_host: process.env.PIPER_HOST || "localhost",
  piper_port: Number(process.env.PIPER_PORT) || 10200,
  piper_voice: process.env.PIPER_VOICE || "de_DE-thorsten_emotional-medium",
};

module.exports = app_cfg;
