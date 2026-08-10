(function () {
  // Оптимизация картинок Wikimedia: меняем оригинал на 600px для скорости
  function getOptimizedImage(url, width) {
    width = width || 600;
    if (!url) return url;
    if (url.indexOf("images/") === 0 || url.indexOf("./images/") === 0) return url;
    if (url.indexOf("wikipedia/commons") === -1) return url;
    return url.replace(/\/\d+px-/g, "/" + width + "px-");
  }

  // Ленивая загрузка карт (подгружаем скрипт и стили только при открытии маршрута)
  var leafletLoaded = false;
  var leafletPromise = null;
  function loadLeaflet() {
    if (leafletLoaded && window.L) {
      return Promise.resolve(window.L);
    }
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
      var script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = function () {
        leafletLoaded = true;
        resolve(window.L);
      };
      document.body.appendChild(script);
    });
    return leafletPromise;
  }

  var allRoutes = window.ROUTES || [];
  var meta = window.ROUTE_META || {};
  var hiddenIds = {
    "spb-karelia": true,
    "pack-essentials": true,
  };
  var routes = allRoutes.filter(function (r) {
    return !hiddenIds[r.id];
  });

  var homeView = document.getElementById("home-view");
  var routePages = document.getElementById("route-pages");
  var routeGrid = document.getElementById("route-grid");
  var veloGrid = document.getElementById("velo-grid");
  var filterBar = document.getElementById("filter-bar");
  var navLinks = document.querySelectorAll("[data-nav]");
  var maps = {};
  var activeFilters = { region: "russia", city: "all", how: "all", mood: "all" };
  var filterStep = "region";
  var placeTree = window.PLACE_TREE || {};

  function regionLabel(key) {
    if (key === "asia") return "Другие страны";
    if (placeTree[key] && placeTree[key].label) return placeTree[key].label;
    return key;
  }
  var routeById = {};
  routes.forEach(function (r) {
    routeById[r.id] = r;
  });

  function getRegionCities(regionKey) {
    var node = placeTree[regionKey];
    return node && node.cities ? node.cities : [];
  }

  function getCityRoutes(regionKey, cityId) {
    var cities = getRegionCities(regionKey);
    if (cityId === "all") {
      var all = [];
      cities.forEach(function (city) {
        (city.routes || []).forEach(function (id) {
          if (all.indexOf(id) === -1) all.push(id);
        });
      });
      return all;
    }
    for (var i = 0; i < cities.length; i++) {
      if (cities[i].id === cityId) return cities[i].routes || [];
    }
    return [];
  }

  function findCityForRoute(routeId) {
    var regions = Object.keys(placeTree);
    for (var r = 0; r < regions.length; r++) {
      var cities = getRegionCities(regions[r]);
      for (var c = 0; c < cities.length; c++) {
        if ((cities[c].routes || []).indexOf(routeId) !== -1) {
          return { region: regions[r], city: cities[c] };
        }
      }
    }
    return null;
  }
  var baseTitle = document.title;
  var sectionNav = {
    home: true,
    trips: true,
    velo: true,
    about: true,
    contact: true,
  };
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealObserver = null;
  var passports = window.ROUTE_PASSPORT || {};

  function getMeta(route) {
    var base =
      meta[route.id] || {
        transport: ["mixed"],
        transportLabel: "Маршрут",
        category: "russia",
        image: "",
        mapCenter: [55.75, 37.62],
        mapZoom: 5,
        stopCoords: {},
      };
    var passport = passports[route.id] || {};
    var merged = Object.assign({}, base);
    [
      "days",
      "distance",
      "mood",
      "tags",
      "pin",
      "pinLabel",
      "planned",
      "transport",
      "transportLabel",
    ].forEach(function (key) {
      if (passport[key] !== undefined) merged[key] = passport[key];
    });
    return merged;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatText(value) {
    var safe = escapeHtml(value);
    var pattern = /(https?:\/\/[^\s<]+|\b[a-z0-9][a-z0-9-]*\.(?:ru|com|net|org|rest)(?:\/[^\s<]*)?)/g;
    return safe.replace(pattern, function (match) {
      var url = /^https?:/.test(match) ? match : "https://" + match;
      var label = match;
      if (match.indexOf("booking.com") !== -1) label = "Букинг";
      else if (match.indexOf("avito.ru") !== -1) label = "Авито";
      else if (match.indexOf("telegra.ph") !== -1) label = "Телеграф";
      else if (match.indexOf("citiapartments.ru") !== -1) label = "Эрмитаж Мансард";
      else if (match.indexOf("ladoga-ozero.ru") !== -1) label = "Ладога Озеро";
      else if (match.indexOf("torbeevo.ru") !== -1) label = "Торбеево";
      else if (match.indexOf("italyco.rest") !== -1) label = "Бист";
      else if (match.indexOf("betullahome.com") !== -1) label = "Бетулла";
      else if (match.length > 42) label = match.slice(0, 40) + "…";
      return (
        '<a href="' +
        url +
        '" target="_blank" rel="noopener noreferrer" class="text-link">' +
        escapeHtml(label) +
        "</a>"
      );
    });
  }

  function isVelo(route) {
    return getMeta(route).transport.indexOf("bike") !== -1;
  }

  function matchesFilters(route) {
    var m = getMeta(route);
    if (activeFilters.how !== "all" && m.transport.indexOf(activeFilters.how) === -1) {
      return false;
    }
    if (activeFilters.mood !== "all") {
      var mood = m.mood || [];
      if (mood.indexOf(activeFilters.mood) === -1) return false;
    }
    var allowed = getCityRoutes(activeFilters.region, activeFilters.city);
    if (!allowed.length) return m.category === activeFilters.region;
    return allowed.indexOf(route.id) !== -1;
  }

  function placeLabel(m, route) {
    var found = route ? findCityForRoute(route.id) : null;
    if (found && found.city) return found.city.label;
    var map = {
      russia: "Россия",
      asia: "Азия",
      north: "Россия",
      center: "Россия",
      velo: "Велопоездки",
    };
    return map[m.category] || m.transportLabel || "";
  }

  function passportLine(m, compact) {
    var parts = [];
    if (m.days) parts.push(m.days);
    if (m.transportLabel) parts.push(m.transportLabel.toLowerCase());
    if (!compact && m.distance) parts.push(m.distance);
    return parts.join(" · ");
  }

  function passportChips(m) {
    var line = passportLine(m, false);
    if (!line) return "";
    return '<p class="passport-line">' + escapeHtml(line) + "</p>";
  }

  function extractUrl(text) {
    var match = String(text).match(/https?:\/\/[^\s<]+/i);
    if (match) return match[0].replace(/[),.;]+$/, "");
    match = String(text).match(
      /\b([a-z0-9][a-z0-9-]*\.(?:ru|com|net|org|rest)(?:\/[^\s<]*)?)/i
    );
    if (match) return "https://" + match[1].replace(/[),.;]+$/, "");
    return "";
  }

  function stripUrl(text) {
    return String(text)
      .replace(/https?:\/\/[^\s<]+/gi, "")
      .replace(/\s+[—–-]\s*$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function renderPlaceFact(text, kind) {
    var url = extractUrl(text);
    var body = stripUrl(text);
    var title = body;
    var meta = "";
    var dash = body.split(/\s+[—–]\s+/);
    if (dash.length > 1) {
      title = dash[0].replace(/^["«]?|["»]?$/g, "").trim();
      meta = dash.slice(1).join(" — ").trim();
    }
    var icon = kind === "hotel" ? "🏨" : kind === "food" ? "🍴" : "";
    var links = "";
    if (url) {
      links =
        '<p class="place-fact__links"><a href="' +
        escapeHtml(url) +
        '" target="_blank" rel="noopener noreferrer">Ссылка</a></p>';
    }
    return (
      '<article class="place-fact place-fact--' +
      kind +
      '">' +
      '<p class="place-fact__title">' +
      (icon ? '<span class="place-fact__icon" aria-hidden="true">' + icon + "</span>" : "") +
      escapeHtml(title) +
      "</p>" +
      (meta ? '<p class="place-fact__meta">' + formatText(meta) + "</p>" : "") +
      links +
      "</article>"
    );
  }

  function renderFactList(items, kind) {
    if (!items || !items.length) return "";
    return items
      .map(function (item) {
        if (typeof item === "string") return renderPlaceFact(item, kind);
        var title = item.name || "";
        var metaParts = [];
        if (item.address) metaParts.push(item.address);
        if (item.note) metaParts.push(item.note);
        if (item.order) metaParts.push("Что брать: " + item.order);
        if (item.price) metaParts.push(item.price);
        if (item.wouldReturn === true) metaParts.push("Вернулись бы: да");
        if (item.wouldReturn === false) metaParts.push("Вернулись бы: нет");
        var links = "";
        if (item.url) {
          links =
            '<p class="place-fact__links"><a href="' +
            escapeHtml(item.url) +
            '" target="_blank" rel="noopener noreferrer">Ссылка</a></p>';
        }
        var pick = item.pick
          ? '<span class="place-fact__pick">Наш выбор</span>'
          : "";
        var icon = kind === "hotel" ? "🏨" : kind === "food" ? "🍴" : "";
        return (
          '<article class="place-fact place-fact--' +
          kind +
          '">' +
          '<p class="place-fact__title">' +
          (icon ? '<span class="place-fact__icon" aria-hidden="true">' + icon + "</span>" : "") +
          escapeHtml(title) +
          pick +
          "</p>" +
          (metaParts.length
            ? '<p class="place-fact__meta">' + escapeHtml(metaParts.join(" · ")) + "</p>"
            : "") +
          links +
          "</article>"
        );
      })
      .join("");
  }

  function renderStopBlock(title, html, tone) {
    if (!html) return "";
    return (
      '<div class="stop-block stop-block--' +
      tone +
      '">' +
      "<h4>" +
      title +
      "</h4>" +
      html +
      "</div>"
    );
  }

  function renderBulletList(items) {
    if (!items || !items.length) return "";
    return (
      "<ul>" +
      items
        .map(function (i) {
          var text = typeof i === "string" ? i : i.name || i.text || "";
          return "<li>" + formatText(text) + "</li>";
        })
        .join("") +
      "</ul>"
    );
  }

  function getStopGroups(stop) {
    if (
      stop.sights ||
      stop.food ||
      stop.hotels ||
      stop.road ||
      stop.verdict ||
      stop.charter
    ) {
      return {
        structured: true,
        sights: stop.sights || [],
        food: stop.food || [],
        hotels: stop.hotels || [],
        charter: stop.charter || [],
        logistics: stop.road
          ? [
              typeof stop.road === "string"
                ? stop.road
                : [stop.road.from && stop.road.to ? stop.road.from + " → " + stop.road.to : "", stop.road.km, stop.road.time]
                    .filter(Boolean)
                    .join(" · "),
            ]
          : [],
        verdict: stop.verdict || null,
      };
    }
    var groups = { sights: [], hotels: [], food: [], charter: [], logistics: [], verdict: null };
    (stop.activities || []).forEach(function (item) {
      groups[categorize(item)].push(item);
    });
    if (stop.verdict) groups.verdict = stop.verdict;
    return groups;
  }

  function getStopCoords(routeMeta, stopName) {
    var coords = routeMeta.stopCoords || {};
    if (coords[stopName]) return coords[stopName];
    var aliases = {
      "Коломна (район)": "Коломна (район Петербурга)",
      Петербург: "Санкт-Петербург",
      "Санкт-Петербург": "Петербург",
      "Гремучий ключ": "Гремячий ключ",
      "Гремячий ключ": "Гремучий ключ",
    };
    var key = aliases[stopName];
    if (key && coords[key]) return coords[key];
    var lower = String(stopName || "").toLowerCase();
    for (var name in coords) {
      if (Object.prototype.hasOwnProperty.call(coords, name) && name.toLowerCase() === lower) {
        return coords[name];
      }
    }
    return null;
  }

  function getStopIndex(route, stopName) {
    for (var i = 0; i < route.stops.length; i++) {
      if (route.stops[i].name === stopName) return i;
    }
    var aliases = {
      "Санкт-Петербург": "Петербург",
      Петербург: "Санкт-Петербург",
    };
    var alt = aliases[stopName];
    if (alt) {
      for (var j = 0; j < route.stops.length; j++) {
        if (route.stops[j].name === alt) return j;
      }
    }
    return -1;
  }

  function createNumberedIcon(number, active) {
    var cls = "route-marker" + (active ? " route-marker--active" : "");
    return window.L.divIcon({
      className: cls,
      html:
        '<span class="route-marker__bubble"><span class="route-marker__num">' +
        number +
        "</span></span>",
      iconSize: [34, 42],
      iconAnchor: [17, 42],
      popupAnchor: [0, -40],
    });
  }

  function mapMaxZoomForBounds(bounds) {
    if (!bounds || !bounds.isValid || !bounds.isValid()) return 11;
    var ne = bounds.getNorthEast();
    var sw = bounds.getSouthWest();
    var span = Math.max(Math.abs(ne.lat - sw.lat), Math.abs(ne.lng - sw.lng));
    if (span < 0.03) return 15;
    if (span < 0.08) return 14;
    if (span < 0.25) return 13;
    if (span < 1) return 11;
    if (span < 4) return 9;
    if (span < 12) return 7;
    return 6;
  }

  function fitMapToPoints(map, L, points) {
    if (!points || !points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 12, { animate: false });
      return;
    }
    var bounds = L.latLngBounds(points);
    map.fitBounds(bounds, {
      padding: [48, 48],
      maxZoom: mapMaxZoomForBounds(bounds),
      animate: false,
    });
  }

  function renderMediaImage(imageUrl, className, altText, eager, imageWidth) {
    if (!imageUrl) {
      return '<div class="' + className + ' ' + className + '--empty"></div>';
    }
    var optimized = getOptimizedImage(imageUrl, imageWidth || 600);
    return (
      '<div class="' +
      className +
      '"><img src="' +
      escapeHtml(optimized) +
      '" alt="' +
      escapeHtml(altText || "") +
      '" loading="' +
      (eager ? "eager" : "lazy") +
      '" decoding="async"></div>'
    );
  }

  function renderPathCompact(path, limit) {
    if (!path || !path.length) return "";
    limit = limit || 5;
    if (path.length <= limit) return renderPath(path);
    var head = path.slice(0, 2);
    var tail = path.slice(-1);
    return (
      renderPath(head) +
      '<span class="path-ellipsis">…</span>' +
      renderPath(tail)
    );
  }

  function uniquePathPlaces(path) {
    var seen = {};
    var out = [];
    (path || []).forEach(function (place) {
      if (!place || seen[place]) return;
      seen[place] = true;
      out.push(place);
    });
    return out;
  }

  function pathNumberForStop(route, stopName) {
    var places = uniquePathPlaces(route.path);
    for (var i = 0; i < places.length; i++) {
      if (places[i] === stopName) return i + 1;
      if (
        (stopName === "Петербург" && places[i] === "Санкт-Петербург") ||
        (stopName === "Санкт-Петербург" && places[i] === "Петербург")
      ) {
        return i + 1;
      }
    }
    return -1;
  }

  function renderMapLegend(route, meta) {
    var places = uniquePathPlaces(route.path);
    if (!places.length) return "";
    var items = places
      .map(function (place, index) {
        var coords = getStopCoords(meta, place);
        if (!coords) return "";
        var stopIndex = getStopIndex(route, place);
        if (stopIndex < 0) return "";
        return (
          '<button type="button" class="map-legend__item" data-route-id="' +
          route.id +
          '" data-stop-index="' +
          stopIndex +
          '">' +
          '<span class="map-legend__num">' +
          (index + 1) +
          "</span>" +
          '<span class="map-legend__label">' +
          escapeHtml(place) +
          "</span></button>"
        );
      })
      .filter(Boolean)
      .join("");
    if (!items) return "";
    return '<div class="map-legend">' + items + "</div>";
  }

  // Order matters: lodging before sights («Усадьба…» = жильё), food starts early.
  // Avoid \\b — it does not work with Cyrillic in non-unicode ES5 regex.
  function categorize(text) {
    var t = text.toLowerCase();
    var end = "(?=[\\s,.:;«»\"()—\\-]|$)";
    if (/^(ужин|обед|завтрак|кофейн|кафе|ресторан|пивовар|рамен-бар|коктейльн)/.test(t)) {
      return "food";
    }
    if (
      /отель|апартам|коттедж|баз[аы] «|база отдыха|жиль|гостин|гостев|кварти|палатк|ночуем|ночёв|ночев|глэмпинг|кемпинг|^дом (на|\d)|заселя|заселение/.test(
        t
      )
    ) {
      return "hotels";
    }
    if (/замок|музей|дворец|усадьба|монастыр|лавра|крепост|собор|храм/.test(t)) {
      return "sights";
    }
    if (
      /катер|яхт|чартер|парус|сплав|рафтинг|лодочн|(^|[\\s«(-])лодк|лодок|сапборд|сап-|каяк/.test(t)
    ) {
      return "charter";
    }
    if (
      new RegExp(
        "ужин|(^|[\\s:«—-])обед|завтрак|ресторан|кафе|кофе|(^|[\\s«(-])бар(ы|а|е|ом)?" +
          end +
          "|пивовар|пивн|рынок|рынк|суши|ролл|рам[эе]н|кимчи|барбекю|шашлы|морепродукт|устри|краб|кухн|пахлав|шавер|эчпочмак|хинкали|коктейл|винодельн|дегустац|панкейк|десерт|сладост|перекус"
      ).test(t)
    ) {
      return "food";
    }
    if (
      new RegExp(
        "поезд(а|е|ом|ы)?" + end + "|машин|трансфер|авто|самол|рейс|вокзал|вагон|паром|такси|прилёт|приезд|электричк|старт от|выезд"
      ).test(t)
    ) {
      return "logistics";
    }
    return "sights";
  }

  function collectByCategory(route) {
    var groups = { sights: [], hotels: [], food: [], charter: [], logistics: [] };
    route.stops.forEach(function (stop) {
      stop.activities.forEach(function (item) {
        var key = categorize(item);
        groups[key].push({ place: stop.name, text: item });
      });
    });
    return groups;
  }

  function stayLineText(item) {
    var text = item.text;
    var place = item.place || "";
    if (!place) return text;
    // City only when it clarifies a multi-stop list and is not already in the line.
    if (text.toLowerCase().indexOf(place.toLowerCase()) !== -1) return text;
    return text + " — " + place;
  }

  function renderListItems(items, withPlace) {
    if (!items.length) {
      return '<p class="info-empty">—</p>';
    }
    return (
      "<ul>" +
      items
        .map(function (item) {
          var line = withPlace ? stayLineText(item) : item.text || item;
          return "<li>" + formatText(line) + "</li>";
        })
        .join("") +
      "</ul>"
    );
  }

  function renderPath(path) {
    return path
      .map(function (place, index) {
        var arrow = index < path.length - 1 ? '<span class="path-arrow">→</span>' : "";
        return '<span class="path-stop">' + escapeHtml(place) + "</span>" + arrow;
      })
      .join("");
  }

  function routeFromTo(route) {
    if (!route.path || route.path.length < 2) return "";
    return route.path[0] + " → " + route.path[route.path.length - 1];
  }

  function routeHeadline(route) {
    return route.title || routeFromTo(route) || "Маршрут";
  }

  function getRouteSources(route) {
    if (route.sources && route.sources.length) {
      return route.sources.filter(Boolean);
    }
    return route.source ? [route.source] : [];
  }

  function getCitySources(city) {
    var urls = [];
    var seen = {};
    (city.routes || []).forEach(function (id) {
      var route = routeById[id];
      if (!route) return;
      getRouteSources(route).forEach(function (url) {
        if (!url || seen[url]) return;
        seen[url] = true;
        urls.push(url);
      });
    });
    return urls;
  }

  function renderSourceLinks(route) {
    var sources = getRouteSources(route);
    if (!sources.length) return "";
    if (sources.length === 1) {
      return (
        '<p class="route-hero__source"><a href="' +
        escapeHtml(sources[0]) +
        '" target="_blank" rel="noopener noreferrer">Читать в Telegraph →</a></p>'
      );
    }
    return (
      '<ul class="route-hero__source-list">' +
      sources
        .map(function (url, i) {
          return (
            '<li><a href="' +
            escapeHtml(url) +
            '" target="_blank" rel="noopener noreferrer">Telegraph ' +
            (i + 1) +
            " →</a></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function renderCardTelegraphLinks(sources) {
    if (!sources || !sources.length) return "";
    return (
      '<div class="card-telegraph">' +
      sources
        .map(function (url, i) {
          var label =
            sources.length === 1
              ? "Читать в Telegraph →"
              : "Telegraph " + (i + 1) + " →";
          return (
            '<a class="card-telegraph__link" href="' +
            escapeHtml(url) +
            '" target="_blank" rel="noopener noreferrer">' +
            label +
            "</a>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderAlbum(route, m) {
    var photos = (m && m.album) || route.album || [];
    if (!photos.length) return "";
    return (
      '<section class="route-album" aria-label="Фотоальбом">' +
      '<h3 class="detail-heading">Фото из поездки</h3>' +
      '<div class="route-album__grid">' +
      photos
        .map(function (src, i) {
          return (
            '<a class="route-album__item" href="' +
            escapeHtml(src) +
            '" target="_blank" rel="noopener noreferrer">' +
            '<img src="' +
            escapeHtml(src) +
            '" alt="Фото ' +
            (i + 1) +
            '" loading="lazy" decoding="async" />' +
            "</a>"
          );
        })
        .join("") +
      "</div></section>"
    );
  }

  function renderStaySummary(route) {
    var hotels = collectByCategory(route).hotels;
    if (!hotels.length) return "";
    return (
      '<section class="route-stay" aria-label="Где жить">' +
      '<h3 class="detail-heading">Где жить</h3>' +
      '<div class="route-stay__list">' +
      hotels
        .map(function (item) {
          return renderPlaceFact(stayLineText(item), "hotel");
        })
        .join("") +
      "</div></section>"
    );
  }

  function renderRouteCard(route) {
    var m = getMeta(route);
    var headline = routeHeadline(route);
    var line = passportLine(m, true);
    var plannedBadge = m.planned
      ? '<span class="route-card__badge">Скоро</span>'
      : "";
    var sources = getRouteSources(route);
    return (
      '<article class="route-card reveal' +
      (m.planned ? " route-card--planned" : "") +
      '" data-open-route="' +
      route.id +
      '" tabindex="0" role="button">' +
      renderMediaImage(m.image, "route-card__media", headline) +
      plannedBadge +
      '<div class="route-card__body">' +
      '<span class="route-card__eyebrow">' +
      escapeHtml(placeLabel(m, route)) +
      "</span>" +
      '<h3 class="route-card__title">' +
      escapeHtml(headline) +
      "</h3>" +
      (route.about
        ? '<p class="route-card__about">' + escapeHtml(route.about) + "</p>"
        : "") +
      (line ? '<p class="route-card__passport">' + escapeHtml(line) + "</p>" : "") +
      '<div class="route-card__path">' +
      renderPath(route.path) +
      "</div>" +
      renderCardTelegraphLinks(sources) +
      "</div></article>"
    );
  }

  function renderStopPanel(route, stopIndex) {
    var stop = route.stops[stopIndex];
    var groups = getStopGroups(stop);
    var dayLabel = stop.day || "День " + (stopIndex + 1);
    var roadHtml = "";
    if (groups.logistics && groups.logistics.length) {
      roadHtml =
        '<p class="stop-road">' +
        groups.logistics
          .map(function (item) {
            return formatText(typeof item === "string" ? item : item.text || "");
          })
          .join("<br>") +
        "</p>";
    }

    var verdictHtml = "";
    if (groups.verdict) {
      var v = groups.verdict;
      if (typeof v === "string") {
        verdictHtml = '<p class="stop-verdict">' + escapeHtml(v) + "</p>";
      } else {
        var bits = [];
        if (v.worth) bits.push(v.worth);
        if (v.nights) bits.push(v.nights);
        if (v.best) bits.push("Лучшее: " + v.best);
        if (v.skip) bits.push("Пропустить: " + v.skip);
        if (v.note) bits.push(v.note);
        verdictHtml = '<p class="stop-verdict">' + escapeHtml(bits.join(" · ")) + "</p>";
      }
    }

    return (
      '<section class="stop-panel">' +
      '<p class="stop-panel__day">' +
      escapeHtml(dayLabel) +
      "</p>" +
      "<h3>" +
      escapeHtml(stop.name) +
      "</h3>" +
      renderStopBlock("Дорога", roadHtml, "road") +
      renderStopBlock("Что посмотреть", renderBulletList(groups.sights), "see") +
      renderStopBlock("Где поесть", renderFactList(groups.food, "food"), "food") +
      renderStopBlock("Где жить", renderFactList(groups.hotels, "hotel"), "stay") +
      renderStopBlock("Вода и катера", renderBulletList(groups.charter), "water") +
      renderStopBlock("Наше мнение", verdictHtml, "verdict") +
      "</section>"
    );
  }

  function setupReveal() {
    var items = document.querySelectorAll(".reveal:not(.is-visible)");
    var i;
    if (reduceMotion || typeof IntersectionObserver === "undefined") {
      for (i = 0; i < items.length; i++) items[i].classList.add("is-visible");
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
      );
    }
    for (i = 0; i < items.length; i++) revealObserver.observe(items[i]);
  }

  function renderTips(route) {
    if (!route.tips || !route.tips.length) return "";
    return (
      '<section class="tips-block" aria-label="Полезно знать">' +
      '<h3 class="detail-heading">Полезно знать</h3>' +
      "<ul>" +
      route.tips
        .map(function (tip) {
          return "<li>" + formatText(tip) + "</li>";
        })
        .join("") +
      "</ul></section>"
    );
  }

  function renderStopButtons(route, activeIndex) {
    return route.stops
      .map(function (stop, index) {
        var active = index === activeIndex ? " is-active" : "";
        var pathIndex = pathNumberForStop(route, stop.name);
        var prefix =
          pathIndex > 0
            ? '<span class="stop-btn__num">' + pathIndex + "</span>"
            : "";
        return (
          '<button type="button" class="stop-btn' +
          active +
          '" data-route-id="' +
          route.id +
          '" data-stop-index="' +
          index +
          '">' +
          prefix +
          '<span class="stop-btn__label">' +
          escapeHtml(stop.name) +
          "</span></button>"
        );
      })
      .join("");
  }

  function renderRoutePage(route) {
    var m = getMeta(route);
    var headline = routeHeadline(route);
    var line = passportLine(m, false);
    var primaryAction = m.planned
      ? '<a class="btn btn--primary" href="https://t.me/arion_96" target="_blank" rel="noopener noreferrer">Написать — когда поедем</a>'
      : "";
    return (
      '<section class="route-page" id="route-' +
      route.id +
      '" data-route-page="' +
      route.id +
      '">' +
      '<div class="container">' +
      '<button type="button" class="btn btn--ghost back-btn" data-back-home>← Маршруты</button>' +
      '<header class="route-hero route-hero--dry">' +
      renderMediaImage(m.image, "route-hero__media", headline, false, 1200) +
      '<div class="route-hero__content">' +
      '<p class="route-hero__eyebrow">' +
      escapeHtml(placeLabel(m, route)) +
      "</p>" +
      "<h2>" +
      escapeHtml(headline) +
      "</h2>" +
      (route.about
        ? '<p class="route-hero__about">' + escapeHtml(route.about) + "</p>"
        : "") +
      renderSourceLinks(route) +
      (line ? '<p class="passport-line">' + escapeHtml(line) + "</p>" : "") +
      '<div class="route-hero__path">' +
      renderPath(route.path) +
      "</div>" +
      (primaryAction
        ? '<div class="route-hero__actions">' +
          primaryAction +
          '<a class="btn btn--ghost" href="https://t.me/arion_96" target="_blank" rel="noopener noreferrer">Написать нам</a>' +
          "</div>"
        : '<div class="route-hero__actions"><a class="btn btn--ghost" href="https://t.me/arion_96" target="_blank" rel="noopener noreferrer">Написать нам</a></div>') +
      '</div></header>' +
      '<div class="route-city-blocks">' +
      renderAlbum(route, m) +
      renderStaySummary(route) +
      "</div>" +
      '<div class="route-layout">' +
      '<div class="route-map-wrap">' +
      '<p class="map-label">Карта маршрута</p>' +
      '<div class="route-map" id="map-' +
      route.id +
      '"></div>' +
      renderMapLegend(route, m) +
      "</div>" +
      '<div class="route-detail">' +
      '<h3 class="detail-heading">Дни</h3>' +
      '<div class="stop-nav" data-stop-nav="' +
      route.id +
      '">' +
      renderStopButtons(route, 0) +
      "</div>" +
      '<div class="stop-content" data-stop-content="' +
      route.id +
      '">' +
      renderStopPanel(route, 0) +
      "</div>" +
      '</div></div>' +
      renderTips(route) +
      "</div></section>"
    );
  }

  function initMap(route) {
    return loadLeaflet().then(function (L) {
      var el = document.getElementById("map-" + route.id);
      if (!el || maps[route.id]) return;

      var m = getMeta(route);
      var map = L.map(el, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      }).setView(m.mapCenter || [55.75, 37.62], m.mapZoom || 6);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      map.on("focus", function () {
        map.scrollWheelZoom.enable();
      });
      map.on("blur", function () {
        map.scrollWheelZoom.disable();
      });
      el.addEventListener(
        "mouseenter",
        function () {
          map.scrollWheelZoom.enable();
        },
        { passive: true }
      );
      el.addEventListener(
        "mouseleave",
        function () {
          map.scrollWheelZoom.disable();
        },
        { passive: true }
      );

      var markers = [];
      var pathLine = [];
      var allPoints = [];
      var path = route.path || [];
      var marked = {};
      var markerNum = 0;

      path.forEach(function (placeName) {
        var coords = getStopCoords(m, placeName);
        if (!coords) return;
        pathLine.push(coords);
        allPoints.push(coords);
        if (marked[placeName]) return;
        marked[placeName] = true;
        markerNum += 1;
        var stopIndex = getStopIndex(route, placeName);
        var number = markerNum;
        var marker = L.marker(coords, {
          icon: createNumberedIcon(number),
          zIndexOffset: 500 + number,
          keyboard: true,
          title: placeName,
        })
          .addTo(map)
          .bindPopup(
            "<strong>" +
              number +
              ". " +
              escapeHtml(placeName) +
              "</strong>"
          );
        marker._stopIndex = stopIndex >= 0 ? stopIndex : number - 1;
        marker._pathIndex = number - 1;
        marker._isPath = true;
        marker.on("click", function () {
          if (marker._stopIndex >= 0) selectStop(route.id, marker._stopIndex);
        });
        markers.push(marker);
      });

      route.stops.forEach(function (stop, stopIndex) {
        if (marked[stop.name] || path.indexOf(stop.name) !== -1) return;
        var coords = getStopCoords(m, stop.name);
        if (!coords) return;
        allPoints.push(coords);
        var marker = L.circleMarker(coords, {
          radius: 7,
          color: "#14584f",
          weight: 2,
          fillColor: "#ffffff",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup("<strong>" + escapeHtml(stop.name) + "</strong>");
        marker._stopIndex = stopIndex;
        marker._isPath = false;
        marker.on("click", function () {
          selectStop(route.id, stopIndex);
        });
        markers.push(marker);
      });

      if (pathLine.length > 1) {
        L.polyline(pathLine, {
          color: "#1a7568",
          weight: 8,
          opacity: 0.12,
          lineJoin: "round",
          lineCap: "round",
          interactive: false,
        }).addTo(map);
        L.polyline(pathLine, {
          color: "#1a7568",
          weight: 3.5,
          opacity: 0.95,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(map);
      }

      fitMapToPoints(map, L, allPoints.length ? allPoints : pathLine);

      maps[route.id] = { map: map, markers: markers };
      window.setTimeout(function () {
        map.invalidateSize(false);
        fitMapToPoints(map, L, allPoints.length ? allPoints : pathLine);
      }, 120);
      window.setTimeout(function () {
        map.invalidateSize(false);
      }, 450);
    });
  }

  function setMarkerActive(entry, stopIndex) {
    entry.markers.forEach(function (marker) {
      if (!marker._isPath) {
        if (typeof marker.setStyle === "function") {
          marker.setStyle({
            radius: marker._stopIndex === stopIndex ? 9 : 7,
            fillColor: marker._stopIndex === stopIndex ? "#1a7568" : "#ffffff",
            color: "#14584f",
          });
        }
        return;
      }
      var el = typeof marker.getElement === "function" ? marker.getElement() : null;
      var active = marker._stopIndex === stopIndex;
      if (el) {
        el.classList.toggle("route-marker--active", active);
      } else if (typeof marker.setIcon === "function") {
        marker.setIcon(createNumberedIcon(marker._pathIndex + 1, active));
      }
    });
  }

  function highlightMapStop(routeId, stopIndex) {
    var entry = maps[routeId];
    if (!entry) return;
    setMarkerActive(entry, stopIndex);
    entry.markers.forEach(function (marker) {
      if (marker._stopIndex === stopIndex) {
        marker.openPopup();
        var zoom = Math.max(entry.map.getZoom(), 9);
        if (typeof entry.map.flyTo === "function" && !reduceMotion) {
          entry.map.flyTo(marker.getLatLng(), Math.min(zoom, 12), { duration: 0.55 });
        } else {
          entry.map.panTo(marker.getLatLng(), {
            animate: !reduceMotion,
            duration: 0.45,
          });
        }
      }
    });
  }

  function setActiveNav(id) {
    var highlight = id === "home" ? "trips" : id;
    for (var i = 0; i < navLinks.length; i++) {
      var link = navLinks[i];
      var navId = link.getAttribute("data-nav");
      if (!navId) continue;
      link.classList.toggle("is-active", navId === highlight || navId === id);
    }
  }

  function renderCityCard(city) {
    var firstId = (city.routes || [])[0];
    var route = firstId ? routeById[firstId] : null;
    var m = route ? getMeta(route) : {};
    var img = m.image || "";
    var sources = getCitySources(city);
    return (
      '<article class="route-card city-card reveal" data-open-city="' +
      escapeHtml(city.id) +
      '" tabindex="0" role="button">' +
      renderMediaImage(img, "route-card__media", city.label) +
      '<div class="route-card__body">' +
      '<span class="route-card__eyebrow">' +
      escapeHtml((placeTree[activeFilters.region] && placeTree[activeFilters.region].label) || "") +
      "</span>" +
      '<h3 class="route-card__title">' +
      escapeHtml(city.label) +
      "</h3>" +
      (route && route.about
        ? '<p class="route-card__about">' + escapeHtml(route.about) + "</p>"
        : "") +
      renderCardTelegraphLinks(sources) +
      "</div></article>"
    );
  }

  function renderGrid() {
    if (!routeGrid) return;
    if (activeFilters.city === "all") {
      var cities = getRegionCities(activeFilters.region);
      routeGrid.innerHTML = cities.length
        ? cities.map(renderCityCard).join("")
        : '<p class="empty-state">Пока нет городов в этом разделе.</p>';
      setupReveal();
      return;
    }
    var filtered = routes.filter(function (route) {
      return !isVelo(route) && matchesFilters(route);
    });
    routeGrid.innerHTML = filtered.length
      ? filtered.map(renderRouteCard).join("")
      : '<p class="empty-state">В этом городе пока нет карточек.</p>';
    setupReveal();
  }

  function renderVeloGrid() {
    if (!veloGrid) return;
    var velo = routes.filter(isVelo);
    veloGrid.innerHTML = velo.map(renderRouteCard).join("");
    setupReveal();
  }

  function disposeMapsExcept(keepId) {
    Object.keys(maps).forEach(function (mapId) {
      if (keepId && mapId === keepId) return;
      if (maps[mapId] && maps[mapId].map) {
        maps[mapId].map.remove();
      }
      delete maps[mapId];
    });
  }

  function findRouteById(id) {
    for (var i = 0; i < routes.length; i++) {
      if (routes[i].id === id) return routes[i];
    }
    return null;
  }

  function showHome(sectionId) {
    homeView.hidden = false;
    var pages = routePages.querySelectorAll(".route-page");
    for (var i = 0; i < pages.length; i++) {
      pages[i].classList.remove("is-active");
    }
    disposeMapsExcept(null);
    setActiveNav(sectionId || "home");
    document.title = baseTitle;
    var nextHash = sectionId && sectionId !== "home" ? "#" + sectionId : "";
    if (window.location.hash !== nextHash) {
      history.replaceState(null, "", window.location.pathname + nextHash);
    }
    if (!sectionId || sectionId === "home") {
      window.scrollTo(0, 0);
    }
  }

  function showRoute(id) {
    var route = findRouteById(id);
    if (!route) {
      showHome();
      return;
    }
    homeView.hidden = true;
    var pages = routePages.querySelectorAll(".route-page");
    for (var i = 0; i < pages.length; i++) {
      pages[i].classList.toggle("is-active", pages[i].getAttribute("data-route-page") === id);
    }
    setActiveNav(id);
    document.title = route.title + " · " + baseTitle;
    if (window.location.hash.replace("#", "") !== id) {
      window.location.hash = id;
    }
    disposeMapsExcept(id);
    initMap(route).then(function () {
      window.setTimeout(function () {
        var entry = maps[route.id];
        if (entry) entry.map.invalidateSize();
      }, 400);
    });
    window.scrollTo(0, 0);
  }

  function scrollToId(id) {
    var header = document.querySelector(".site-header");
    var offset = header ? header.offsetHeight + 8 : 72;
    window.requestAnimationFrame(function () {
      window.setTimeout(function () {
        var el = document.getElementById(id);
        if (!el) return;
        var top = el.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({
          top: Math.max(0, top),
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }, 40);
    });
  }

  function navigateTo(target) {
    if (target === "home") {
      showHome("trips");
      window.scrollTo(0, 0);
      return;
    }
    if (target === "about") target = "contact";
    if (target === "trips" || sectionNav[target]) {
      showHome(target === "trips" ? "trips" : target);
      scrollToId(target === "trips" ? "trips" : target);
      return;
    }
    showRoute(target);
  }

  function selectStop(routeId, stopIndex) {
    var route = findRouteById(routeId);
    if (!route || !route.stops[stopIndex]) return;

    var nav = document.querySelector('[data-stop-nav="' + routeId + '"]');
    var content = document.querySelector('[data-stop-content="' + routeId + '"]');
    if (!nav || !content) return;

    var buttons = nav.querySelectorAll(".stop-btn");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-active", i === stopIndex);
    }
    content.innerHTML = renderStopPanel(route, stopIndex);
    highlightMapStop(routeId, stopIndex);

    var legendItems = document.querySelectorAll(
      '.map-legend__item[data-route-id="' + routeId + '"]'
    );
    for (var j = 0; j < legendItems.length; j++) {
      legendItems[j].classList.toggle(
        "is-active",
        Number(legendItems[j].getAttribute("data-stop-index")) === stopIndex
      );
    }
  }

  function openCity(cityId) {
    var cities = getRegionCities(activeFilters.region);
    var city = null;
    for (var i = 0; i < cities.length; i++) {
      if (cities[i].id === cityId) {
        city = cities[i];
        break;
      }
    }
    if (!city) return;
    activeFilters.city = cityId;
    buildFilters();
    var ids = city.routes || [];
    if (ids.length === 1 && routeById[ids[0]]) {
      showRoute(ids[0]);
      return;
    }
    renderGrid();
  }

  function filterSummary() {
    var region = regionLabel(activeFilters.region) || "Регион";
    var cityLabel = "Все города";
    if (activeFilters.city !== "all") {
      var cities = getRegionCities(activeFilters.region);
      for (var i = 0; i < cities.length; i++) {
        if (cities[i].id === activeFilters.city) {
          cityLabel = cities[i].label;
          break;
        }
      }
    }
    return region + " · " + cityLabel;
  }

  function isFilterPanelOpen() {
    return !!(filterBar && filterBar.classList.contains("is-open"));
  }

  function setFilterPanelOpen(open) {
    if (!filterBar) return;
    if (open) filterStep = "region";
    filterBar.classList.toggle("is-open", open);
    document.body.classList.toggle("filters-open", open);
    var btn = filterBar.querySelector("[data-toggle-filters]");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    var backdrop = filterBar.querySelector(".filter-backdrop");
    if (backdrop) backdrop.hidden = !open;
    if (open) buildFilters();
  }

  function buildFilters() {
    if (!filterBar) return;
    var keepOpen = isFilterPanelOpen();
    var regionKeys = ["russia", "asia"];
    var regionChips = regionKeys
      .map(function (key) {
        if (!placeTree[key]) return "";
        var active = activeFilters.region === key ? " is-active" : "";
        return (
          '<button type="button" class="filter-chip filter-chip--region' +
          active +
          '" data-set-region="' +
          key +
          '">' +
          escapeHtml(regionLabel(key)) +
          "</button>"
        );
      })
      .join("");

    var cities = getRegionCities(activeFilters.region);
    var cityChips =
      '<button type="button" class="filter-chip' +
      (activeFilters.city === "all" ? " is-active" : "") +
      '" data-set-city="all">Все города</button>' +
      cities
        .map(function (city) {
          var active = activeFilters.city === city.id ? " is-active" : "";
          return (
            '<button type="button" class="filter-chip' +
            active +
            '" data-set-city="' +
            city.id +
            '">' +
            escapeHtml(city.label) +
            "</button>"
          );
        })
        .join("");

    var stepClass =
      "filter-panel filter-panel--step-" + (filterStep === "cities" ? "cities" : "region");
    var panelTitle = filterStep === "cities" ? regionLabel(activeFilters.region) : "Меню";
    var backBtn =
      filterStep === "cities"
        ? '<button type="button" class="filter-panel__back" data-filter-back aria-label="Назад в меню">←</button>'
        : "";

    filterBar.innerHTML =
      '<button type="button" class="filter-menu-btn" data-toggle-filters aria-expanded="' +
      (keepOpen ? "true" : "false") +
      '" aria-controls="filter-panel">' +
      '<span class="filter-menu-btn__icon" aria-hidden="true">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none">' +
      '<path d="M4 7h12M4 12h16M4 17h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
      '<circle cx="19" cy="7" r="1.6" fill="currentColor"/>' +
      '<circle cx="8" cy="12" r="1.6" fill="currentColor"/>' +
      '<circle cx="17" cy="17" r="1.6" fill="currentColor"/>' +
      "</svg></span>" +
      '<span class="filter-menu-btn__text">' +
      '<span class="filter-menu-btn__eyebrow">Меню</span>' +
      '<span class="filter-menu-btn__value">' +
      escapeHtml(filterSummary()) +
      "</span></span></button>" +
      '<div class="filter-backdrop" data-close-filters' +
      (keepOpen ? "" : " hidden") +
      "></div>" +
      '<div class="' +
      stepClass +
      '" id="filter-panel" data-filter-panel>' +
      '<div class="filter-panel__head">' +
      backBtn +
      '<p class="filter-panel__title">' +
      escapeHtml(panelTitle) +
      "</p>" +
      '<button type="button" class="filter-panel__close" data-close-filters aria-label="Закрыть">×</button>' +
      "</div>" +
      '<div class="filter-panel__nav" aria-label="Разделы">' +
      '<a href="#trips" class="filter-panel__nav-link" data-nav="trips" data-close-filters>Маршруты</a>' +
      '<a href="#velo" class="filter-panel__nav-link" data-nav="velo" data-close-filters>Велопоездки</a>' +
      '<a href="#contact" class="filter-panel__nav-link" data-nav="contact" data-close-filters>Контакты</a>' +
      '<a href="https://t.me/arion_96" class="filter-panel__nav-link" target="_blank" rel="noopener noreferrer">Написать нам</a>' +
      "</div>" +
      '<div class="filter-panel__filters">' +
      '<p class="filter-row__label">Фильтры</p>' +
      '<div class="filter-row filter-row--regions"><div class="filter-row__chips">' +
      regionChips +
      '</div></div><div class="filter-row filter-row--cities"><span class="filter-row__label">Города</span><div class="filter-row__chips">' +
      cityChips +
      "</div></div>" +
      '<button type="button" class="btn btn--primary filter-panel__done" data-close-filters>Показать</button>' +
      "</div></div>";

    if (keepOpen) {
      filterBar.classList.add("is-open");
      document.body.classList.add("filters-open");
    }
  }

  function init() {
    buildFilters();
    renderGrid();
    renderVeloGrid();
    routePages.innerHTML = routes.map(renderRoutePage).join("");

    document.body.addEventListener("click", function (event) {
      var toggleFilters = event.target.closest("[data-toggle-filters]");
      if (toggleFilters) {
        setFilterPanelOpen(!isFilterPanelOpen());
        return;
      }

      var filterBack = event.target.closest("[data-filter-back]");
      if (filterBack) {
        filterStep = "region";
        buildFilters();
        return;
      }

      var closeFilters = event.target.closest("[data-close-filters]");
      if (closeFilters) {
        var navId = closeFilters.getAttribute("data-nav");
        setFilterPanelOpen(false);
        if (navId) {
          event.preventDefault();
          navigateTo(navId);
        }
        return;
      }

      if (event.target.closest("a[href]")) return;

      var regionBtn = event.target.closest("[data-set-region]");
      if (regionBtn) {
        activeFilters.region = regionBtn.getAttribute("data-set-region");
        activeFilters.city = "all";
        filterStep = "cities";
        buildFilters();
        renderGrid();
        return;
      }

      var cityBtn = event.target.closest("[data-set-city]");
      if (cityBtn) {
        var cityId = cityBtn.getAttribute("data-set-city");
        if (cityId === "all") {
          activeFilters.city = "all";
          buildFilters();
          renderGrid();
          setFilterPanelOpen(false);
          return;
        }
        setFilterPanelOpen(false);
        openCity(cityId);
        return;
      }

      var cityCard = event.target.closest("[data-open-city]");
      if (cityCard) {
        openCity(cityCard.getAttribute("data-open-city"));
        return;
      }

      var openRoute = event.target.closest("[data-open-route]");
      if (openRoute) {
        showRoute(openRoute.getAttribute("data-open-route"));
        return;
      }

      if (event.target.closest("[data-back-home]")) {
        showHome("trips");
        return;
      }

      var stopBtn = event.target.closest(".stop-btn");
      if (stopBtn) {
        selectStop(
          stopBtn.getAttribute("data-route-id"),
          Number(stopBtn.getAttribute("data-stop-index"))
        );
        return;
      }

      var legendBtn = event.target.closest(".map-legend__item");
      if (legendBtn) {
        var legendIndex = Number(legendBtn.getAttribute("data-stop-index"));
        if (legendIndex >= 0) {
          selectStop(
            legendBtn.getAttribute("data-route-id"),
            legendIndex
          );
        }
        return;
      }

      var navBtn = event.target.closest("[data-nav]");
      if (navBtn) {
        if (navBtn.closest(".site-nav")) return;
        navigateTo(navBtn.getAttribute("data-nav"));
      }
    });

    document.body.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isFilterPanelOpen()) {
        setFilterPanelOpen(false);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("a[href], button, input, textarea, select")) return;
      var cityCard = event.target.closest("[data-open-city]");
      if (cityCard) {
        event.preventDefault();
        openCity(cityCard.getAttribute("data-open-city"));
        return;
      }
      var openRoute = event.target.closest("[data-open-route]");
      if (openRoute) {
        event.preventDefault();
        showRoute(openRoute.getAttribute("data-open-route"));
      }
    });

    var siteNav = document.querySelector(".site-nav");
    if (siteNav) {
      siteNav.addEventListener("click", function (e) {
        if (e.target.closest("a[href^='https://t.me']")) return;
        var link = e.target.closest("[data-nav]");
        if (!link) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        var target = link.getAttribute("data-nav");
        navigateTo(target);
        // hash already set inside showHome; avoid fighting scroll
      });
    }

    function openFromHash() {
      var hash = window.location.hash.replace("#", "");
      var known = routes.some(function (route) {
        return route.id === hash;
      });
      if (known) {
        showRoute(hash);
        return;
      }
      if (!hash || hash === "home" || hash === "trips") {
        showHome("trips");
        return;
      }
      var section = sectionNav[hash] && document.getElementById(hash);
      if (section) {
        showHome(hash);
        scrollToId(hash);
        return;
      }
      showHome("trips");
    }

    var header = document.querySelector(".site-header");
    if (header) {
      var onScroll = function () {
        header.classList.toggle("is-scrolled", window.pageYOffset > 8);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    window.addEventListener("hashchange", openFromHash);
    openFromHash();
    setupReveal();
  }

  init();
})();
