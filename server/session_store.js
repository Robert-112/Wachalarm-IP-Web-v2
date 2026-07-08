module.exports = (app_cfg, logger) => {
  const Database = require("better-sqlite3");
  const session = require("express-session");

  // Eine Woche, analog zum bisherigen Default von connect-sqlite3 (oneDay), hier aber
  // nur relevant, falls ein Cookie ohne maxAge gespeichert wird.
  const ONE_DAY = 86400000;

  // Ersetzt connect-sqlite3 (unsicherer sqlite3-Treiber, siehe Sicherheitsaudit).
  // Nutzt bewusst dieselbe Datei/Tabelle/Spalten wie connect-sqlite3, damit bestehende
  // Sessions beim Upgrade übernommen werden und niemand vom Alarmmonitor abgemeldet wird.
  class SQLiteSessionStore extends session.Store {
    constructor(options = {}) {
      super(options);

      this.table = options.table || "sessions";
      const dbPath = options.db || app_cfg.global.sessions_database;

      this.db = new Database(dbPath);
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${this.table} (sid PRIMARY KEY, expired, sess)`
      );

      this.stmts = {
        get: this.db.prepare(`SELECT sess FROM ${this.table} WHERE sid = ? AND ? <= expired`),
        set: this.db.prepare(`INSERT OR REPLACE INTO ${this.table} VALUES (?, ?, ?)`),
        destroy: this.db.prepare(`DELETE FROM ${this.table} WHERE sid = ?`),
        touch: this.db.prepare(`UPDATE ${this.table} SET expired = ? WHERE sid = ? AND ? <= expired`),
        all: this.db.prepare(`SELECT * FROM ${this.table}`),
        length: this.db.prepare(`SELECT COUNT(*) AS count FROM ${this.table}`),
        clear: this.db.prepare(`DELETE FROM ${this.table}`),
        cleanup: this.db.prepare(`DELETE FROM ${this.table} WHERE ? > expired`),
      };

      this.cleanup();
      this.cleanupTimer = setInterval(() => this.cleanup(), ONE_DAY).unref();
    }

    cleanup() {
      try {
        this.stmts.cleanup.run(Date.now());
      } catch (error) {
        logger.log("error", "Fehler beim Aufräumen abgelaufener Sessions: " + error);
      }
    }

    get(sid, fn) {
      try {
        const row = this.stmts.get.get(sid, Date.now());
        if (!row) return fn();
        fn(null, JSON.parse(row.sess));
      } catch (error) {
        fn(error);
      }
    }

    set(sid, sess, fn) {
      try {
        const maxAge = sess.cookie.maxAge;
        const now = Date.now();
        const expired = maxAge ? now + maxAge : now + ONE_DAY;
        this.stmts.set.run(sid, expired, JSON.stringify(sess));
        if (fn) fn();
      } catch (error) {
        if (fn) fn(error);
      }
    }

    destroy(sid, fn) {
      try {
        this.stmts.destroy.run(sid);
        if (fn) fn();
      } catch (error) {
        if (fn) fn(error);
      }
    }

    touch(sid, sess, fn) {
      try {
        if (sess && sess.cookie && sess.cookie.expires) {
          const cookieExpires = new Date(sess.cookie.expires).getTime();
          this.stmts.touch.run(cookieExpires, sid, Date.now());
        }
        if (fn) fn();
      } catch (error) {
        if (fn) fn(error);
      }
    }

    all(fn) {
      try {
        const rows = this.stmts.all.all();
        fn(null, rows.map((row) => JSON.parse(row.sess)));
      } catch (error) {
        fn(error);
      }
    }

    length(fn) {
      try {
        fn(null, this.stmts.length.get().count);
      } catch (error) {
        fn(error);
      }
    }

    clear(fn) {
      try {
        this.stmts.clear.run();
        fn(null, true);
      } catch (error) {
        fn(error);
      }
    }
  }

  return SQLiteSessionStore;
};
