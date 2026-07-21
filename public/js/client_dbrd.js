$(document).ready(function () {
  // Sound nicht beim laden der Seite abspielen
  var audio = document.getElementById("audio");
  audio.src = "/media/bell_message.mp3";
  audio.volume = 0.0;
  setTimeout(function () {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1.0;
  }, 1000);
});

/* ########################### */
/* ######### LEAFLET ######### */
/* ########################### */

// Funktion zum Hinzufügen und Testen eines WMS-Layers
function AddMapLayer(targetMap) {
  let maxMapZoom = 18;
  var tMap = targetMap || map;
  // Layer der Karte basierend auf dem Typ des Kartendienstes hinzufuegen
  if (map_service.type === "tile") {
    // Tile-Map hinzufuegen
    L.tileLayer(map_service.tile_url, {
      maxZoom: maxMapZoom,
    }).addTo(tMap);
  } else if (map_service.type === "wms") {
    // WMS-Map hinzufuegen
    var wmsLayer = L.tileLayer.wms(map_service.wms_url, {
      layers: map_service.wms_layers,
      format: map_service.wms_format,
      transparent: map_service.wms_transparent,
      version: map_service.wms_version,
    });

    // Fehlerbehandlung: Wenn der WMS-Layer nicht geladen werden kann, dann einmalig auf Tile-Layer wechseln.
    // .once() statt .on() verhindert, dass der Handler für jeden fehlgeschlagenen Tile (20-50 pro Viewport)
    // ausgelöst wird und dabei gestapelte Tile-Layer erzeugt.
    wmsLayer.once("tileerror", function () {
      console.warn("WMS-Layer konnte nicht geladen werden, versuche Tile-Layer:", map_service.tile_url);
      tMap.removeLayer(wmsLayer);
      L.tileLayer(map_service.tile_url, {
        maxZoom: maxMapZoom,
      }).addTo(tMap);
    });

    wmsLayer.addTo(tMap);
  }
}

// Karte definieren
var map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
  dragging: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
  tap: false,
}).setView([51.733005, 14.338048], 13);
// Custom Control für Vollbildanzeige
var FullscreenControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd: function () {
    var container = L.DomUtil.create("div", "leaflet-bar");
    var btn = L.DomUtil.create("button", "btn btn-dark", container);
    btn.type = "button";
    btn.innerHTML = '<span class="ion-md-expand"></span>';
    btn.title = "Karte vergrößern";
    L.DomEvent.on(btn, "click", function (e) {
      L.DomEvent.stopPropagation(e);
      $("#mapModal").modal("show");
      setTimeout(initFullscreenMap, 300);
    });
    return container;
  },
});
map.addControl(new FullscreenControl());
var fullscreenMap = null;
function fitFullscreenMap() {
  if (!fullscreenMap) return;
  fullscreenMap.invalidateSize();
  var allBounds = [];
  currentRoutes.forEach(function (route) {
    try {
      if (route.geometry) {
        var b = L.geoJSON(route.geometry).getBounds();
        if (b.isValid()) allBounds.push(b);
      } else if (route.coords) {
        allBounds.push(L.latLngBounds([route.coords, route.coords]));
      }
    } catch (_) {}
  });
  if (allBounds.length) {
    var combined = allBounds[0];
    for (var i = 1; i < allBounds.length; i++) combined = combined.extend(allBounds[i]);
    fullscreenMap.fitBounds(combined, { padding: [40, 40] });
  } else if (currentGeometry) {
    if (currentGeometry.type === "point" && currentGeometry.coords) {
      fullscreenMap.setView(currentGeometry.coords, 15);
    } else if (currentGeometry.geojson) {
      try { fullscreenMap.fitBounds(L.geoJSON(currentGeometry.geojson).getBounds()); } catch (_) {}
    }
  }
}
function initFullscreenMap() {
  if (fullscreenMap) {
    fitFullscreenMap();
    return;
  }
  fullscreenMap = L.map("map_fullscreen", { zoomControl: true, attributionControl: false });
  AddMapLayer(fullscreenMap);
  // Initialen View setzen damit Layer sofort korrekt gerendert werden
  if (currentGeometry && currentGeometry.type === "point" && currentGeometry.coords) {
    fullscreenMap.setView(currentGeometry.coords, 12);
  } else {
    fullscreenMap.setView([51.0, 10.0], 6);
  }
  if (currentGeometry) {
    if (currentGeometry.type === "point" && currentGeometry.coords) {
      L.marker(currentGeometry.coords, { icon: redIcon }).addTo(fullscreenMap);
    } else if (currentGeometry.geojson) {
      L.geoJSON(currentGeometry.geojson).addTo(fullscreenMap);
    }
  }
  drawRoutesOnMap(currentRoutes, fullscreenMap, fullscreenRouteLayers);
  // Sofort auf tatsächlichen Inhalt zoomen statt auf den groben Initial-View zu warten
  // (das "shown.bs.modal"-Event kann je nach Timing vor dieser Funktion feuern und
  // fitFullscreenMap() findet dann noch keine fullscreenMap vor -> Karte bleibt auf
  // Deutschland-weitem Fallback stehen)
  fitFullscreenMap();
}
$("#mapModal").on("shown.bs.modal", function () {
  fitFullscreenMap();
});
$("#mapModal").on("hidden.bs.modal", function () {
  if (fullscreenMap) {
    fullscreenMap.remove();
    fullscreenMap = null;
    fullscreenRouteLayers = [];
  }
});

AddMapLayer();

// Icon der Karte zuordnen
var redIcon = new L.Icon({
  iconUrl: "/media/marker-icon-2x-red.png",
  shadowUrl: "/media/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Icon setzen
var marker = L.marker(new L.LatLng(0, 0), {
  icon: redIcon,
}).addTo(map);

// GeoJSON vordefinieren
var geojson = L.geoJSON().addTo(map);

// OSRM-Routen-Layer
var routeLayers = [];
var fullscreenRouteLayers = [];
var currentRoutes = [];

function drawRoutesOnMap(routes, targetMap, layerArr) {
  layerArr.forEach(function (l) { targetMap.removeLayer(l); });
  layerArr.length = 0;
  if (!routes || !routes.length) return;
  routes.forEach(function (route) {
    if (!route.geometry) {
      // Keine Route vorhanden (z.B. Wache liegt im Einsatzbereich) -> nur Label anzeigen
      if (route.coords) {
        var labelMarker = L.circleMarker([route.coords[0], route.coords[1]], {
          radius: 8, color: "#ffffff", weight: 2, fillColor: route.color, fillOpacity: 1.0,
        }).addTo(targetMap);
        if (route.name_wache) labelMarker.bindTooltip(route.name_wache, { permanent: true, direction: "top", offset: [0, -10], className: "route-label" });
        layerArr.push(labelMarker);
      }
      return;
    }
    var shadow = L.geoJSON(route.geometry, {
      style: { color: "#000000", weight: 10, opacity: 0.18, lineCap: "round", lineJoin: "round" },
    }).addTo(targetMap);
    layerArr.push(shadow);
    var halo = L.geoJSON(route.geometry, {
      style: { color: "#ffffff", weight: 5, opacity: 0.65, lineCap: "round", lineJoin: "round" },
    }).addTo(targetMap);
    layerArr.push(halo);
    var layer = L.geoJSON(route.geometry, {
      style: { color: route.color, weight: 4, opacity: 1.0, lineCap: "round", lineJoin: "round" },
    }).addTo(targetMap);
    layerArr.push(layer);
    var coords = route.geometry.coordinates;
    if (coords && coords.length) {
      var start = coords[0];
      var startMarker = L.circleMarker([start[1], start[0]], {
        radius: 8, color: "#ffffff", weight: 2, fillColor: route.color, fillOpacity: 1.0,
      }).addTo(targetMap);
      if (route.name_wache) startMarker.bindTooltip(route.name_wache, { permanent: true, direction: "top", offset: [0, -10], className: "route-label" });
      layerArr.push(startMarker);
    }
  });
}

/* ########################### */
/* ####### Rückmeldung ####### */
/* ########################### */

var counter_rmld = [];

var counter_ID = 0;

function start_counter(zeitstempel, ablaufzeit) {
  // Split timestamp into [ Y, M, D, h, m, s ]
  var t1 = zeitstempel.split(/[- :]/),
    t2 = ablaufzeit.split(/[- :]/);

  var start = new Date(t1[0], t1[1] - 1, t1[2], t1[3], t1[4], t1[5]),
    end = new Date(t2[0], t2[1] - 1, t2[2], t2[3], t2[4], t2[5]);

  clearInterval(counter_ID);
  counter_ID = setInterval(function () {
    do_progressbar(start, end);
  }, 1000);
}

function reset_rmld(p_uuid) {
  var bar_uuid = "bar-" + p_uuid;
  $("#pg-ek")
    .children()
    .each(function (i) {
      if (!$(this).hasClass(bar_uuid)) {
        $(this).remove();
      }
    });
  $("#pg-gf")
    .children()
    .each(function (i) {
      if (!$(this).hasClass(bar_uuid)) {
        $(this).remove();
      }
    });
  $("#pg-zf")
    .children()
    .each(function (i) {
      if (!$(this).hasClass(bar_uuid)) {
        $(this).remove();
      }
    });
  $("#pg-vf")
    .children()
    .each(function (i) {
      if (!$(this).hasClass(bar_uuid)) {
        $(this).remove();
      }
    });
}

function add_resp_progressbar(p_uuid, p_id, p_type, p_content, p_agt, p_fzf, p_ma, p_med, p_start, p_end, p_container) {
  var target = p_container || "#pg-container";
  // Hintergrund der Progressbar festlegen
  var bar_background = "";
  var bar_border = "";
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
  var pgbar = document.getElementById("pg-" + p_id);
  if (!pgbar) {
    var wrapperClasses = target === "#pg-container" ? "col-xl-4 col-6" : "col-12 col-md-6 col-lg-4 mb-2 px-1";
    $(target).append('<div class="' + wrapperClasses + " pg-" + p_type + '" id="pg-' + p_id + '" data-rmld-wrapper="1"></div>');
    $("#pg-" + p_id).append(
      '<div class="progress mx-1 mt-1 position-relative ' +
        bar_border +
        " " +
        bar_uuid +
        '" id="pg-' +
        p_type +
        "-" +
        p_id +
        '" style="height: 15px; font-size: 14px;"></div>'
    );
    if (p_agt > 0) {
      $("#pg-" + p_id).addClass("p_agt");
    }
    if (p_fzf > 0) {
      $("#pg-" + p_id).addClass("p_fzf");
    }
    if (p_ma > 0) {
      $("#pg-" + p_id).addClass("p_ma");
    }
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
    $("#pg-" + p_type + "-" + p_id).append(
      '<div id="pg-text-' + p_id + '" class="justify-content-center align-items-center d-flex position-absolute h-100 w-100"></div>'
    );
  } else {
    // TODO Anpassung bei Update
  }
  // Statischen Overlay-Text einmalig vorberechnen
  var _caps = [];
  if (p_agt > 0) _caps.push("AGT");
  if (p_fzf > 0) _caps.push("FZF");
  if (p_ma > 0) _caps.push("MA");
  if (p_med > 0) _caps.push("MED");
  var _overlay_text = (p_content || "") + (_caps.length > 0 ? " (" + _caps.join(", ") + ")" : "");

  // DOM-Referenzen einmalig cachen
  var _$bar = $("#pg-bar-" + p_id);
  var _$overlay = $("#pg-text-" + p_id);

  // Overlay-Spans einmalig anlegen
  _$overlay.empty().addClass("rmld-timer-running");
  var _timeNode = $("<span>").css({ position: "absolute", left: "4px" }).appendTo(_$overlay)[0];
  if (_overlay_text) $("<span>").text(_overlay_text).appendTo(_$overlay);

  var _start_ms = p_start.getTime();
  var _end_ms = p_end.getTime();

  clearInterval(counter_rmld[p_id]);
  counter_rmld[p_id] = setInterval(function () {
    var now = Date.now();
    var current_progress = Math.round((100 / (_start_ms - _end_ms)) * (_start_ms - now));

    if (current_progress >= 100) {
      _$bar.css("width", "100%").attr("aria-valuenow", 100);
      _$overlay.empty().removeClass("rmld-timer-running").text(_overlay_text).addClass("ion-md-checkmark-circle");
      clearInterval(counter_rmld[p_id]);
    } else {
      var diff = Math.abs(_end_ms - now);
      var min = Math.floor(diff / 60000);
      var sec = Math.floor((diff % 60000) / 1000);
      _$bar.css("width", current_progress + "%").attr("aria-valuenow", current_progress);
      _timeNode.textContent = min + ":" + (sec < 10 ? "0" + sec : sec);
    }
  }, 1000);
}

// Ergänzt: Station-Zeile und Rückmelde-Summary sicherstellen
function ensure_station_row(stationId, stationName) {
  if (document.getElementById("wache_id_" + stationId)) return; // existiert schon
  var tableRef = document.getElementById("table_einsatzmittel").getElementsByTagName("tbody")[0];
  var newRow = tableRef.insertRow();
  var new_th = document.createElement("th");
  new_th.className = "wache-col";
  new_th.innerHTML = stationName;
  new_th.id = "wache_id_" + stationId;
  newRow.appendChild(new_th);
  var flex_div_wa = document.createElement("div");
  flex_div_wa.className = "d-flex flex-wrap justify-content-between align-items-center";
  flex_div_wa.id = "station_em_" + stationId;
  var new_td = document.createElement("td");
  new_td.appendChild(flex_div_wa);
  newRow.appendChild(new_td);
}
// Neu: Summary + Bars Container für Rückmeldungen je Wache
function ensure_station_rmld_summary(stationId) {
  if (document.getElementById("rmld-summary-" + stationId)) return;
  var header = document.getElementById("wache_id_" + stationId);
  if (!header) return;
  var td = header.nextElementSibling;
  if (!td) return;
  var rmldSummary = document.createElement("div");
  rmldSummary.className = "rmld-summary mt-2";
  rmldSummary.id = "rmld-summary-" + stationId;
  rmldSummary.innerHTML =
    "" +
    '<div class="d-flex flex-wrap align-items-start small px-1" id="rmld-counters-' +
    stationId +
    '">' +
    '<div class="border border-secondary rounded-pill p-1 mr-2 mb-1 d-flex align-items-center">' +
    '<span class="mr-1">Gesamt</span><span class="badge badge-primary" id="rmld-total-' +
    stationId +
    '">0</span>' +
    "</div>" +
    '<div class="border border-secondary rounded-pill p-1 mr-2 mb-1 d-flex align-items-center flex-wrap">' +
    '<span class="text-success mr-1">EK</span><span class="badge badge-success mr-2" id="rmld-ek-' +
    stationId +
    '">0</span>' +
    '<span class="text-info mr-1">GF</span><span class="badge badge-info mr-2" id="rmld-gf-' +
    stationId +
    '">0</span>' +
    '<span class="text-light mr-1">ZF</span><span class="badge badge-light text-dark mr-2" id="rmld-zf-' +
    stationId +
    '">0</span>' +
    '<span class="text-danger mr-1">VF</span><span class="badge badge-danger" id="rmld-vf-' +
    stationId +
    '">0</span>' +
    "</div>" +
    '<div class="border border-secondary rounded-pill p-1 mr-2 mb-1 d-flex align-items-center flex-wrap">' +
    '<span class="text-warning mr-1">AGT</span><span class="badge badge-warning mr-2" id="rmld-agt-' +
    stationId +
    '">0</span>' +
    '<span class="text-muted mr-1">MA</span><span class="badge badge-primary mr-2" id="rmld-ma-' +
    stationId +
    '">0</span>' +
    '<span class="text-muted mr-1">FZF</span><span class="badge badge-primary mr-2" id="rmld-fzf-' +
    stationId +
    '">0</span>' +
    '<span class="text-muted mr-1">MED</span><span class="badge badge-primary" id="rmld-med-' +
    stationId +
    '">0</span>' +
    "</div>" +
    "</div>" +
    '<div class="row no-gutters mt-1" id="rmld-bars-' +
    stationId +
    '"></div>';
  td.appendChild(rmldSummary);
}
function update_station_counts(stationId) {
  ensure_station_rmld_summary(stationId);
  var container = document.getElementById("rmld-bars-" + stationId);
  if (!container) return;
  // Nur Wrapper (nicht die inneren Progress-Divs) zählen
  var wrappers = container.querySelectorAll('[data-rmld-wrapper="1"]');
  var totalCount = wrappers.length;
  var ek = container.querySelectorAll('[data-rmld-wrapper="1"].pg-ek').length;
  var gf = container.querySelectorAll('[data-rmld-wrapper="1"].pg-gf').length;
  var zf = container.querySelectorAll('[data-rmld-wrapper="1"].pg-zf').length;
  var vf = container.querySelectorAll('[data-rmld-wrapper="1"].pg-vf').length;
  var agt = container.querySelectorAll('[data-rmld-wrapper="1"].p_agt').length;
  var ma = container.querySelectorAll('[data-rmld-wrapper="1"].p_ma').length;
  var fzf = container.querySelectorAll('[data-rmld-wrapper="1"].p_fzf').length;
  var med = container.querySelectorAll('[data-rmld-wrapper="1"].p_med').length;
  $("#rmld-total-" + stationId).text(totalCount);
  $("#rmld-ek-" + stationId).text(ek);
  $("#rmld-gf-" + stationId).text(gf);
  $("#rmld-zf-" + stationId).text(zf);
  $("#rmld-vf-" + stationId).text(vf);
  $("#rmld-agt-" + stationId).text(agt);
  $("#rmld-ma-" + stationId).text(ma);
  $("#rmld-fzf-" + stationId).text(fzf);
  $("#rmld-med-" + stationId).text(med);
}

function recount_rmld(p_uuid) {
  let bar_uuid = "bar-" + p_uuid;
  // Zähler auf 0 Setzen
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

  // Rückmeldecontainer anzeigen/ausblenden
  if ($("#ek-counter").text() == "0" && $("#gf-counter").text() == "0" && $("#zf-counter").text() == "0" && $("#vf-counter").text() == "0") {
    $("#rmld_container").addClass("d-none");
  } else {
    $("#rmld_container").removeClass("d-none");
  }
}

/* ########################### */
/* ######## SOCKET.IO ######## */
/* ########################### */

// Websocket
var socket = io("/dbrd", {
  withCredentials: true,
});

// Wachen-ID bei Connect an Server senden
socket.on("connect", function () {
  socket.emit("dbrd", dbrd_uuid);
  $("#waipModal").modal("hide");
  // TODO: bei Reconnect des Clients durch Verbindungsabbruch, erneut Daten anfordern
});

socket.on("connect_error", function (err) {
  $("#waipModalTitle").text("FEHLER");
  $("#waipModalBody").text("Verbindung zum Server getrennt!");
  $("#waipModal").modal("show");
});

// ID von Server und Client vergleichen, falls ungleich -> Seite neu laden
socket.on("io.version", function (server_id) {
  console.log("Version", server_id);
  console.log("Client", client_id);
  if (client_id != server_id) {
    $("#waipModal").modal("hide");
    setTimeout(function () {
      $("#waipModalTitle").html("ACHTUNG");
      $("#waipModalBody").html("Neue Server-Version. Seite wird gleich automatisch neu geladen!");
      $("#waipModal").modal("show");
      setTimeout(function () {
        location.reload();
      }, Math.floor(Math.random() * (15000 - 1000 + 1)) + 1000);
    }, 1000);
  }
});

// ggf. Fehler ausgeben
socket.on("io.error", function (data) {
  console.error("Error:", data);
});

// Daten löschen, Uhr anzeigen
socket.on("io.deleted", function () {
  console.log("del");
  // Einsatz nicht mehr vorhanden
  $("#waipModal").modal("hide");
  setTimeout(function () {
    $("#waipModalTitle").html("ACHTUNG");
    $("#waipModalBody").html(`Der aufgerufene Einsatz wurde gel&ouml;scht und ist nicht mehr verfügbar.<br>
    Sie werden in gleich zur Startseite zurückgeleitet.`);
    $("#waipModal").modal("show");
    setTimeout(function () {
      window.location.href = window.location.origin;
    }, Math.floor(Math.random() * (15000 - 1000 + 1)) + 1000);
  }, 1000);
});

// Einsatzdaten laden, Wachalarm anzeigen
socket.on("io.Einsatz", function (data) {
  // DEBUG
  console.log(data);
  // Einsatz-ID speichern
  waip_id = data.id;
  // DBRD-ID und Zeit setzten
  if (data.einsatznummer) {
    $("#dbrd_id").html("&nbsp;" + data.einsatznummer);
  } else {
    $("#dbrd_id").html("&nbsp;" + data.uuid);
  }
  $("#einsatz_datum").html(data.zeitstempel);

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
      break;
    case "Hilfeleistungseinsatz":
      $("#einsatz_art").addClass("bg-info");
      $("#einsatz_stichwort").addClass("ion-md-construct");
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
  $("#einsatz_stichwort").html(" " + data.stichwort);
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
  $("#einsatzort_list").empty();
  if (data.objektteil) {
    $("#einsatzort_list").append('<div class="list-group-item ist-group-item-action flex-column align-items-start" id="listitem_objektteil">');
    $("#listitem_objektteil").append('<li class="d-flex w-100 justify-content-between" id="dflex_objektteil">');
    $("#dflex_objektteil").append('<p class="mb-1" id="data_objektteil">' + data.objektteil + "</p>");
    $("#dflex_objektteil").append('<small class="pl-1 text-muted text-right">Teilobjekt</small>');
  }
  if (data.objekt) {
    $("#einsatzort_list").append('<div class="list-group-item ist-group-item-action flex-column align-items-start" id="listitem_objekt">');
    $("#listitem_objekt").append('<li class="d-flex w-100 justify-content-between" id="dflex_objekt">');
    $("#dflex_objekt").append('<p class="mb-1" id="data_objekt">' + data.objekt + "</p>");
    $("#dflex_objekt").append('<small class="pl-1 text-muted text-right">Objekt</small>');
  }
  if (data.einsatzdetails) {
    $("#einsatzort_list").append('<div class="list-group-item ist-group-item-action flex-column align-items-start" id="listitem_einsatzdetails">');
    $("#listitem_einsatzdetails").append('<li class="d-flex w-100 justify-content-between" id="dflex_einsatzdetails">');
    $("#dflex_einsatzdetails").append('<p class="mb-1" id="data_einsatzdetails">' + data.einsatzdetails + "</p>");
    $("#dflex_einsatzdetails").append('<small class="pl-1 text-muted text-right">Ortdetails</small>');
  }
  if (data.ort) {
    $("#einsatzort_list").append('<div class="list-group-item ist-group-item-action flex-column align-items-start" id="listitem_ort">');
    $("#listitem_ort").append('<li class="d-flex w-100 justify-content-between" id="dflex_ort">');
    $("#dflex_ort").append('<p class="mb-1" id="data_ort">' + data.ort + "</p>");
    $("#dflex_ort").append('<small class="pl-1 text-muted text-right">Ort</small>');
  }
  if (data.ortsteil) {
    // wenn Ortsteil gleich Ort, dann nicht anzeigen
    if (data.ortsteil !== data.ort) {
      $("#einsatzort_list").append('<div class="list-group-item ist-group-item-action flex-column align-items-start" id="listitem_ortsteil">');
      $("#listitem_ortsteil").append('<li class="d-flex w-100 justify-content-between" id="dflex_ortsteil">');
      $("#dflex_ortsteil").append('<p class="mb-1" id="data_ortsteil">' + data.ortsteil + "</p>");
      $("#dflex_ortsteil").append('<small class="pl-1 text-muted text-right">Ortsteil</small>');
    }
  }
  if (data.strasse) {
    // Hausnummer an Strasse anfuegen, falls vorhanden
    tmp_strasse = data.strasse;
    if (data.hausnummer) {
      tmp_strasse = data.strasse + "&nbsp;" + data.hausnummer;
    } else {
      tmp_strasse = data.strasse;
    }
    $("#einsatzort_list").append('<div class="list-group-item ist-group-item-action flex-column align-items-start" id="listitem_strasse">');
    $("#listitem_strasse").append('<li class="d-flex w-100 justify-content-between" id="dflex_strasse">');
    $("#dflex_strasse").append('<p class="mb-1" id="data_strasse">' + tmp_strasse + "</p>");
    $("#dflex_strasse").append('<small class="pl-1 text-muted text-right">Stra&szlig;e</small>');
  }
  if (data.besonderheiten) {
    $("#einsatzort_list").append('<div class="list-group-item ist-group-item-action flex-column align-items-start" id="listitem_besonderheiten">');
    $("#listitem_besonderheiten").append('<li class="d-flex w-100 justify-content-between" id="dflex_besonderheiten">');
    $("#dflex_besonderheiten").append('<p class="mb-1 text-warning" id="data_besonderheiten">' + data.besonderheiten + "</p>");
    $("#dflex_besonderheiten").append('<small class="pl-1 text-muted text-right">Besonderheiten</small>');
  }
  // Alte Einsatzmittel loeschen
  var table_em = document.getElementById("table_einsatzmittel");
  table_em.getElementsByTagName("tbody")[0].innerHTML = "";
  // Einsatzmittel-Tabelle
  for (var i in data.einsatzmittel) {
    var wache_vorhanden = false;
    var wache_zeile = 0;
    var wachen_idstr = data.einsatzmittel[i].em_station_name.replace(/[^A-Z0-9]+/gi, "_");
    for (var j = 0, row; (row = table_em.rows[j]); j++) {
      if (row.cells[0].innerHTML == data.einsatzmittel[i].em_station_name) {
        wache_vorhanden = true;
        wache_zeile = j;
      }
    }
    if (!wache_vorhanden) {
      // Zeile fuer Wache anlegen, falls diese noch nicht hinterlegt
      var tableRef = document.getElementById("table_einsatzmittel").getElementsByTagName("tbody")[0];
      var newRow = tableRef.insertRow();

      //var newCell = newRow.insertCell(0);
      // Wachennamen hinterlegen
      var new_th = document.createElement("th");
      new_th.className = "wache-col";
      new_th.innerHTML = data.einsatzmittel[i].em_station_name;
      // data.einsatzmittel[i].em_station_id als ID hinzufügen
      new_th.id = "wache_id_" + data.einsatzmittel[i].em_station_id;
      //var newText = document.createTextNode(data.einsatzmittel[i].wachenname);
      //newCell.outerHTML = "<th></th>";
      //newCell.appendChild(newText);
      newRow.appendChild(new_th);

      //Flex-Element fuer Einsatzmittel der Wache erzeugen
      var flex_div_wa = document.createElement("div");
      flex_div_wa.className = "d-flex flex-wrap justify-content-between align-items-center";
      flex_div_wa.id = wachen_idstr;

      //Flexelement zur Tabelle hinzuefuegen
      var new_td = document.createElement("td");
      new_td.appendChild(flex_div_wa);
      newRow.appendChild(new_td);
      //table_em.rows[wache_zeile].cells[1].appendChild(flex_div_wa);
    }

    //Flex-Element fuer Einsatzmittel erzeugen
    var flex_div_em = document.createElement("div");
    flex_div_em.className = "flex-fill rounded bg-secondary text-nowrap p-2 m-1";

    //Justify-Rahmen feuer Einsatzmittel erzeugen
    var justify_div = document.createElement("div");
    justify_div.className = "d-flex justify-content-between";

    //Einsatzmittel-Div erzeugen
    var em_div = document.createElement("div");
    em_div.className = "pr-2";
    em_div.innerHTML = data.einsatzmittel[i].em_funkrufname;

    //Info-Div erzeugen, wenn keine Alarmzeit
    var info_div = document.createElement("div");
    if (!data.einsatzmittel[i].em_zeitstempel_alarmierung) {  
      info_div.className = "p-2 badge badge-pill badge-info";
      info_div.innerHTML = "!";
    }

    //Erzeugte Div zusammensetzen
    flex_div_em.appendChild(justify_div);
    justify_div.appendChild(em_div);
    justify_div.appendChild(info_div);

    // Einsatzmittel hinzuefuegen
    document.getElementById(wachen_idstr).appendChild(flex_div_em);
  }
  // Alte Routen entfernen
  routeLayers.forEach(function (l) { map.removeLayer(l); });
  routeLayers = [];
  // Karte leeren
  map.removeLayer(marker);
  map.removeLayer(geojson);
  // Karte setzen
  if (data.wgs84_x && data.wgs84_y) {
    marker = L.marker(new L.LatLng(data.wgs84_x, data.wgs84_y), { icon: redIcon }).addTo(map);
    map.setView(new L.LatLng(data.wgs84_x, data.wgs84_y), 15);
    currentGeometry = { type: "point", coords: [data.wgs84_x, data.wgs84_y] };
  } else {
    geojson = L.geoJSON(JSON.parse(data.geometry));
    geojson.addTo(map);
    map.fitBounds(geojson.getBounds());
    map.setZoom(13);
    currentGeometry = { type: "geojson", geojson: JSON.parse(data.geometry) };
  }
});

// OSRM-Routen auf dem Dashboard anzeigen
socket.on("io.routes", function (routes) {
  currentRoutes = routes || [];
  drawRoutesOnMap(currentRoutes, map, routeLayers);
  if (fullscreenMap) drawRoutesOnMap(currentRoutes, fullscreenMap, fullscreenRouteLayers);

  // Kartenausschnitt auf Routen + Einsatzmarker anpassen.
  // Bounds direkt aus Koordinaten berechnen statt temporärer GeoJSON-Objekte (kein DOM-Overhead).
  var allBounds = [];
  currentRoutes.forEach(function (route) {
    try {
      if (route.geometry && route.geometry.coordinates && route.geometry.coordinates.length) {
        var latlngs = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
        var b = L.latLngBounds(latlngs);
        if (b.isValid()) allBounds.push(b);
      } else if (route.coords) {
        allBounds.push(L.latLngBounds([route.coords, route.coords]));
      }
    } catch (_) {}
  });
  if (allBounds.length) {
    var combined = allBounds[0];
    for (var i = 1; i < allBounds.length; i++) combined = combined.extend(allBounds[i]);
    try {
      var mPos = marker.getLatLng();
      if (mPos.lat !== 0 || mPos.lng !== 0) combined = combined.extend(mPos);
    } catch (_) {}
    map.fitBounds(combined, { padding: [30, 30] });
  }
});

socket.on("io.new_rmld", function (data) {
  // DEBUG
  console.log("neue Rückmeldung:", data);
  // HTML festlegen
  var item_type = "";
  var item_content = "";
  // Rollenabbildung
  if (data.rmld_role == "team_member") {
    item_content = data.rmld_alias || "Einsatzkraft";
    item_type = "ek";
  } else if (data.rmld_role == "crew_leader") {
    item_content = data.rmld_alias || "Gruppenführer";
    item_type = "gf";
  } else if (data.rmld_role == "division_chief") {
    item_content = data.rmld_alias || "Zugführer";
    item_type = "zf";
  } else if (data.rmld_role == "group_commander") {
    item_content = data.rmld_alias || "Verbandsführer";
    item_type = "vf";
  }
  if (data.rmld_capability_agt > 0) item_content += " AGT";
  if (data.rmld_capability_fzf > 0) item_content += " FZF";
  if (data.rmld_capability_ma > 0) item_content += " MA";
  if (data.rmld_capability_med > 0) item_content += " MED";
  var pg_start = new Date(data.time_decision);
  var pg_end = new Date(data.time_arrival);
  // Station zuordnen, falls nicht vorhanden -> Sonstige
  var stationId = typeof data.wache_id !== "undefined" && data.wache_id !== null ? data.wache_id : "misc";
  var stationHeader = document.getElementById("wache_id_" + stationId);
  if (!stationHeader) {
    ensure_station_row(stationId, stationId === "misc" ? "Sonstige" : data.wache_name || "Wache " + stationId);
  }
  ensure_station_rmld_summary(stationId);
  // Progressbar im Stations-Container
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
    pg_end,
    "#rmld-bars-" + stationId
  );
  // Stationszähler aktualisieren
  update_station_counts(stationId);
  // Gesamtzähler aktualisieren
  recount_rmld(data.waip_uuid);
  // Audio
  var audio = document.getElementById("audio");
  audio.src = "/media/bell_message.mp3";
  var playPromise = document.querySelector("audio").play();
  if (playPromise !== undefined) {
    playPromise
      .then(function () {
        audio.play();
      })
      .catch(function () {
        console.log("Notification playback failed");
      });
  }
});
