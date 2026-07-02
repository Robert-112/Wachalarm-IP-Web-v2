const turf = require("@turf/turf");

// Farbpalette für Routen – gut lesbar auf hellen und dunklen Karten
const ROUTE_COLORS = ["#c0392b", "#1565C0", "#2e7d32", "#e65100", "#6a1b9a", "#00838f", "#bf360c", "#00695c"];

module.exports = (app_cfg, logger) => {
  const dev = app_cfg.development.dev_log;

  if (dev) logger.log("log", `OSRM: Modul geladen. Host=${app_cfg.osrm.host} Port=${app_cfg.osrm.port} Enabled=${app_cfg.osrm.enabled}`);

  // Deterministische Farbe je Wachennummer (immer gleiche Wache → gleiche Farbe)
  const wachen_color = (wachen_nr) => {
    let h = 0;
    const s = String(wachen_nr);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
    return ROUTE_COLORS[h % ROUTE_COLORS.length];
  };

  // OSRM-Route abrufen: Rückgabe GeoJSON LineString oder null bei Fehler
  const get_route = async (fromLat, fromLng, toLat, toLng) => {
    const url = `http://${app_cfg.osrm.host}:${app_cfg.osrm.port}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    if (dev) logger.log("log", `OSRM get_route: Anfrage an ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (dev) logger.log("log", `OSRM get_route: HTTP ${res.status} von ${app_cfg.osrm.host}:${app_cfg.osrm.port}`);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status} für ${url}`);
    const data = await res.json();
    if (!data.routes?.length) throw new Error("OSRM: Keine Route in der Antwort");
    const geom = data.routes[0].geometry;
    if (dev) logger.log("log", `OSRM get_route: Route erhalten, ${geom.coordinates?.length ?? 0} Koordinatenpunkte, Distanz=${data.routes[0].distance}m`);
    return geom; // GeoJSON LineString
  };

  // Schwerpunkt eines GeoJSON-Objekts berechnen
  const get_centroid = (geometryGeojson) => {
    const geo = typeof geometryGeojson === "string" ? JSON.parse(geometryGeojson) : geometryGeojson;
    const c = turf.centroid(geo);
    const result = { lat: c.geometry.coordinates[1], lng: c.geometry.coordinates[0] };
    if (dev) logger.log("log", `OSRM get_centroid: Schwerpunkt lat=${result.lat} lng=${result.lng}`);
    return result;
  };

  // Route am Rand eines GeoJSON-Polygons abschneiden (Clipping)
  const clip_route_at_boundary = (routeGeojson, boundaryGeojson) => {
    try {
      const line = turf.feature(routeGeojson);

      // boundaryGeojson normalisieren → Feature mit Polygon-Geometrie
      let raw = typeof boundaryGeojson === "string" ? JSON.parse(boundaryGeojson) : boundaryGeojson;
      let poly = raw;
      if (raw.type === "FeatureCollection" && raw.features?.length) poly = raw.features[0];
      if (poly.type !== "Feature") poly = turf.feature(poly);

      // Schnittpunkte Route ↔ Polygon-Grenze
      const intersections = turf.lineIntersect(line, poly);
      if (dev) logger.log("log", `OSRM clip_route_at_boundary: ${intersections.features.length} Schnittpunkt(e) mit Bereichsgrenze gefunden`);
      if (!intersections.features.length) {
        // Kein Schnittpunkt ermittelbar → Eintrittspunkt unbekannt. Ungekürzte Route würde
        // den echten Einsatzort verraten, daher lieber gar keine Route als eine unsichere.
        logger.log("warn", "OSRM clip_route_at_boundary: Kein Schnitt mit Bereichsgrenze gefunden → route_half wird nicht gesetzt");
        return null;
      }

      // Schnittpunkte nach Distanz vom Routen-Start sortieren
      const withDist = intersections.features.map((pt) => ({
        pt,
        loc: turf.nearestPointOnLine(line, pt).properties.location ?? 0,
      }));
      withDist.sort((a, b) => a.loc - b.loc);

      // Letzten Schnittpunkt nehmen (= Eintrittspunkt in den Bereich)
      const clipPt = withDist[withDist.length - 1].pt;
      const startPt = turf.point(routeGeojson.coordinates[0]);
      const clipped = turf.lineSlice(startPt, clipPt, line);
      if (dev) logger.log("log", `OSRM clip_route_at_boundary: Gekürzt auf ${clipped.geometry.coordinates?.length ?? 0} Punkte (Eintrittspunkt bei loc=${withDist[withDist.length - 1].loc.toFixed(1)}m)`);
      return clipped.geometry;
    } catch (err) {
      // Auch hier: bei Fehlschlag lieber keine Route liefern als versehentlich die
      // ungekürzte (den echten Einsatzort verratende) Route.
      logger.log("warn", `OSRM Clipping fehlgeschlagen: ${err.message}`);
      return null;
    }
  };

  // Prüft ob eine Wache (Startpunkt) innerhalb des Einsatzbereichs liegt.
  // In diesem Fall würde route_half den echten Einsatzort verraten → keine Route speichern.
  const station_inside_boundary = (stationLat, stationLng, boundaryGeojson) => {
    try {
      let raw = typeof boundaryGeojson === "string" ? JSON.parse(boundaryGeojson) : boundaryGeojson;
      let poly = raw;
      if (raw.type === "FeatureCollection" && raw.features?.length) poly = raw.features[0];
      if (poly.type !== "Feature") poly = turf.feature(poly);
      return turf.booleanPointInPolygon(turf.point([stationLng, stationLat]), poly);
    } catch (err) {
      logger.log("warn", `OSRM station_inside_boundary Fehler: ${err.message}`);
      return false;
    }
  };

  return { get_route, get_centroid, clip_route_at_boundary, station_inside_boundary, wachen_color };
};
