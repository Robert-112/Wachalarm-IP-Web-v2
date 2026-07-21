// TODO: Remote-Reload per Socket


$(document).ready(function () {
  set_clock();
  updateWachennameAnimation();
  startRandomPositioning();
});

let _resize_debounce = null;
$(window).on("resize", function () {
  // Debounce: textFit erst nach Abschluss des Resize ausführen, nicht bei jedem Event
  clearTimeout(_resize_debounce);
  _resize_debounce = setTimeout(function () {
    resize_text(true);
    updateWachennameAnimation();
    updateRandomPosition();
  }, 250);
});

// Funktion zum Hinzufügen eines Kartenlayers (Tile oder WMS)
function AddMapLayer(targetMap) {
  const m = targetMap || map;
  let maxMapZoom = 18;

  if (map_service.type === "tile") {
    L.tileLayer(map_service.tile_url, { maxZoom: maxMapZoom }).addTo(m);
  } else if (map_service.type === "wms") {
    var wmsLayer = L.tileLayer.wms(map_service.wms_url, {
      layers: map_service.wms_layers,
      format: map_service.wms_format,
      transparent: map_service.wms_transparent,
      version: map_service.wms_version,
    });
    wmsLayer.once("tileerror", function () {
      console.warn("WMS-Layer konnte nicht geladen werden, versuche Tile-Layer:", map_service.tile_url);
      m.removeLayer(wmsLayer);
      L.tileLayer(map_service.tile_url, { maxZoom: maxMapZoom }).addTo(m);
    });
    wmsLayer.addTo(m);
  }
}

/* ############################ */
/* ######### BUTTONS ########## */
/* ############################ */

let waipAudio = document.getElementById("audio");
// Flag für laufendes TTS
let ttsActive = false;
let lastTTSSrc = null;
// Toast-Referenz für blockierte Audio-Wiedergabe
let audioBlockedToast = null;
// Flag ob Browser (noch) Autoplay blockiert
let audioBlocked = false;

// JS-basiertes Blinken – ersetzt CSS-Animation (schont CPU auf schwacher Hardware)
let _blinkInterval = null;
let _blinkElements = new Set();
let _blinkOn = true;

function startBlink(el) {
  if (!el) return;
  _blinkElements.add(el);
  if (!_blinkInterval) {
    _blinkInterval = setInterval(function () {
      _blinkOn = !_blinkOn;
      _blinkElements.forEach(function (e) { e.style.opacity = _blinkOn ? "1" : "0.15"; });
    }, 800);
  }
}

function stopAllBlinks() {
  if (_blinkInterval) { clearInterval(_blinkInterval); _blinkInterval = null; }
  _blinkElements.forEach(function (e) { e.style.opacity = ""; });
  _blinkElements.clear();
  _blinkOn = true;
}

// Autoplay-Blockade anzeigen (Blinken des Volume-Off Icons)
function indicateAudioBlocked() {
  try {
    // Wenn Sound explizit deaktiviert wurde (Query-Parameter ?sound=off -> sound_off=true), dann keine Prüfung / UI-Anzeige
    if (typeof sound_off !== "undefined" && sound_off === true) {
      return; // still bleiben
    }
    let icon = document.querySelector(".ion-md-volume-off") || document.querySelector(".ion-md-volume-high");
    if (!icon) return;
    if (icon.classList.contains("ion-md-volume-high")) {
      icon.classList.remove("ion-md-volume-high");
      icon.classList.add("ion-md-volume-off");
    }
    // Blinken starten
    startBlink(icon);
    audioBlocked = true; // Blockade markieren
    showAudioBlockedToast();
  } catch (e) {
    console.log("indicateAudioBlocked error", e);
  }
}

function resetAudioUi() {
  let tmp_element;
  // Pause-Symbol in Play-Symbol
  tmp_element = document.querySelector(".ion-md-pause");
  if (tmp_element && tmp_element.classList.contains("ion-md-pause")) {
    tmp_element.classList.remove("ion-md-pause");
    tmp_element.classList.add("ion-md-play-circle");
  }
  // Lautsprecher-Symbol in Leise-Symbol
  tmp_element = document.querySelector(".ion-md-volume-high");
  if (tmp_element && tmp_element.classList.contains("ion-md-volume-high")) {
    tmp_element.classList.remove("ion-md-volume-high");
    tmp_element.classList.add("ion-md-volume-off");
  }
  // Button Hintergrund entfernen, falls vorhanden
  tmp_element = document.querySelector("#volume");
  if (tmp_element && tmp_element.classList.contains("btn-danger")) {
    tmp_element.classList.remove("btn-danger");
  }
  // Toast nur entfernen, wenn Autoplay NICHT mehr blockiert ist
  if (!audioBlocked) {
    removeAudioBlockedToast();
  }
}

// Flag: Listener am Toast-Element wurden bereits registriert (verhindert Akkumulation)
let toastListenersAdded = false;

// Toast erstellen – erscheint oben links über der Karte
function tryActivate(evt) {
  try {
    if (evt) evt.stopPropagation();
    // Falls Audio schon läuft einfach Toast schließen
    if (!waipAudio.paused) {
      removeAudioBlockedToast();
      return;
    }
    const p = waipAudio.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        audioBlocked = false; // Erfolg -> Blockade aufgehoben
        removeAudioBlockedToast();
      }).catch((err) => {
        console.log("tryActivate play blocked", err);
        audioBlocked = true;
      });
    } else {
      // Ältere Browser ohne Promise
      audioBlocked = false; // wird als Erfolg gewertet
      removeAudioBlockedToast();
    }
  } catch (e) {
    console.log("tryActivate error", e);
    audioBlocked = true;
  }
}

function showAudioBlockedToast() {
  try {
    const container = document.getElementById("audio-toast-container");
    const toast = document.getElementById("audio-blocked-toast");
    if (!container || !toast) return;
    // Click-/Close-Listener nur einmalig am Toast-Element registrieren
    if (!toastListenersAdded) {
      toast.addEventListener("click", tryActivate);
      const closeBtn = toast.querySelector(".close");
      if (closeBtn)
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          removeAudioBlockedToast();
        });
      toastListenersAdded = true;
    }
    if (!audioBlockedToast) {
      // Globale einmalige Listener neu registrieren (entfernen sich nach erstem Auslösen selbst)
      document.addEventListener("keydown", tryActivate, { once: true });
      document.addEventListener("click", tryActivate, { once: true });
    }
    // Sichtbar machen
    container.classList.remove("d-none");
    toast.classList.add("show");
    // Icon blinken lassen
    const iconInToast = toast.querySelector(".ion-md-volume-off");
    if (iconInToast) startBlink(iconInToast);
    audioBlockedToast = toast;
  } catch (e) {
    console.log("showAudioBlockedToast error", e);
  }
}

// Toast entfernen
function removeAudioBlockedToast() {
  if (audioBlockedToast) {
    const container = document.getElementById("audio-toast-container");
    if (container) container.classList.add("d-none");
    audioBlockedToast.classList.remove("show");
    audioBlockedToast = null;
    audioBlocked = false; // Beim expliziten Entfernen Flag zurücksetzen
  }
}

waipAudio.addEventListener("ended", function () {
  console.log("ended");
  resetAudioUi();
  // TTS-Flag zurücksetzen
  if (lastTTSSrc && waipAudio.src.indexOf("bell_message.mp3") === -1) {
    ttsActive = false;
    //lastTTSSrc = null;
  }
});

// Neuer Pause-Handler (nutzerinitiiert)
waipAudio.addEventListener("pause", function () {
  // Wenn wirklich pausiert (nicht direkt nach play), UI anpassen
  if (waipAudio.paused) {
    resetAudioUi();
    if (ttsActive) {
      ttsActive = false;
      //lastTTSSrc = null;
    }
  }
});

waipAudio.addEventListener("play", function () {
  let tmp_element;
  // Beim erfolgreichen Start Blinken stoppen
  stopAllBlinks();
  audioBlocked = false; // Wiedergabe läuft
  // Pause-Symbol in Play-Symbol
  tmp_element = document.querySelector(".ion-md-play-circle");
  if (tmp_element && tmp_element.classList.contains("ion-md-play-circle")) {
    tmp_element.classList.remove("ion-md-play-circle");
    tmp_element.classList.add("ion-md-pause");
  }
  // Lautsprecher-Symbol in Leise-Symbol
  tmp_element = document.querySelector(".ion-md-volume-off");
  if (tmp_element && tmp_element.classList.contains("ion-md-volume-off")) {
    tmp_element.classList.remove("ion-md-volume-off");
    tmp_element.classList.add("ion-md-volume-high");
  }
  // Button Hintergrund entfernen, falls vorhanden
  tmp_element = document.querySelector("#volume");
  if (tmp_element && tmp_element.classList.contains("btn-danger")) {
    tmp_element.classList.remove("btn-danger");
  }
  // Toast für blockierte Tonausgabe entfernen
  removeAudioBlockedToast();
});

// Play/Pause Steuerung: Button mit ID #playpause oder direkt Icon mit Klasse .ion-md-pause
$(document).on("click", "#playpause, .ion-md-pause", function (e) {
  // Falls Audio läuft -> stoppen & zurücksetzen
  if (!waipAudio.paused && !waipAudio.ended) {
    waipAudio.pause();
    waipAudio.currentTime = 0; // komplett abbrechen
    // UI sofort aktualisieren (pause Event feuert auch, aber zur Sicherheit direkt)
    resetAudioUi();
  } else if (waipAudio.paused) {
    // Erneut starten (falls erwünscht) -> hier optional, aktuell nicht automatisch Starten
    // waipAudio.play();
  }
});

$("#replay").on("click", function (event) {
  waipAudio.currentTime = 0;
  audio.src = lastTTSSrc; // letztes TTS erneut setzen
  waipAudio.play();
});

/* ############################ */
/* ####### TEXT-RESIZE ######## */
/* ############################ */

// Größen dynamisch anpassen, Hintergrundfarbe ggf. anpassen
function resize_text(reProcess) {
  // Hintergrund im Standby schwarz setzen
  if ($("#waipclock").is(":visible")) {
    $("body").css("background-color", "#000");
  }
  // Uhr-Text nur Anpassen wenn sichtbar
  if ($("#clock_day").is(":visible")) {
    try {
      textFit(document.getElementsByClassName("clock_frame"), { minFontSize: 4, maxFontSize: 500, reProcess: reProcess });
      textFit(document.getElementsByClassName("day_frame"), { minFontSize: 3, maxFontSize: 500, reProcess: reProcess });
    } catch (e) { console.error("resize_text clock_frame/day_frame:", e); }
  }
  // Tableau nur Anpassen wenn sichtbar
  if ($("#waiptableau").is(":visible")) {
    try {
      textFit(document.getElementsByClassName("tf_singleline"), { minFontSize: 3, maxFontSize: 700, reProcess: reProcess });
    } catch (e) { console.error("resize_text tf_singleline:", e); }
    try {
      textFit(document.getElementsByClassName("tf_multiline"), { minFontSize: 3, maxFontSize: 500, multiLine: true, reProcess: reProcess });
    } catch (e) { console.error("resize_text tf_multiline:", e); }
    // Karte neu setzen
    map.invalidateSize();
    $("body").css("background-color", "#222");
    try {
      textFit(document.getElementsByClassName("cl_em_alarmiert"), { minFontSize: 4, maxFontSize: 500, reProcess: reProcess });
    } catch (e) { console.error("resize_text cl_em_alarmiert:", e); }
  }
}

// Text nach bestimmter Laenge, in Abhaengigkeit von Zeichen, umbrechen
function break_text_25(text) {
  var new_text;
  new_text = text.replace(/.{25}(\s+|\-+)+/g, "$&@");
  new_text = new_text.split(/@/);
  new_text = new_text.join("<br />");
  //console.log(new_text);
  return new_text;
}

function break_text_80(text) {
  var new_text;
  new_text = text.replace(/.{80}\S*\s+/g, "$&@").split(/\s+@/);
  new_text = new_text.join("<br />");
  //console.log(new_text);
  return new_text;
}

/* ############################ */
/* ####### INAKTIVITAET ####### */
/* ############################ */

let timeoutID;

// Inactivitaet auswerten
function setup_inactivcheck() {
  this.addEventListener("mousemove", resetActivTimer, false);
  this.addEventListener("mousedown", resetActivTimer, false);
  this.addEventListener("keypress", resetActivTimer, false);
  this.addEventListener("DOMMouseScroll", resetActivTimer, false);
  this.addEventListener(
    "mousewheel",
    resetActivTimer,
    {
      passive: true,
    },
    false
  );
  this.addEventListener("touchmove", resetActivTimer, false);
  this.addEventListener("MSPointerMove", resetActivTimer, false);
  start_inactivtimer();
}

setup_inactivcheck();

// warte xxxx Millisekunden um dann do_on_Inactive zu starten
function start_inactivtimer() {
  clearTimeout(timeoutID);
  timeoutID = window.setTimeout(do_on_Inactive, 3000);
}

// Zustand: true = Navbar sichtbar (aktiv), false = ausgeblendet (inaktiv)
let _ui_active = true;

// bei Inaktivitaet Header/Footer ausblenden
function do_on_Inactive() {
  if (!_ui_active) return; // bereits inaktiv – kein erneuter Reflow
  _ui_active = false;
  $(".navbar").fadeOut("slow");
  $(".footer").fadeOut("slow");
  $(".fullheight").css({
    height: "calc(100vh - 3rem)",
    cursor: "none",
  });
  $("body").css({
    paddingTop: "1rem",
    margin: 0,
  });
  // resize nach abgeschlossenem fadeOut, nicht sofort – sonst misst textFit falsche Größen
  setTimeout(function () { resize_text(true); }, 650);
}

// bei Activitaet Header/Footer einblenden
function do_on_Active() {
  start_inactivtimer();
  if (_ui_active) return; // bereits aktiv – kein erneuter Reflow bei jeder Mausbewegung
  _ui_active = true;
  $(".navbar").fadeIn("slow");
  $(".footer").fadeIn("slow");
  $("body").css({
    marginBottom: "60px",
    paddingTop: "5rem",
    paddingBottom: "0",
  });
  $(".fullheight").css({
    height: "calc(100vh - 60px - 5rem)",
    cursor: "auto",
  });
  // resize nach abgeschlossenem fadeIn, nicht sofort
  setTimeout(function () { resize_text(true); }, 650);
}

// bei Event (Aktiviaet) alles zuruecksetzen
function resetActivTimer(e) {
  do_on_Active();
}

/* ############################ */
/* ####### Progressbar ####### */
/* ############################ */

let counter_ID = 0;

function start_counter(zeitstempel, ablaufzeit) {
  // Split timestamp into [ Y, M, D, h, m, s ]
  let t1 = zeitstempel.split(/[- :]/),
    t2 = ablaufzeit.split(/[- :]/);

  let start = new Date(t1[0], t1[1] - 1, t1[2], t1[3], t1[4], t1[5]),
    end = new Date(t2[0], t2[1] - 1, t2[2], t2[3], t2[4], t2[5]);

  clearInterval(counter_ID);
  counter_ID = setInterval(function () {
    do_progressbar(start, end);
  }, 1000);
}

function do_progressbar(start, end) {
  today = new Date();
  let current_progress = Math.round((100 / (end.getTime() - start.getTime())) * (end.getTime() - today.getTime()));

  if (current_progress <= 0) {
    clearInterval(counter_ID);
    counter_ID = 0;
    $("#standbytimer-bar").css("width", "0%").attr("aria-valuenow", 0);
    $("#standbytimer-text").text("");
    return;
  }

  let diff = Math.abs(end - today);
  let minutesDifference = Math.floor(diff / 1000 / 60);
  diff -= minutesDifference * 1000 * 60;
  let secondsDifference = Math.floor(diff / 1000);
  if (secondsDifference <= 9) {
    secondsDifference = "0" + secondsDifference;
  }
  $("#standbytimer-bar")
    .css("width", current_progress + "%")
    .attr("aria-valuenow", current_progress);
  $("#standbytimer-text").text(minutesDifference + ":" + secondsDifference + " min");
}

/* ########################### */
/* ######### LEAFLET ######### */
/* ########################### */

// Karte definieren
let map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
}).setView([51.733005, 14.338048], 13);

// Eigener Pane für den Zielmarker, damit er immer über Routen-Tooltips liegt
map.createPane("zielPane");
map.getPane("zielPane").style.zIndex = 700;

AddMapLayer();

// Attribution für Optionen anzeigen (nebeneinander)
try {
  const attrTexts = [];
  if (typeof rmld_off !== "undefined" && rmld_off) {
    attrTexts.push("Rückmeldungen deaktiviert");
  }
  if (typeof sound_off !== "undefined" && sound_off) {
    attrTexts.push("Soundprüfung deaktiviert");
  }
  if (typeof show_login !== "undefined" && show_login && typeof user_authenticated !== "undefined" && !user_authenticated) {
    attrTexts.push("nicht angemeldet");
  }
  if (attrTexts.length) {
    const optAttr = L.control.attribution({ position: "bottomleft", prefix: "" });
    optAttr.addAttribution(attrTexts.join(" | "));
    optAttr.addTo(map);
  }
} catch (e) {
  // ignorieren
}

// Icon der Karte zuordnen
// Monitorauflösung prüfen (screen statt window.inner – unabhängig von Fenstergröße/Vollbild)
let is4K = screen.width * (window.devicePixelRatio || 1) >= 3840 &&
           screen.height * (window.devicePixelRatio || 1) >= 2160;
let markerSize = is4K ? [50, 82] : [25, 41];
let markerAnchor = is4K ? [25, 82] : [12, 41];
let markerShadowSize = is4K ? [82, 82] : [41, 41];
let redIcon = new L.Icon({
  iconUrl: "/media/marker-icon-2x-red.png",
  shadowUrl: "/media/marker-shadow.png",
  iconSize: markerSize,
  iconAnchor: markerAnchor,
  popupAnchor: [1, -34],
  shadowSize: markerShadowSize,
});

// Icon setzen
let marker = L.marker(new L.LatLng(0, 0), {
  icon: redIcon,
  pane: "zielPane",
}).addTo(map);

// GeoJSON vordefinieren
let geojson = L.geoJSON().addTo(map);

// OSRM-Routen-Layer und Inset-Map
let routeLayers = [];
let insetMap = null;

/* ########################### */
/* ######## SOCKET.IO ######## */
/* ########################### */

// Websocket
let socket = io("/waip", {
  withCredentials: true,
});

// Wachen-ID bei Connect an Server senden
socket.on("connect", function () {
  socket.emit("WAIP", wachen_id);
  $("#waipModal").modal("hide");
  // TODO: bei Reconnect des Clients durch Verbindungsabbruch, erneut Daten anfordern
  console.log("Socket-Verbindung hergestellt, WAIP:", wachen_id);
  startNetzkopplungCheck();
});

/* ################################# */
/* ######## NETZKOPPLUNG ########## */
/* ################################# */
// Prueft periodisch per Image-Load, ob bekannte Internet-Domains erreichbar sind.
// Ist dies der Fall, deutet das auf eine unzulaessige Netzkopplung hin (der
// Alarmmonitor soll nur aus internetlosen Netzen erreichbar sein).
const NETZKOPPLUNG_TIMEOUT_MS = 5000;
const NETZKOPPLUNG_INTERVAL_MS = 8 * 60 * 60 * 1000; // ca. alle 8 Stunden (2-3x/Tag)
const NETZKOPPLUNG_JITTER_MS = 60 * 60 * 1000; // +/- 1 Stunde, damit nicht alle Clients gleichzeitig pruefen
let _netzkopplungStarted = false;

function checkUrlReachable(url) {
  return new Promise(function (resolve) {
    const img = new Image();
    let done = false;
    const timer = setTimeout(function () {
      if (!done) {
        done = true;
        img.src = ""; // laufenden Ladevorgang abbrechen
        resolve(false);
      }
    }, NETZKOPPLUNG_TIMEOUT_MS);

    img.onload = function () {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(true);
      }
    };
    img.onerror = function () {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(false);
      }
    };
    img.src = url + (url.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();
  });
}

function runNetzkopplungCheck(urls) {
  Promise.all(urls.map(checkUrlReachable)).then(function (results) {
    // Nur als Netzkopplung werten, wenn alle Testadressen erreichbar waren
    // (reduziert False-Positives durch einzelne, unabhaengig blockierte Domains).
    const netzkopplung = results.every(Boolean);
    socket.emit("netzkopplung_check", { netzkopplung: netzkopplung });
    console.log("Netzkopplungspruefung durchgefuehrt, Ergebnis:", netzkopplung, results);
  });
}

function startNetzkopplungCheck() {
  if (_netzkopplungStarted) return; // nur einmal pro Seitenaufruf starten (nicht bei jedem Reconnect)
  const urls = typeof netzkopplung_urls !== "undefined" ? netzkopplung_urls : [];
  if (!urls || urls.length === 0) return;
  _netzkopplungStarted = true;

  const scheduleNext = function (delay_ms) {
    setTimeout(function () {
      runNetzkopplungCheck(urls);
      const jitter = Math.floor(Math.random() * (2 * NETZKOPPLUNG_JITTER_MS + 1)) - NETZKOPPLUNG_JITTER_MS;
      scheduleNext(NETZKOPPLUNG_INTERVAL_MS + jitter);
    }, delay_ms);
  };

  // erste Pruefung zeitversetzt (30-90s) nach Verbindungsaufbau, um Seitenaufbau nicht zu belasten
  scheduleNext(30000 + Math.floor(Math.random() * 60000));
}

socket.on("connect_error", function (err) {
  $("#waipModalTitle").text("FEHLER");
  $("#waipModalBody").text("Verbindung zum Server getrennt!");
  $("#waipModal").modal("show");
});

socket.on("disconnect", function (reason) {
  console.log("Socket-Verbindung geschlossen:", reason);
});

// ID von Server und Client vergleichen, falls ungleich -> Seite neu laden
socket.on("io.version", function (server_id) {
  if (client_id != server_id) {
    $("#waipModal").modal("hide");
    setTimeout(function () {
      $("#waipModalTitle").text("ACHTUNG");
      $("#waipModalBody").text("Neue Server-Version. Seite wird gleich automatisch neu geladen!");
      $("#waipModal").modal("show");
      setTimeout(function () {
        location.reload();
      }, Math.floor(Math.random() * (15000 - 1000 + 1)) + 1000);
    }, 1000);
  }
});

// ggf. Fehler ausgeben
socket.on("io.error", function (data) {
  console.log("Error:", data);
});

// Sounds stoppen
socket.on("io.stopaudio", function (data) {
  tmp_audio = document.getElementById("audio");
  tmp_audio.pause();
  tmp_audio.currentTime = 0;
});

// Sounds abspielen
socket.on("io.playtts", function (data) {
  let audio = document.getElementById("audio");
  audio.src = data;
  lastTTSSrc = audio.src;
  ttsActive = true;
  console.log($("#audio"));

  // Audio-Blockade des Browsers erkennen
  let playPromise = document.querySelector("audio").play();

  // In browsers that don't yet support this functionality,
  // playPromise won't be defined.
  if (playPromise !== undefined) {
    playPromise
      .then(function () {
        // Automatic playback started!
        audio.play();
        //$('.ion-md-volume-high').toggleClass('ion-md-pause');
      })
      .catch(function (error) {
        console.log("Automatic playback failed");
        // Automatic playback failed.
        // Show a UI element to let the user manually start playback.
        let tmp_element;
        tmp_element = document.querySelector("#volume");
        /*if (!tmp_element.classList.contains('btn-danger')) {
        tmp_element.classList.add('btn-danger');
      };*/
        tmp_element = document.querySelector(".ion-md-volume-high");
        if (tmp_element && tmp_element.classList.contains("ion-md-volume-high")) {
          tmp_element.classList.remove("ion-md-volume-high");
          tmp_element.classList.add("ion-md-volume-off");
        }
        indicateAudioBlocked();
      });
  }
});

// Daten löschen, Uhr anzeigen
socket.on("io.standby", function (data) {
  console.log("Standby", data);
  waip_id = null;
  clearInterval(counter_ID);
  counter_ID = 0;

  $("#einsatz_art").removeClass(function (index, className) {
    return (className.match(/(^|\s)bg-\S+/g) || []).join(" ");
  });
  $("#einsatz_stichwort").removeClass();
  $("#einsatz_stichwort").text("");
  $("#sondersignal").removeClass();
  $("#ortsdaten").text("");
  $("#besonderheiten").text("");
  $("#em_alarmiert").empty();
  $("#em_weitere").text("");
  $("#rueckmeldung").addClass("d-none");
  reset_rmld();
  recount_rmld();
  // Routen und Inset-Karte aufräumen
  destroy_inset_map();
  clear_route_layers();
  // Leaflet-Reset: alle Layer entfernen und Basis-Kacheln + Platzhalter neu anlegen
  map.eachLayer(function (layer) { map.removeLayer(layer); });
  AddMapLayer();
  marker = L.marker(new L.LatLng(0, 0), { icon: redIcon }).addTo(map);
  geojson = L.geoJSON().addTo(map);
  map.setView(new L.LatLng(0, 0), 14);
  // Tableau ausblenden
  $("#waiptableau").addClass("d-none");
  $("#waipclock").removeClass("d-none");
  // Art der Standbyanzeige bestimmen
  if (data) {
    // statt der Uhr ein iFrame anzeigen
    $("#clock_day").addClass("d-none");
    $("#frame_web").removeClass("d-none");
  }
  // 200ms warten
  setTimeout(function () {
    resize_text(true);
    updateWachennameAnimation();
    updateRandomPosition();
  }, 200);

});

// Einsatzdaten laden, Wachalarm anzeigen
socket.on("io.new_waip", function (data) {
  console.log("Neuer Einsatz:", data);
  start_inactivtimer();
  // Einsatz-ID speichern
  waip_id = data.id;
  // Alarmzeitsetzen setzen, das format "YYYY-MM-DD HH:MM:SS" soll in "YYYY-MM-DD" & "HH:MM" umgewandelt werden
  let alarmzeit = data.zeitstempel.split(" ");
  //$("#alert_date").text("\xA0" + alarmzeit[0]);
  $("#alert_time").text("\xA0" + alarmzeit[1]);
  // Einsatznummer setzen, falls vorhanden
  if (data.einsatznummer) {
    $("#einsatznummer").removeClass("d-none");
    $("#einsatznummer").text("\xA0" + data.einsatznummer);
  } else {
    // div fuer Einsatznummer ausblenden
    $("#einsatznummer").addClass("d-none");
  }
  // Hintergrund der Einsatzart zunächst entfernen
  $("#einsatz_art").removeClass(function (index, className) {
    return (className.match(/(^|\s)bg-\S+/g) || []).join(" ");
  });
  // Icon der Einsatzart enfernen
  $("#einsatz_stichwort").removeClass();
  // Art und Stichwort festlegen hinterlegen
  switch (data.einsatzart) {
    case "Brandeinsatz":
      $("#einsatz_art").addClass("bg-danger");
      $("#einsatz_stichwort").addClass("ion-md-flame");
      $("#rueckmeldung").removeClass("d-none");
      break;
    case "Hilfeleistungseinsatz":
      $("#einsatz_art").addClass("bg-info");
      $("#einsatz_stichwort").addClass("ion-md-construct");
      $("#rueckmeldung").removeClass("d-none");
      break;
    case "Rettungseinsatz":
      $("#einsatz_art").addClass("bg-warning");
      $("#einsatz_stichwort").addClass("ion-md-medkit");
      break;
    case "Krankentransport":
      $("#einsatz_art").addClass("bg-success");
      $("#einsatz_stichwort").addClass("ion-md-medical");
      break;
    default:
      $("#einsatz_art").addClass("bg-secondary");
      $("#einsatz_stichwort").addClass("ion-md-information-circle");
  }
  $("#einsatz_stichwort").text(" " + data.stichwort);
  // Sondersignal setzen
  $("#sondersignal").removeClass();
  switch (data.sondersignal) {
    case 1:
      $("#sondersignal").addClass("ion-md-notifications");
      break;
    default:
      $("#sondersignal").addClass("ion-md-notifications-off");
  }
  // Ortsdaten zusammenstellen und setzen
  let small_ortsdaten;
  small_ortsdaten = "";
  // Teilbjekt anfuegen
  if (data.objektteil) {
    small_ortsdaten = small_ortsdaten + break_text_25(data.objektteil) + "<br />";
  }
  // Objekt anfuegen
  if (data.objekt) {
    small_ortsdaten = small_ortsdaten + break_text_25(data.objekt);
    // ggf. weitere Einsatzdetails an Objekt anfügen, wenn Brand- oder Hilfeleistungseinsatz
    if (data.einsatzdetails && (data.einsatzart === "Brandeinsatz" || data.einsatzart === "Hilfeleistungseinsatz")) {
      small_ortsdaten = small_ortsdaten + " (" + data.einsatzdetails + ") ";
    }
    small_ortsdaten = small_ortsdaten + "<br />";
  }
  // Ort anfuegen
  if (data.ort) {
    small_ortsdaten = small_ortsdaten + break_text_25(data.ort) + "<br />";
  }
  // Ortsteil anfuegen, aber nur wenn nicht gleich Ort
  if (data.ortsteil) {
    // wenn Ortsteil gleich Ort, dann nicht anzeigen
    if (data.ortsteil !== data.ort) {
      small_ortsdaten = small_ortsdaten + break_text_25(data.ortsteil) + "<br />";
    }
  }
  // Strasse und Hausnummer anfuegen
  if (data.strasse) {
    let tmp_strasse = data.hausnummer ? data.strasse + "&nbsp;" + data.hausnummer : data.strasse;
    small_ortsdaten = small_ortsdaten + break_text_25(tmp_strasse) + "<br />";
  }
  if (small_ortsdaten.substr(small_ortsdaten.length - 4) == "<br />") {
    small_ortsdaten = small_ortsdaten.slice(0, -4);
  }
  $("#ortsdaten").html(small_ortsdaten);
  // Besonderheiten zurücksetzen und dann neu schreiben
  $("#besonderheiten").text(data.besonderheiten);
  // alarmierte Einsatzmittel setzen
  $("#em_alarmiert_new").empty();
  const data_em_alarmiert = data.em_alarmiert;
  const anzahl_em_alarmiert = data_em_alarmiert.length;
  let hight_em_alarmiert = 0;
  let col_em_alarmiert = 0;
  // wenn anzahl max 2 dann
  if (anzahl_em_alarmiert <= 2) {
    hight_em_alarmiert = "h-100";
    col_em_alarmiert = "col-6";
  }
  // wenn anzahl zwischen 3 und 4 dann
  if (anzahl_em_alarmiert > 2 && anzahl_em_alarmiert <= 4) {
    hight_em_alarmiert = "h-50";
    col_em_alarmiert = "col-6";
  }
  // wenn anzahl zwischen 5 und 6 dann
  if (anzahl_em_alarmiert > 4 && anzahl_em_alarmiert <= 6) {
    hight_em_alarmiert = "h-33";
    col_em_alarmiert = "col-6";
  }
  // wenn anzahl zwischen 7 und 8 dann
  if (anzahl_em_alarmiert > 6 && anzahl_em_alarmiert <= 8) {
    hight_em_alarmiert = "h-25";
    col_em_alarmiert = "col-6";
  }
  // wenn anzahl ist 9
  if (anzahl_em_alarmiert == 9) {
    hight_em_alarmiert = "h-33";
    col_em_alarmiert = "col-4";
  }
  // wenn anzahl zwischen 10 und 12 dann
  if (anzahl_em_alarmiert > 9 && anzahl_em_alarmiert <= 12) {
    hight_em_alarmiert = "h-25";
    col_em_alarmiert = "col-4";
  }
  // wenn anzahl zwischen 13 und 15 dann
  if (anzahl_em_alarmiert > 12 && anzahl_em_alarmiert <= 15) {
    hight_em_alarmiert = "h-20";
    col_em_alarmiert = "col-4";
  }
  // wenn anzahl zwischen 16 und 18 dann
  if (anzahl_em_alarmiert > 15 && anzahl_em_alarmiert <= 18) {
    hight_em_alarmiert = "h-16-5";
    col_em_alarmiert = "col-4";
  }
  // wenn anzahl größer 19
  if (anzahl_em_alarmiert > 18) {
    hight_em_alarmiert = "h-10";
    col_em_alarmiert = "col-4";
  }

  for (let i in data_em_alarmiert) {
    let tmp = data_em_alarmiert[i].name.replace(/[^a-z0-9\s]/gi, "").replace(/[_\s]/g, "-");
    $("#em_alarmiert_new").append('<div id="id_' + tmp + '" class="' + hight_em_alarmiert + " " + col_em_alarmiert + ' p-1"></div>');
    $("#id_" + tmp).append(
      '<div class="px-1 w-100 h-100 d-flex align-items-center rounded bg-secondary cl_em_alarmiert text-nowrap">' +
        data_em_alarmiert[i].name +
        "</div>"
    );
  }
  // weitere alarmierte Einsatzmittel setzen
  $("#em_weitere").text("");

  try {
    let data_em_weitere = data.em_weitere;

    if (data_em_weitere.length > 0) {
      let tmp_weitere;
      for (let i in data_em_weitere) {
        if (tmp_weitere) {
          tmp_weitere = tmp_weitere + ", " + data_em_weitere[i].name;
        } else {
          tmp_weitere = data_em_weitere[i].name;
        }
      }
      $("#em_weitere").text(tmp_weitere);
    }
  } catch (e) {
    console.log(e); // error in the above string (in this case, yes)!
  }

  // Rückmeldungs-Timer vollständig zurücksetzen
  Object.keys(counter_rmld).forEach(function(id) { clearInterval(counter_rmld[id]); });
  counter_rmld = {};

  // Routen und Inset-Karte aus vorherigem Einsatz löschen
  destroy_inset_map();
  clear_route_layers();
  // Karte leeren
  map.removeLayer(marker);
  map.removeLayer(geojson);

  // Ablaufzeit setzen
  start_counter(data.zeitstempel, data.ablaufzeit);
  // alte Rückmeldung entfernen
  reset_rmld();
  recount_rmld(data.uuid);
  // VIEW anpassen
  reset_view();
  // Uhr ausblenden, Tableau einblenden – MUSS vor map.fitBounds passieren,
  // damit der Kartencontainer eine reale Größe hat wenn Leaflet rechnet
  $("#waipclock").addClass("d-none");
  $("#waiptableau").removeClass("d-none");
  // Leaflet die tatsächliche Containergröße mitteilen, bevor fitBounds aufgerufen wird
  map.invalidateSize();

  const initialZoom = is4K ? 16 : 14;

  // Karte setzen (Punkt oder GeoJSON mit Rand zentrieren)
  if (data.wgs84_x && data.wgs84_y) {
    const lat = data.wgs84_x;
    const lng = data.wgs84_y;
    marker = L.marker(new L.LatLng(lat, lng), { icon: redIcon, pane: "zielPane" }).addTo(map);
    map.setView(new L.LatLng(lat, lng), initialZoom);
    // Inset-Karte nur bei Punkt-Einsatz mit Vollberechtigung
    if (data.permissions) {
      create_inset_map(lat, lng);
    }
  } else {
    try {
      const gjData = JSON.parse(data.geometry);
      geojson = L.geoJSON(gjData).addTo(map);
      const gjBounds = geojson.getBounds();
      if (gjBounds.isValid()) {
        map.fitBounds(gjBounds, { padding: [50, 50], maxZoom: initialZoom });
      } else {
        map.setView(gjBounds.getCenter(), initialZoom);
      }
    } catch (e) {
      console.error("GeoJSON Parsing/Rendering Fehler", e);
    }
  }

  resize_text(true);
});

// OSRM-Routen empfangen und auf der Karte zeichnen
socket.on("io.routes", function (routes) {
  draw_routes(routes);
});

socket.on("io.new_rmld", function (data) {
  console.log("neue Rückmeldung:", data);
  // Rückmeldungen deaktiviert? (rmld_off wird serverseitig ins Template injiziert)
  try {
    if (typeof rmld_off !== "undefined" && rmld_off) {
      console.log("Rückmeldungen sind deaktiviert (rmld=off), io.new_rmld ignoriert.");
      return; // nichts tun
    }
  } catch (e) {
    // falls Variable nicht existiert einfach normal fortfahren
  }
  // DEBUG
  // FIXME  Änderung des Funktions-Typ berücksichtigen
  // Neue Rueckmeldung hinterlegen
  // HTML festlegen
  var item_type = "";
  var item_content = "";
  var item_classname = "";
  // wenn Einsatzkraft dann:
  if (data.rmld_role == "team_member") {
    // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Einsatzkraft'
    if (data.rmld_alias) {
      item_content = data.rmld_alias;
    } else {
      item_content = "Einsatzkraft";
    }
    item_classname = "ek";
    item_type = "ek";
  }
  // wenn Maschinist dann:
  if (data.rmld_role == "crew_leader") {
    // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Gruppenführer'
    if (data.rmld_alias) {
      item_content = data.rmld_alias;
    } else {
      item_content = "Gruppenführer";
    }
    item_classname = "gf";
    item_type = "gf";
  }
  // wenn Maschinist dann:
  if (data.rmld_role == "division_chief") {
    // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Zugführer'
    if (data.rmld_alias) {
      item_content = data.rmld_alias;
    } else {
      item_content = "Zugführer";
    }
    item_classname = "zf";
    item_type = "zf";
  }
  // wenn Maschinist dann:
  if (data.rmld_role == "group_commander") {
    // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Verbandsführer'
    if (data.rmld_alias) {
      item_content = data.rmld_alias;
    } else {
      item_content = "Verbandsführer";
    }
    item_classname = "vf";
    item_type = "vf";
  }

  if (data.rmld_capability_agt > 0) {
    item_content += " AGT";
  }
  if (data.rmld_capability_fzf > 0) {
    item_content += " FZF";
  }
  if (data.rmld_capability_ma > 0) {
    item_content += " MA";
  }
  if (data.rmld_capability_med > 0) {
    item_content += " MED";
  }

  // Variablen für Anzeige vorbereiten
  var pg_waip_uuid = data.waip_uuid;
  var pg_rmld_uuid = data.rmld_uuid;
  var pg_start = new Date(data.time_decision);
  var pg_end = new Date(data.time_arrival);

  // Progressbar hinterlegen
  add_resp_progressbar(
    data.waip_uuid,
    data.rmld_uuid,
    item_type,
    data.rmld_alias,
    data.rmld_capability_agt,
    data.rmld_capability_fzf,
    data.rmld_capability_ma,
    data.rmld_capability_med,
    pg_start,
    pg_end
  ); // Anzahl der Rückmeldung zählen

  recount_rmld(pg_waip_uuid);
  // View anpassen
  reset_view();
  // Textgröße der Rückmeldungen anpassen – debounced, damit bei Batch-Eingang nur einmal läuft
  clearTimeout(_rmld_resize_timer);
  _rmld_resize_timer = setTimeout(() => resize_text(true), 150);

  // Bing abspielen (nur wenn kein laufendes TTS überlagert wird)
  let audio = document.getElementById("audio");
  try {
    // Wenn TTS aktiv und noch nicht beendet -> abbrechen
    if (ttsActive && !audio.paused && !audio.ended && audio.src === lastTTSSrc && !/bell_message\.mp3/.test(audio.src)) {
      console.log("Bell übersprungen: TTS aktiv (" + audio.src + ")");
      return;
    }
    // Wenn anderes Audio (nicht Glocke) gerade spielt, überspringen
    if (!ttsActive && !audio.paused && !audio.ended && !/bell_message\.mp3/.test(audio.src)) {
      console.log("Bell übersprungen: anderes Audio läuft (" + audio.src + ")");
      return;
    }
    // Glocke abspielen wenn nichts oder Glocke selbst
    if (!/bell_message\.mp3/.test(audio.src)) {
      audio.src = "/media/bell_message.mp3";
    }
    let playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(function () {
        console.log("Notification playback failed");
        indicateAudioBlocked();
      });
    }
  } catch (e) {
    console.log("Bell playback error", e);
    indicateAudioBlocked();
  }
});

/* ########################### */
/* ####### Rückmeldung ####### */
/* ########################### */

let counter_rmld = [];
let _rmld_resize_timer = null;

function reset_rmld() {
  const regex = /^pg-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
  $("#rmld_progressbars").children().each(function () {
    const match = regex.exec($(this).attr("id"));
    if (match) {
      clearInterval(counter_rmld[match[1]]);
      delete counter_rmld[match[1]];
      $(this).remove();
    }
  });
}

function add_resp_progressbar(p_uuid, p_id, p_type, p_content, p_agt, p_fzf, p_ma, p_med, p_start, p_end) {
  // Hintergrund der Progressbar festlegen
  let bar_background = "";
  let bar_border = "";
  // wenn p_agt 1 ist
  if (p_agt == 1) {
    bar_border = "border border-warning";
  }
  switch (p_type) {
    case "ek":
      bar_background = "bg-success";
      break;
    case "gf":
      bar_background = "bg-info";
      break;
    case "zf":
      bar_background = "bg-light";
      break;
    case "vf":
      bar_background = "bg-danger";
      break;
    default:
      bar_background = "";
      break;
  }
  var bar_uuid = "bar-" + p_uuid;
  // pruefen ob div mit id 'pg-'+p_id schon vorhanden ist
  var pgbar = document.getElementById("pg-" + p_id);
  if (!pgbar) {
    // col-4 hinzufügen mit id
    $("#rmld_progressbars").append('<div class="col-sm-4 col-6 px-1 pg-' + p_type + '" id="pg-' + p_id + '"></div>');
    // Progressbar hinzufügen mit id
    $("#pg-" + p_id).append(
      '<div class="progress rmld-bar position-relative ' + bar_border + " " + bar_uuid + '" id="pg-' + p_type + "-" + p_id + '"></div>'
    );
    // wenn p_agt > 0 ist, dann als Klasse p_agt hinterlegen
    if (p_agt > 0) {
      $("#pg-" + p_id).addClass("p_agt");
    }
    // wenn p_fzf > 0 ist, dann als Klasse p_fzf hinterlegen
    if (p_fzf > 0) {
      $("#pg-" + p_id).addClass("p_fzf");
    }
    // wenn p_ma > 0 ist, dann als Klasse p_ma hinterlegen
    if (p_ma > 0) {
      $("#pg-" + p_id).addClass("p_ma");
    }
    // wenn p_med > 0 ist, dann als Klasse p_med hinterlegen
    if (p_med > 0) {
      $("#pg-" + p_id).addClass("p_med");
    }
    $("#pg-" + p_type + "-" + p_id).append(
      '<div id="pg-bar-' +
        p_id +
        '" class="progress-bar progress-bar-striped ' +
        bar_background +
        '" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>'
    );
    // hier tf_singleline
    $("#pg-" + p_type + "-" + p_id).append(
      '<div id="pg-text-' + p_id + '" class="justify-content-center align-items-center d-flex position-absolute h-100 w-100"></div>'
    );
  } else {
    // TODO PG-Bar ändern falls neue/angepasste Rückmeldung
  }

  // Statischen Overlay-Text einmalig vorberechnen (ändert sich nicht)
  let _caps = [];
  if (p_agt > 0) _caps.push("AGT");
  if (p_fzf > 0) _caps.push("FZF");
  if (p_ma > 0) _caps.push("MA");
  if (p_med > 0) _caps.push("MED");
  let _overlay_text = (p_content || "") + (_caps.length > 0 ? " (" + _caps.join(", ") + ")" : "");

  // DOM-Referenzen einmalig cachen
  let _$bar = $("#pg-bar-" + p_id);
  let _$overlay = $("#pg-text-" + p_id);

  // Overlay-Spans einmalig anlegen – kein Rebuild jede Sekunde
  _$overlay.empty().addClass("rmld-timer-running");
  let _timeNode = $("<span>").css({ position: "absolute", left: "4px" }).appendTo(_$overlay)[0];
  if (_overlay_text) $("<span>").text(_overlay_text).appendTo(_$overlay);

  // Zeitstempel als Millisekunden cachen
  let _start_ms = p_start.getTime();
  let _end_ms = p_end.getTime();

  clearInterval(counter_rmld[p_id]);
  counter_rmld[p_id] = setInterval(function () {
    let now = Date.now();
    let current_progress = Math.round((100 / (_start_ms - _end_ms)) * (_start_ms - now));

    if (current_progress >= 100) {
      _$bar.css("width", "100%").attr("aria-valuenow", 100);
      _$overlay.empty().removeClass("rmld-timer-running").text(_overlay_text).addClass("ion-md-checkmark-circle");
      clearInterval(counter_rmld[p_id]);
      delete counter_rmld[p_id];
      _$bar = _$overlay = null; // DOM-Referenzen für GC freigeben
    } else {
      let diff = Math.abs(_end_ms - now);
      let min = Math.floor(diff / 60000);
      let sec = Math.floor((diff % 60000) / 1000);
      _$bar.css("width", current_progress + "%").attr("aria-valuenow", current_progress);
      // textContent direkt – kein jQuery-Overhead im 1-Sek-Takt
      _timeNode.textContent = min + ":" + (sec < 10 ? "0" + sec : sec);
    }
  }, 1000);
}

function recount_rmld(p_uuid) {
  let bar_uuid = "bar-" + p_uuid;
  let agt_count = 0;
  // Zähler auf 0 Setzen
  $("#gs-counter").text(0);
  $("#ek-counter").text(0);
  $("#gf-counter").text(0);
  $("#zf-counter").text(0);
  $("#vf-counter").text(0);
  $("#agt-counter").text(0);
  $("#ma-counter").text(0);
  $("#fzf-counter").text(0);
  $("#med-counter").text(0);

  $("#gs-counter").text($(".pg-").length + $(".pg-ek").length + $(".pg-gf").length + $(".pg-zf").length + $(".pg-vf").length);

  $("#ek-counter").text($(".pg-ek").length);
  $("#gf-counter").text($(".pg-gf").length);
  $("#zf-counter").text($(".pg-zf").length);
  $("#vf-counter").text($(".pg-vf").length);

  $("#agt-counter").text($(".p_agt").length);
  $("#ma-counter").text($(".p_ma").length);
  $("#fzf-counter").text($(".p_fzf").length);
  $("#med-counter").text($(".p_med").length);
}

function reset_view() {
  // Variablen
  let rmld_on = false;
  let em_weitere_on = false;
  let besonderheiten_on = false;
  // boolean für container_rmld
  if (
    $("#gs-counter").text() == "0" &&
    $("#ek-counter").text() == "0" &&
    $("#gf-counter").text() == "0" &&
    $("#zf-counter").text() == "0" &&
    $("#vf-counter").text() == "0"
  ) {
    rmld_on = false;
  } else {
    rmld_on = true;
  }
  // boolean wenn #em_weitere nicht leer ist
  if ($("#em_weitere").text() == "") {
    em_weitere_on = false;
  } else {
    em_weitere_on = true;
  }
  // boolean wenn #besonderheiten nicht leer ist
  if ($("#besonderheiten").text() == "") {
    besonderheiten_on = false;
  } else {
    besonderheiten_on = true;
  }
  console.log("rmld_on:", rmld_on, "em_weitere_on:", em_weitere_on, "besonderheiten_on:", besonderheiten_on);
  // VIEW anpassen
  if (rmld_on && (!em_weitere_on || em_weitere_on) && besonderheiten_on) {
    $("#container_rmld").removeClass("d-none");
    alterClass("#container_ortsdaten", "h-*", "h-45");
    alterClass("#container_ortsdaten", "col-*", "col-5");
    alterClass("#container_einsatzmittel", "h-*", "h-45");
    alterClass("#container_einsatzmittel", "col-*", "col-7");
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-15");
  }
  // v2, v6 - wenn keine Rückmeldungen, egal ob weitere Einsatzmittel und keine Besonderheiten vorhanden sind
  if (!rmld_on && (!em_weitere_on || em_weitere_on) && !besonderheiten_on) {
    $("#container_rmld").addClass("d-none");
    alterClass("#container_ortsdaten", "h-*", "h-45");
    alterClass("#container_ortsdaten", "col-*", "col-12");
    alterClass("#container_einsatzmittel", "h-*", "h-45");
    alterClass("#container_einsatzmittel", "col-*", "col-12");
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-5");
  }
  // v3, v5 - wenn Besonderheiten, keine Rückmeldungen, egal ob weitere Einsatzmittel
  if (!rmld_on && (em_weitere_on || !em_weitere_on) && besonderheiten_on) {
    $("#container_rmld").addClass("d-none");
    // wenn max. 2 Einsatzmittel alarmirt sind, dann mehr Höhe für Text
    if ($("#em_alarmiert_new").children().length <= 2) {
      alterClass("#container_ortsdaten", "h-*", "h-55");
      alterClass("#container_ortsdaten", "col-*", "col-12");
      alterClass("#container_einsatzmittel", "h-*", "h-25");
      alterClass("#container_einsatzmittel", "col-*", "col-12");
    } else {
      alterClass("#container_ortsdaten", "h-*", "h-40");
      alterClass("#container_ortsdaten", "col-*", "col-12");
      alterClass("#container_einsatzmittel", "h-*", "h-40");
      alterClass("#container_einsatzmittel", "col-*", "col-12");
    }
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-15");
  }
  // v4, v7 - keine Besonderheiten, aber Rückmeldungen und egal ob weitere Einsatzmittel
  if (!besonderheiten_on && rmld_on && (em_weitere_on || !em_weitere_on)) {
    $("#container_rmld").removeClass("d-none");
    alterClass("#container_ortsdaten", "h-*", "h-55");
    alterClass("#container_ortsdaten", "col-*", "col-5");
    alterClass("#container_einsatzmittel", "h-*", "h-55");
    alterClass("#container_einsatzmittel", "col-*", "col-7");
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-5");
  }
}

/* ########################### */
/* ####### SCREENSAVER ####### */
/* ########################### */

// Uhrzeit und Datum für Bildschirmschoner
function set_clock() {
  // TODO Sekunden anzeigen
  // Wochentage
  let d_names = new Array("Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag");
  // Monate
  let m_names = new Array("Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember");
  // Aktuelle Zeit
  let d = new Date();
  let curr_day = d.getDay();
  let curr_date = d.getDate();
  let curr_month_id = d.getMonth();
  curr_month_id = curr_month_id + 1;
  var curr_year = d.getFullYear();
  let curr_hour = d.getHours();
  let curr_min = d.getMinutes();
  let curr_sek = d.getSeconds();
  // Tag und Monat Anpassen
  if (String(curr_date).length == 1) curr_date = "0" + curr_date;
  if (String(curr_month_id).length == 1) curr_month_id = "0" + curr_month_id;
  // Uhrzeit und Minute anpassen
  if (curr_min <= 9) {
    curr_min = "0" + curr_min;
  }
  if (curr_hour <= 9) {
    curr_hour = "0" + curr_hour;
  }
  if (curr_sek <= 9) {
    curr_sek = "0" + curr_sek;
  }
  let curr_month = d.getMonth();
  var curr_year = d.getFullYear();
  let element_time = curr_hour + ":" + curr_min;
  let element_day = d_names[curr_day] + ", " + curr_date + ". " + m_names[curr_month];
  let element_date_time = curr_date + "." + curr_month_id + "." + curr_year + " - " + element_time + ":" + curr_sek;
  // Easter-Egg :-)
  if (element_time.substr(0, 5) == "13:37") {
    element_time = "1337";
  }
  // Sekunden jede Sekunde aktualisieren
  $("#clock-seconds").text(":" + curr_sek);

  // nur erneuern wenn sich Zeit geändert hat
  if ($("#clock-hhmm").text() !== element_time) {
    $("#clock-hhmm").text(element_time);
    $("#day").text(element_day);
    // resize_text nur wenn Uhr sichtbar ist – während Alarm (waiptableau sichtbar) ist
    // ein vollständiges textFit-Reprocessing jede Minute unnötige CPU-Last
    if ($("#waipclock").is(":visible")) {
      resize_text(true);
    }
  }
}

// Uhrzeit jede Sekunden anpassen
setInterval(set_clock, 1000);

/* ############################ */
/* ####### WACHENNAME ####### */
/* ############################ */

// Vereinfachte Animation: alle 5s Schritt nach rechts, am Rand Richtung umkehren
let wachennameInterval;
let wachennameDirection = 1; // 1 = rechts, -1 = links
const WACHENNAME_STEP = 50; // Pixel pro Schritt
const WACHENNAME_INTERVAL_MS = 10000; // 10 Sekunden

function updateWachennameAnimation() {
  const wachenname = document.getElementById("wachenname_footer");
  if (!wachenname) return;

  // Vorherige CSS-Animation und evtl. Style-Tag entfernen
  wachenname.style.animation = "none";
  const oldStyle = document.getElementById("wachenname-animation");
  if (oldStyle) oldStyle.remove();

  // Positionierungsbasis setzen
  wachenname.style.position = "relative";
  if (!wachenname.dataset.posX) {
    wachenname.dataset.posX = "0";
    wachenname.style.left = "0px";
  }

  // Begrenzungen neu berechnen (Fensterbreite als Container)
  const containerWidth = window.innerWidth;
  const elementWidth = wachenname.offsetWidth;
  const maxTranslate = Math.max(0, containerWidth - elementWidth - 40); // etwas Rand

  // Falls aktuelle Position außerhalb nach Resize
  let currentX = parseInt(wachenname.dataset.posX, 10) || 0;
  if (currentX > maxTranslate) {
    currentX = maxTranslate;
    wachenname.dataset.posX = String(currentX);
    wachenname.style.left = currentX + "px";
    wachennameDirection = -1;
  }

  // Intervall zurücksetzen
  if (wachennameInterval) {
    clearInterval(wachennameInterval);
  }

  wachennameInterval = setInterval(() => {
    let x = parseInt(wachenname.dataset.posX, 10) || 0;
    x += wachennameDirection * WACHENNAME_STEP;

    // Randprüfung und Richtungswechsel
    if (x >= maxTranslate) {
      x = maxTranslate;
      wachennameDirection = -1;
    } else if (x <= 0) {
      x = 0;
      wachennameDirection = 1;
    }

    wachenname.dataset.posX = String(x);
    wachenname.style.left = x + "px";
  }, WACHENNAME_INTERVAL_MS);
}

/* ############################ */
/* ####### RANDOM POSITION ####### */
/* ############################ */

let randomPositionInterval;

function startRandomPositioning() {
  // Initiale Position setzen
  updateRandomPosition();

  // Alle 3 Minuten die Position aktualisieren
  randomPositionInterval = setInterval(updateRandomPosition, 180000);
}

function updateRandomPosition() {
  const screenSaver = document.getElementById("screen_saver");
  const clockDay = document.getElementById("clock_day");

  if (!screenSaver || !clockDay) return;

  // Dimensionen des Containers und des Elements
  const containerRect = screenSaver.getBoundingClientRect();
  const elementRect = clockDay.getBoundingClientRect();

  // Maximale Positionen berechnen (unter Berücksichtigung der Elementgröße)
  const maxX = containerRect.width - elementRect.width;
  const maxY = containerRect.height - elementRect.height;

  // Zufällige Position berechnen
  const randomX = Math.floor(Math.random() * maxX);
  const randomY = Math.floor(Math.random() * maxY);

  // Position via transform – löst keinen Layout-Reflow aus (Compositor-Thread)
  clockDay.style.position = "absolute";
  clockDay.style.left = "0";
  clockDay.style.top = "0";
  clockDay.style.transform = `translate(${randomX}px, ${randomY}px)`;
}

/* ############################ */
/* ####### ALTER CLASS ####### */
/* ############################ */

function alterClass(elementId, removeClassPattern, addClass) {
  // Element mit der angegebenen ID auswählen
  const element = document.querySelector(elementId);

  if (element) {
    // Alle Klassen des Elements durchlaufen
    element.classList.forEach((className) => {
      // Wenn die Klasse dem Muster entspricht, entfernen
      if (className.match(new RegExp(removeClassPattern.replace("*", ".*")))) {
        element.classList.remove(className);
      }
    });
    // Neue Klasse hinzufügen
    element.classList.add(addClass);
  }
}

/* ########################### */
/* ######## OSRM Routen ###### */
/* ########################### */

function clear_route_layers() {
  routeLayers.forEach(function (l) { map.removeLayer(l); });
  routeLayers = [];
}

function draw_routes(routes) {
  clear_route_layers();
  if (!routes || !routes.length) return;

  const allBounds = [];

  routes.forEach(function (route) {
    if (!route.geometry) return;

    // Schatten
    const shadow = L.geoJSON(route.geometry, {
      style: { color: "#000000", weight: 10, opacity: 0.18, lineCap: "round", lineJoin: "round" },
    }).addTo(map);
    routeLayers.push(shadow);

    // Halo (weißer Hintergrund) für besseren Kontrast
    const halo = L.geoJSON(route.geometry, {
      style: { color: "#ffffff", weight: 5, opacity: 0.65, lineCap: "round", lineJoin: "round" },
    }).addTo(map);
    routeLayers.push(halo);

    // Farbige Linie
    const layer = L.geoJSON(route.geometry, {
      style: { color: route.color, weight: 4, opacity: 1.0, lineCap: "round", lineJoin: "round" },
    }).addTo(map);
    routeLayers.push(layer);

    // Startpunkt-Marker (Wache)
    const coords = route.geometry.coordinates;
    if (coords && coords.length) {
      const start = coords[0]; // GeoJSON: [lng, lat]
      const startMarker = L.circleMarker([start[1], start[0]], {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: route.color,
        fillOpacity: 1.0,
      }).addTo(map);
      if (route.name_wache) startMarker.bindTooltip(route.name_wache, { permanent: true, direction: "top", offset: [0, -10], className: "route-label" });
      routeLayers.push(startMarker);
    }

    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) allBounds.push(bounds);
    } catch (_) {}
  });

  if (allBounds.length) {
    let combined = allBounds[0];
    for (let i = 1; i < allBounds.length; i++) combined = combined.extend(allBounds[i]);
    // Marker-Position einbeziehen falls vorhanden
    try {
      const mPos = marker.getLatLng();
      if (mPos.lat !== 0 || mPos.lng !== 0) combined = combined.extend(mPos);
    } catch (_) {}

    const insetEl = document.getElementById("map-inset");
    const insetVisible = insetEl && !insetEl.classList.contains("d-none");

    if (insetVisible) {
      // Inset in den Quadranten verschieben, der dem Routenstart (Wache) gegenüberliegt
      const firstCoords = routes.length && routes[0].geometry && routes[0].geometry.coordinates;
      const startCoord = firstCoords && firstCoords.length ? firstCoords[0] : null; // [lng, lat]
      const center = combined.getCenter();
      const stationSouth = startCoord ? startCoord[1] < center.lat : true;
      const stationWest  = startCoord ? startCoord[0] < center.lng : true;

      // Inset gegenüber der Wache positionieren
      insetEl.style.top    = stationSouth ? "auto" : "10px";
      insetEl.style.bottom = stationSouth ? "10px" : "auto";
      insetEl.style.left   = stationWest  ? "auto" : "10px";
      insetEl.style.right  = stationWest  ? "10px" : "auto";

      // fitBounds-Padding aus tatsächlicher Inset-Größe lesen, damit responsive CSS-Änderungen
      // (min(260px, 38%)) automatisch berücksichtigt werden.
      const insetPad = insetEl.offsetWidth + 12; // Breite + 10px Rand + 2px Border
      const ptl = [stationWest ? 15 : insetPad, stationSouth ? 15 : insetPad];
      const pbr = [stationWest ? insetPad : 15, stationSouth ? insetPad : 15];
      map.fitBounds(combined, { paddingTopLeft: ptl, paddingBottomRight: pbr });
    } else {
      map.fitBounds(combined, { padding: [15, 15] });
    }
  }
}

function create_inset_map(lat, lng) {
  destroy_inset_map();
  const el = document.getElementById("map-inset");
  if (!el) return;
  el.classList.remove("d-none");
  insetMap = L.map("map-inset", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
  }).setView([lat, lng], 17);
  AddMapLayer(insetMap);
  L.marker(new L.LatLng(lat, lng), { icon: redIcon }).addTo(insetMap);
}

function destroy_inset_map() {
  if (insetMap) {
    insetMap.remove();
    insetMap = null;
  }
  const el = document.getElementById("map-inset");
  if (el) el.classList.add("d-none");
}
