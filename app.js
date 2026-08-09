(function () {
  // Оптимизация картинок Wikimedia: меняем оригинал на 600px для скорости
  function getOptimizedImage(url, width) {
    width = width || 600;
    if (!url || url.indexOf("wikipedia/commons") === -1) return url;
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
    "spb-city": true,
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
  var worldMap = null;
  var activeFilters = { place: "all", how: "all", mood: "all" };
  var baseTitle = document.title;
  var sectionNav = {
    home: true,
    trips: true,
    "map-world": true,
    velo: true,
    about: true,
    picks: true,
  };
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealObserver = null;
  var passports = window.ROUTE_PASSPORT || {};
  var topPicks = window.TOP_PICKS || [];

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
    return Object.assign({}, base, passport);
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
    if (activeFilters.place !== "all" && m.category !== activeFilters.place) {
      return false;
    }
    if (activeFilters.how !== "all" && m.transport.indexOf(activeFilters.how) === -1) {
      return false;
    }
    if (activeFilters.mood !== "all") {
      var mood = m.mood || [];
      if (mood.indexOf(activeFilters.mood) === -1) return false;
    }
    return true;
  }

  function passportChips(m) {
    var chips = [];
    if (m.days) chips.push(m.days);
    if (m.transportLabel) chips.push(m.transportLabel);
    if (m.distance) chips.push(m.distance);
    if (m.season) chips.push(m.season);
    if (m.tags && m.tags.length) {
      m.tags.slice(0, 2).forEach(function (t) {
        if (chips.indexOf(t) === -1) chips.push(t);
      });
    }
    if (!chips.length) return "";
    return (
      '<ul class="passport-tags">' +
      chips
        .slice(0, 5)
        .map(function (c) {
          return '<li class="passport-tags__item">' + escapeHtml(c) + "</li>";
        })
        .join("") +
      "</ul>"
    );
  }

  function getStopCoords(routeMeta, stopName) {
    var coords = routeMeta.stopCoords || {};
    if (coords[stopName]) return coords[stopName];
    var aliases = {
      "Коломна (район)": "Коломна (район Петербурга)",
    };
    var key = aliases[stopName];
    return key && coords[key] ? coords[key] : null;
  }

  function getStopIndex(route, stopName) {
    for (var i = 0; i < route.stops.length; i++) {
      if (route.stops[i].name === stopName) return i;
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

  function renderMapLegend(route, meta) {
    if (!route.path || !route.path.length) return "";
    var items = route.path
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

  function renderRouteCard(route) {
    var m = getMeta(route);
    var plannedBadge = m.planned
      ? '<span class="route-card__badge">Скоро</span>'
      : "";
    return (
      '<button type="button" class="route-card reveal' +
      (m.planned ? " route-card--planned" : "") +
      '" data-open-route="' +
      route.id +
      '">' +
      renderMediaImage(m.image, "route-card__media", route.title) +
      plannedBadge +
      '<div class="route-card__body">' +
      '<span class="route-card__eyebrow">' +
      escapeHtml(route.region) +
      "</span>" +
      '<h3 class="route-card__title">' +
      escapeHtml(route.title) +
      "</h3>" +
      passportChips(m) +
      '<p class="route-card__about">' +
      escapeHtml(route.about) +
      "</p>" +
      '<div class="route-card__path">' +
      renderPathCompact(route.path, 5) +
      "</div>" +
      "</div></button>"
    );
  }

  function renderStopPanel(route, stopIndex) {
    var stop = route.stops[stopIndex];
    var groups = { sights: [], hotels: [], food: [], charter: [], logistics: [] };
    stop.activities.forEach(function (item) {
      groups[categorize(item)].push(item);
    });

    function block(title, items, tone) {
      if (!items.length) return "";
      return (
        '<div class="stop-block stop-block--' +
        tone +
        '">' +
        "<h4>" +
        title +
        "</h4><ul>" +
        items.map(function (i) {
          return "<li>" + formatText(i) + "</li>";
        }).join("") +
        "</ul></div>"
      );
    }

    return (
      '<section class="stop-panel">' +
      "<h3>" +
      escapeHtml(stop.name) +
      "</h3>" +
      block("Что посмотреть", groups.sights, "see") +
      block("Где остановиться", groups.hotels, "stay") +
      block("Кафе и рестораны", groups.food, "food") +
      block("Вода и катера", groups.charter, "water") +
      block("Дорога", groups.logistics, "road") +
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

  function renderRecommendations(route) {
    // Жильё не дублируем отдельным блоком — оно уже внутри городов (stops).
    var groups = collectByCategory(route);
    var cards = "";
    var sets = [
      { key: "food", title: "Кафе и рестораны", tone: "food" },
      { key: "sights", title: "Музеи и места", tone: "see" },
    ];
    sets.forEach(function (set) {
      if (!groups[set.key].length) return;
      cards +=
        '<aside class="info-card info-card--' +
        set.tone +
        '">' +
        "<h4>" +
        set.title +
        "</h4>" +
        renderListItems(groups[set.key], true) +
        "</aside>";
    });
    if (!cards) return "";
    return (
      '<div class="reco-block">' +
      '<h3 class="detail-heading">Что мы советуем на этом маршруте</h3>' +
      '<div class="reco-grid">' +
      cards +
      "</div></div>"
    );
  }

  function renderStopButtons(route, activeIndex) {
    return route.stops
      .map(function (stop, index) {
        var active = index === activeIndex ? " is-active" : "";
        var pathIndex = route.path ? route.path.indexOf(stop.name) : -1;
        var prefix =
          pathIndex >= 0
            ? '<span class="stop-btn__num">' + (pathIndex + 1) + "</span>"
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

  function renderTips(route) {
    if (!route.tips || !route.tips.length) return "";
    var items = route.tips
      .map(function (tip) {
        return "<li>" + formatText(tip) + "</li>";
      })
      .join("");
    return (
      '<aside class="tips-block">' +
      "<h4>Рекомендации</h4>" +
      "<ul>" +
      items +
      "</ul></aside>"
    );
  }

  function renderRoutePage(route) {
    var m = getMeta(route);
    var primaryAction = m.planned
      ? '<a class="btn btn--primary" href="https://t.me/arion_96" target="_blank" rel="noopener noreferrer">Написать — когда поедем</a>'
      : "";
    var sourceLink = route.source
      ? '<p class="route-hero__source"><a href="' +
        escapeHtml(route.source) +
        '" target="_blank" rel="noopener noreferrer" class="text-link">Исходник в Телеграфе</a></p>'
      : "";
    return (
      '<section class="route-page" id="route-' +
      route.id +
      '" data-route-page="' +
      route.id +
      '">' +
      '<div class="container">' +
      '<button type="button" class="btn btn--ghost back-btn" data-back-home>← Все маршруты</button>' +
      '<header class="route-hero">' +
      renderMediaImage(m.image, "route-hero__media", route.title, false, 1200) +
      '<div class="route-hero__content">' +
      '<p class="route-hero__eyebrow">' +
      escapeHtml(route.region) +
      " · " +
      escapeHtml(m.transportLabel) +
      "</p>" +
      "<h2>" +
      escapeHtml(route.title) +
      "</h2>" +
      passportChips(m) +
      '<p class="route-hero__about">' +
      escapeHtml(route.about) +
      "</p>" +
      sourceLink +
      (routeFromTo(route)
        ? '<p class="route-hero__fromto">' + escapeHtml(routeFromTo(route)) + "</p>"
        : "") +
      '<div class="route-hero__path">' +
      renderPath(route.path) +
      "</div>" +
      '<div class="route-hero__actions">' +
      primaryAction +
      '<button type="button" class="btn btn--ghost" data-nav="about">Написать нам</button>' +
      "</div></div></header>" +
      '<div class="route-layout">' +
      '<div class="route-map-wrap">' +
      '<p class="map-label">Карта маршрута</p>' +
      '<div class="route-map" id="map-' +
      route.id +
      '"></div>' +
      renderMapLegend(route, m) +
      "</div>" +
      '<div class="route-detail">' +
      '<h3 class="detail-heading">Точки маршрута</h3>' +
      '<p class="route-hint">Выберите город — на карте подсветится точка и маршрут</p>' +
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
      "</div></div>" +
      renderRecommendations(route) +
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
      }).setView(m.mapCenter, m.mapZoom);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      var markers = [];
      var pathLine = [];
      var path = route.path || [];

      path.forEach(function (placeName, pathIndex) {
        var coords = getStopCoords(m, placeName);
        if (!coords) return;
        pathLine.push(coords);
        var stopIndex = getStopIndex(route, placeName);
        var marker = L.marker(coords, {
          icon: createNumberedIcon(pathIndex + 1),
          zIndexOffset: 500 + pathIndex,
        })
          .addTo(map)
          .bindPopup(
            "<strong>" +
              (pathIndex + 1) +
              ". " +
              escapeHtml(placeName) +
              "</strong>"
          );
        marker._stopIndex = stopIndex >= 0 ? stopIndex : pathIndex;
        marker._pathIndex = pathIndex;
        marker._isPath = true;
        markers.push(marker);
      });

      route.stops.forEach(function (stop, stopIndex) {
        if (path.indexOf(stop.name) !== -1) return;
        var coords = getStopCoords(m, stop.name);
        if (!coords) return;
        var marker = L.circleMarker(coords, {
          radius: 6,
          color: "#14201c",
          weight: 2,
          fillColor: "#ffffff",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup("<strong>" + escapeHtml(stop.name) + "</strong>");
        marker._stopIndex = stopIndex;
        marker._isPath = false;
        markers.push(marker);
      });

      if (pathLine.length > 1) {
        L.polyline(pathLine, {
          color: "#1a7568",
          weight: 3,
          opacity: 0.9,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(map);
        map.fitBounds(L.latLngBounds(pathLine), {
          padding: [40, 40],
          maxZoom: Math.min(m.mapZoom + 3, 12),
        });
      } else if (pathLine.length === 1) {
        map.setView(pathLine[0], Math.min(m.mapZoom + 2, 12));
      }

      maps[route.id] = { map: map, markers: markers };
      window.setTimeout(function () {
        map.invalidateSize();
      }, 250);
    });
  }

  function setMarkerActive(entry, stopIndex) {
    entry.markers.forEach(function (marker) {
      if (!marker._isPath) return;
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
        entry.map.panTo(marker.getLatLng(), {
          animate: !reduceMotion,
          duration: 0.45,
        });
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

  function renderGrid() {
    var filtered = routes.filter(function (route) {
      return !isVelo(route) && matchesFilters(route);
    });
    routeGrid.innerHTML = filtered.length
      ? filtered.map(renderRouteCard).join("")
      : '<p class="empty-state">По этому фильтру маршрутов нет.</p>';
    setupReveal();
  }

  function renderVeloGrid() {
    if (!veloGrid) return;
    var velo = routes.filter(isVelo);
    veloGrid.innerHTML = velo.map(renderRouteCard).join("");
    setupReveal();
  }

  function renderPicks() {
    var grid = document.getElementById("picks-grid");
    if (!grid || !topPicks.length) return;
    grid.innerHTML = topPicks
      .map(function (pick) {
        var route = findRouteById(pick.id);
        if (!route) return "";
        var m = getMeta(route);
        return (
          '<button type="button" class="pick-card reveal" data-open-route="' +
          route.id +
          '">' +
          '<span class="pick-card__label">' +
          escapeHtml(pick.label) +
          "</span>" +
          '<h3 class="pick-card__title">' +
          escapeHtml(route.title) +
          "</h3>" +
          '<p class="pick-card__reason">' +
          escapeHtml(pick.reason) +
          "</p>" +
          passportChips(m) +
          "</button>"
        );
      })
      .join("");
    setupReveal();
  }

  function initWorldMap() {
    var el = document.getElementById("world-map");
    if (!el || worldMap) return;
    loadLeaflet().then(function (L) {
      if (worldMap) return;
      worldMap = L.map(el, {
        scrollWheelZoom: false,
        worldCopyJump: true,
      }).setView([40, 60], 2);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(worldMap);

      var bounds = [];
      routes.forEach(function (route) {
        if (isVelo(route)) return;
        var m = getMeta(route);
        var pin = m.pin || m.mapCenter;
        if (!pin) return;
        bounds.push(pin);
        L.circleMarker(pin, {
          radius: 8,
          color: "#1a7568",
          weight: 2,
          fillColor: "#1a7568",
          fillOpacity: 0.85,
        })
          .addTo(worldMap)
          .bindPopup(
            "<strong>" +
              escapeHtml(m.pinLabel || route.title) +
              '</strong><br><button type="button" class="text-link" data-open-route="' +
              route.id +
              '">Открыть маршрут</button>'
          );
      });

      if (bounds.length > 1) {
        worldMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 4 });
      }
      window.setTimeout(function () {
        worldMap.invalidateSize();
      }, 200);
    });
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

  function navigateTo(target) {
    if (target === "home") {
      showHome("trips");
      window.scrollTo(0, 0);
      return;
    }
    if (target === "trips") {
      showHome("trips");
      var tripsEl = document.getElementById("trips");
      if (tripsEl) {
        tripsEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      }
      return;
    }
    if (sectionNav[target]) {
      showHome(target);
      var section = document.getElementById(target);
      if (section) section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      if (target === "map-world") initWorldMap();
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

  function buildFilterRow(axis, keys, label) {
    return (
      '<div class="filter-row">' +
      '<span class="filter-row__label">' +
      escapeHtml(label) +
      "</span>" +
      '<div class="filter-row__chips">' +
      keys
        .map(function (key) {
          var active = activeFilters[axis] === key ? " is-active" : "";
          return (
            '<button type="button" class="filter-chip' +
            active +
            '" data-filter-axis="' +
            axis +
            '" data-filter="' +
            key +
            '">' +
            escapeHtml(window.FILTER_LABELS[key] || key) +
            "</button>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function buildFilters() {
    if (!filterBar) return;
    filterBar.innerHTML =
      buildFilterRow("place", ["all", "turkey", "russia", "asia"], "Куда") +
      buildFilterRow("how", ["all", "car", "plane", "train", "yacht"], "Как") +
      buildFilterRow(
        "mood",
        ["all", "sea", "nature", "city", "active", "food", "weekend"],
        "Что"
      );
  }

  function init() {
    buildFilters();
    renderGrid();
    renderVeloGrid();
    renderPicks();
    routePages.innerHTML = routes.map(renderRoutePage).join("");

    document.body.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-filter-axis]");
      if (chip) {
        activeFilters[chip.getAttribute("data-filter-axis")] = chip.getAttribute("data-filter");
        buildFilters();
        renderGrid();
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
        if (target === "home" || sectionNav[target]) {
          history.pushState(null, "", "#" + (target === "home" ? "trips" : target));
        }
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
        section.scrollIntoView();
        if (hash === "map-world") initWorldMap();
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

    var mapSection = document.getElementById("map-world");
    if (mapSection && typeof IntersectionObserver !== "undefined") {
      var mapObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              initWorldMap();
              mapObserver.disconnect();
            }
          });
        },
        { rootMargin: "120px" }
      );
      mapObserver.observe(mapSection);
    }

    window.addEventListener("hashchange", openFromHash);
    openFromHash();
    setupReveal();
  }

  init();
})();
