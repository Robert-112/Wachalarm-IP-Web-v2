
$(document).ready(function() {
  // Sound nicht beim laden der Seite abspielen
  let audio = document.getElementById('audio');
  audio.src = ('/media/bell_message.mp3');
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

// Karte definieren
let map = L.map('map', {
  zoomControl: false
}).setView([51.733005, 14.338048], 13);

// Layer der Karte
mapLink = L.tileLayer(
  map_tile, {
    maxZoom: 18,
    attribution: map_attribution
  }).addTo(map);

// Icon der Karte zuordnen
let redIcon = new L.Icon({
  iconUrl: '/media/marker-icon-2x-red.png',
  shadowUrl: '/media/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Icon setzen
let marker = L.marker(new L.LatLng(0, 0), {
  icon: redIcon
}).addTo(map);

// GeoJSON vordefinieren
let geojson = L.geoJSON().addTo(map);


/* ########################### */
/* ####### Rückmeldung ####### */
/* ########################### */

let counter_rmld = [];

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
};

function reset_rmld(p_uuid) {
  let bar_uuid = 'bar-' + p_uuid;
  $('#pg-ek').children().each(function (i) {
    if (!$(this).hasClass(bar_uuid)) {
      $(this).remove();
    };
  });
  $('#pg-ma').children().each(function (i) {
    if (!$(this).hasClass(bar_uuid)) {
      $(this).remove();
    };
  });
  $('#pg-fk').children().each(function (i) {
    if (!$(this).hasClass(bar_uuid)) {
      $(this).remove();
    };
  });
};

function add_resp_progressbar(p_uuid, p_id, p_type, p_agt, p_start, p_end) {
  // Hintergrund der Progressbar festlegen
  let bar_background = '';
  let bar_border = '';
  if (p_agt) {
    bar_border = 'border border-warning';
  };
  switch (p_type) {
    case 'ek':
      bar_background = 'bg-success';
      break;
    case 'ma':
      bar_background = 'bg-info';
      break;
    case 'fk':
      bar_background = 'bg-light';
      break;
    default:
      bar_background = '';
      break;
  };
  let bar_uuid = 'bar-' + p_uuid;
  // pruefen ob div mit id 'pg-'+p_id schon vorhanden ist
  let pgbar = document.getElementById('pg-' + p_id);
  if (!pgbar) {
    $('#pg-' + p_type).append('<div class="progress mt-1 position-relative ' + bar_border + ' ' + bar_uuid + '" id="pg-' + p_id + '" style="height: 15px; font-size: 14px;"></div>');
    $('#pg-' + p_id).append('<div id="pg-bar-' + p_id + '" class="progress-bar progress-bar-striped ' + bar_background + '" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>');
    $('#pg-bar-' + p_id).append('<small id="pg-text-' + p_id + '" class="justify-content-center d-flex position-absolute w-100"></small>');
  } else {
    // TODO PG-Bar ändern falls neue/angepasste Rückmeldung
  };
  // Zeitschiene Anpassen
  clearInterval(counter_rmld[p_id]);
  counter_rmld[p_id] = 0;
  counter_rmld[p_id] = setInterval(function () {
    do_rmld_bar(p_id, p_start, p_end);
  }, 1000);
};

function do_rmld_bar(p_id, start, end) {
  //console.log(p_id);
  today = new Date();
  // restliche Zeit ermitteln
  let current_progress = Math.round(100 / (start.getTime() - end.getTime()) * (start.getTime() - today.getTime()));

  let diff = Math.abs(end - today);
  let minutesDifference = Math.floor(diff / 1000 / 60);
  diff -= minutesDifference * 1000 * 60;
  let secondsDifference = Math.floor(diff / 1000);
  if (secondsDifference <= 9) {
    secondsDifference = '0' + secondsDifference;
  };
  let minutes = minutesDifference + ':' + secondsDifference;
  // Progressbar anpassen
  if (current_progress >= 100) {
    $('#pg-bar-' + p_id)
      .css('width', '100%')
      .attr('aria-valuenow', 100)
      .addClass('ion-md-checkmark-circle');
    $('#pg-text-' + p_id).text('');
    // FIXME Counter_Id not defined
    clearInterval(counter_ID[p_id]);
  } else {
    $('#pg-bar-' + p_id)
      .css('width', current_progress + '%')
      .attr('aria-valuenow', current_progress);
    $('#pg-text-' + p_id).text(minutes);
  };
};

function recount_rmld(p_uuid) {
  let bar_uuid = 'bar-' + p_uuid;
  let agt_count = 0;
  // Zähler auf 0 Setzen
  $('#ek-counter').text(0);
  $('#ma-counter').text(0);
  $('#fk-counter').text(0);
  $('#agt-counter').text(0);
  // EK zählen
  $('#pg-ek').children().each(function (i) {
    if ($(this).hasClass(bar_uuid)) {
      let tmp_count = parseInt($('#ek-counter').text());
      $('#ek-counter').text(tmp_count + 1);
      if ($(this).hasClass('border-warning')) {
        agt_count++;
      };
    };
  });
  // MA zählen
  $('#pg-ma').children().each(function (i) {
    if ($(this).hasClass(bar_uuid)) {
      let tmp_count = parseInt($('#ma-counter').text());
      $('#ma-counter').text(tmp_count + 1);
      if ($(this).hasClass('border-warning')) {
        agt_count++;
      };
    };
  });
  // FK zählen
  $('#pg-fk').children().each(function (i) {
    if ($(this).hasClass(bar_uuid)) {
      let tmp_count = parseInt($('#fk-counter').text());
      $('#fk-counter').text(tmp_count + 1);
      if ($(this).hasClass('border-warning')) {
        agt_count++;
      };
    };
  });
  // AGT setzen
  $('#agt-counter').text(agt_count);
  // Rückmeldecontainer anzeigen/ausblenden
  if ($('#ek-counter').text() == '0' && $('#ma-counter').text() == '0' && $('#fk-counter').text() == '0' && $('#agt-counter').text() == '0') {
    $('#rmld_container').addClass('d-none');
  } else {
    $('#rmld_container').removeClass('d-none');
  };
};
  
  

/* ########################### */
/* ####### Timeline ######## */
/* ########################### */

    // DOM element where the Timeline will be attached
    let container = document.getElementById('visualization');
    let items = new vis.DataSet();
    let groups = new vis.DataSet();

    // Configuration for the Timeline
    let customDate = new Date();
    let alert_start = new Date(customDate.setMinutes(customDate.getMinutes() - 2));
    let timeline_end = new Date(customDate.setMinutes(customDate.getMinutes() + 13));
    let options = {
      rollingMode: {
        follow: true,
        offset: 0.25
      },
      start: alert_start,
      end: timeline_end
    };

    // Create a Timeline
    let timeline = new vis.Timeline(container, items, options);
    timeline.setGroups(groups);
 
/* ########################### */
/* ######## SOCKET.IO ######## */
/* ########################### */

// Websocket
let socket = io('/dbrd');

// Wachen-ID bei Connect an Server senden
socket.on('connect', function () {
  socket.emit('dbrd', dbrd_uuid);
  $('#waipModal').modal('hide');
  // TODO: bei Reconnect des Clients durch Verbindungsabbruch, erneut Daten anfordern
});

socket.on('connect_error', function (err) {
  $('#waipModalTitle').html('FEHLER');
  $('#waipModalBody').html('Verbindung zum Server getrennt!');
  $('#waipModal').modal('show');
});

// ID von Server und Client vergleichen, falls ungleich -> Seite neu laden
socket.on('io.version', function (server_id) {
  if (client_id != server_id) {
    $('#waipModal').modal('hide');
    setTimeout(function () {
      $('#waipModalTitle').html('ACHTUNG');
      $('#waipModalBody').html('Neue Server-Version. Seite wird in 10 Sekunden neu geladen!');
      $('#waipModal').modal('show');
      setTimeout(function () {
        location.reload();
      }, 10000);
    }, 1000);
  };
});

// ggf. Fehler ausgeben
socket.on('io.error', function (data) {
  console.log('Error:', data);
});

// Daten löschen, Uhr anzeigen
socket.on('io.deleted', function (data) {
	console.log('del')
  // Einsatz nicht mehr vorhanden
  $('#waipModal').modal('hide');
  setTimeout(function () {
    $('#waipModalTitle').html('ACHTUNG');
    $('#waipModalBody').html(`Der aufgerufene Einsatz wurde gel&ouml;scht und ist in diesem System nicht mehr verfügbar.<br>
    Sie werden in einer Minute auf die Startseite zurückgeleitet.`);
    $('#waipModal').modal('show');
    setTimeout(function () {
      window.location.href = window.location.origin;
    }, 60000);
  }, 1000);
});

// Einsatzdaten laden, Wachalarm anzeigen
socket.on('io.Einsatz', function (data) {
  // DEBUG
  console.log(data);
  // Einsatz-ID speichern
  waip_id = data.id;
  // DBRD-ID und Zeit setzten
  $('#dbrd_id').html(data.uuid);
  $('#einsatz_datum').html(data.zeitstempel);
  
  // Hintergrund der Einsatzart zunächst entfernen
  $('#einsatz_art').removeClass(function (index, className) {
    return (className.match(/(^|\s)bg-\S+/g) || []).join(' ');
  });
  // Icon der Einsatzart enfernen
  $('#einsatz_stichwort').removeClass();
  // Art und Stichwort festlegen hinterlegen
  switch (data.einsatzart) {
    case 'Brandeinsatz':
      $('#einsatz_art').addClass('bg-danger');
      $('#einsatz_stichwort').addClass('ion-md-flame');
      $('#rueckmeldung').removeClass('d-none');
      break;
    case 'Hilfeleistungseinsatz':
      $('#einsatz_art').addClass('bg-info');
      $('#einsatz_stichwort').addClass('ion-md-construct');
      $('#rueckmeldung').removeClass('d-none');
      break;
    case 'Rettungseinsatz':
      $('#einsatz_art').addClass('bg-warning');
      $('#einsatz_stichwort').addClass('ion-md-medkit');
      break;
    case 'Krankentransport':
      $('#einsatz_art').addClass('bg-success');
      $('#einsatz_stichwort').addClass('ion-md-medical');
      break;
    default:
      $('#einsatz_art').addClass('bg-secondary');
      $('#einsatz_stichwort').addClass('ion-md-information-circle');
  };
  $('#einsatz_stichwort').html(' ' + data.stichwort);
  // Sondersignal setzen
  $('#sondersignal').removeClass();
  switch (data.sondersignal) {
    case 1:
      $('#sondersignal').addClass('ion-md-notifications');
      break;
    default:
      $('#sondersignal').addClass('ion-md-notifications-off');
  };
  // Ortsdaten zusammenstellen und setzen
  $('#einsatzort_list').empty();
  if (data.objekt) {
    $('#einsatzort_list').append('<li class="list-group-item">' + data.objekt+ '</li>');
  };
  if (data.ort) {
    $('#einsatzort_list').append('<li class="list-group-item">' + data.ort+ '</li>');
  };
  if (data.ortsteil) {
    $('#einsatzort_list').append('<li class="list-group-item">' + data.ortsteil+ '</li>');
  };
  if (data.strasse) {
    $('#einsatzort_list').append('<li class="list-group-item">' + data.strasse+ '</li>');
  };
  if (data.besonderheiten) {
    $('#einsatzort_list').append('<li class="list-group-item text-warning">' + data.besonderheiten+ '</li>');
  };
  // Alte Einsatzmittel loeschen
  let table_em = document.getElementById('table_einsatzmittel');
  table_em.getElementsByTagName('tbody')[0].innerHTML = '';
  // Einsatzmittel-Tabelle
  for (let i in data.einsatzmittel) {

    let wache_vorhanden = false;
    let wache_zeile = 0;
    let wachen_idstr =data.einsatzmittel[i].wachenname.replace(/[^A-Z0-9]+/ig, '_');
    for (let j = 0, row; row = table_em.rows[j]; j++) {
      //console.log(row.cells[0].innerHTML);
      if (row.cells[0].innerHTML == data.einsatzmittel[i].wachenname) {
        wache_vorhanden = true;
        wache_zeile = j;
      };
    };
    if (!wache_vorhanden){
      // Zeile fuer Wache anlegen, falls diese noch nicht hinterlegt
      let tableRef = document.getElementById('table_einsatzmittel').getElementsByTagName('tbody')[0];
      let newRow = tableRef.insertRow();

      //let newCell = newRow.insertCell(0);
      // Wachennamen hinterlegen
      let new_th = document.createElement('th');
      new_th.innerHTML = data.einsatzmittel[i].wachenname;
      //let newText = document.createTextNode(data.einsatzmittel[i].wachenname);
      //newCell.outerHTML = "<th></th>";
      //newCell.appendChild(newText);
      newRow.appendChild(new_th);

      //Flex-Element fuer Einsatzmittel der Wache erzeugen
    let flex_div_wa = document.createElement('div');
    flex_div_wa.className = 'd-flex flex-wrap justify-content-between align-items-center';
    flex_div_wa.id = wachen_idstr;

    //Flexelement zur Tabelle hinzuefuegen
    let new_td = document.createElement('td');
    new_td.appendChild(flex_div_wa);
    newRow.appendChild(new_td);
    //table_em.rows[wache_zeile].cells[1].appendChild(flex_div_wa);
    };
    
    //Flex-Element fuer Einsatzmittel erzeugen
    let flex_div_em = document.createElement('div');
    flex_div_em.className = 'flex-fill rounded bg-secondary p-2 m-1';

    //Justify-Rahmen feuer Einsatzmittel erzeugen
    let justify_div = document.createElement('div');
    justify_div.className = 'd-flex justify-content-between';

    //Einsatzmittel-Div erzeugen
    let em_div  = document.createElement('div');
    em_div.className = 'pr-2';
    em_div.innerHTML = data.einsatzmittel[i].einsatzmittel;
    
    //Status-Div erzeugen
    let status_div  = document.createElement('div');
    switch (data.einsatzmittel[i].status) {
      case '1':
        status_div.className = 'p-2 badge badge-info';
        break;
      case '2':
        status_div.className = 'p-2 badge badge-success';
        break;
      case '3':
        status_div.className = 'p-2 badge badge-warning';
        break;
      case '4':
        status_div.className = 'p-2 badge badge-danger';
        break;
      default:
        status_div.className = 'p-2 badge badge-dark';
        break;
    }


    
    
    status_div.innerHTML = data.einsatzmittel[i].status;

    //Erzeugte Div zusammensetzen
    flex_div_em.appendChild(justify_div);
    justify_div.appendChild(em_div);
    justify_div.appendChild(status_div);

    // Einsatzmittel hinzuefuegen
    document.getElementById(wachen_idstr).appendChild(flex_div_em);
  
  };
  // Karte leeren
  map.removeLayer(marker);
  map.removeLayer(geojson);
  // Karte setzen
  if (data.wgs84_x && data.wgs84_y) {
    marker = L.marker(new L.LatLng(data.wgs84_x, data.wgs84_y), {
      icon: redIcon
    }).addTo(map);
    map.setView(new L.LatLng(data.wgs84_x, data.wgs84_y), 15);
  } else {
    geojson = L.geoJSON(JSON.parse(data.wgs84_area));
    geojson.addTo(map);
    map.fitBounds(geojson.getBounds());
    map.setZoom(13);
  };
  // Marker in Timeline setzen
  let markerText = 'Alarmierung';
  let alarm_zeit = 'alarm_zeit';
    
    
    timeline.addCustomTime(
      data.zeitstempel,
      alarm_zeit
    );
    timeline.customTimes[timeline.customTimes.length - 1].hammer.off("panstart panmove panend");
    timeline.setCustomTimeMarker(markerText, alarm_zeit, false);
    

  // TODO Ablaufzeit setzen
});

socket.on('io.new_rmld', function (data) {
  // DEBUG
  console.log(data);
  // FIXME  Änderung des Funktions-Typ berücksichtigen
  // Neue Rueckmeldung hinterlegen
  data.forEach(function (arrayItem) {
    // HTML festlegen
    let item_type = '';
    let item_content = '';
    let item_classname = '';
    // wenn Einsatzkraft dann:
    if (arrayItem.einsatzkraft) {
      item_content = 'Einsatzkraft';
      item_classname = 'ek';
      item_type = 'ek';
    };
    // wenn Maschinist dann:
    if (arrayItem.maschinist) {
      item_content = 'Maschinist';
      item_classname = 'ma';
      item_type = 'ma';
    };
    // wenn Fuehrungskraft dann:
    if (arrayItem.fuehrungskraft) {
      item_content = 'Führungskraft';
      item_classname = 'fk'
      item_type = 'fk';
    };
    // wenn AGT
    let item_agt = arrayItem.agt;
    if (arrayItem.agt){
      item_content = item_content + (' (AGT)');
      item_classname = item_classname + ('-agt');
    };
    // Variablen für Anzeige vorbereiten
    let pg_waip_uuid = arrayItem.waip_uuid;
    let pg_rmld_uuid = arrayItem.rmld_uuid;
    let pg_start = new Date(arrayItem.set_time);
    let pg_end = new Date(arrayItem.arrival_time);
    let timeline_item = {
      id: arrayItem.rmld_uuid,
      group: arrayItem.wache_id,
      className: item_classname,
      start: new Date(arrayItem.set_time),
      end: new Date(arrayItem.arrival_time),
      content: item_content
    };
    // Progressbar hinterlegen
    add_resp_progressbar(pg_waip_uuid, pg_rmld_uuid, item_type, item_agt, pg_start, pg_end);
    // in Timeline hinterlegen
    items.update(timeline_item);
    groups.update({ id: arrayItem.wache_id, content: arrayItem.wache_name });
    // Anzahl der Rückmeldung zählen
    recount_rmld(pg_waip_uuid);
  });
  let audio = document.getElementById('audio');
  audio.src = ('/media/bell_message.mp3');
  // Audio-Blockade des Browsers erkennen
  let playPromise = document.querySelector('audio').play();
  if (playPromise !== undefined) {
    playPromise.then(function () {
      audio.play();
    }).catch(function (error) {
      console.log('Notification playback failed'); 
    });
  };
});
