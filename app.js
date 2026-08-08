(function () {
  var allRoutes = window.ROUTES || [];
  var meta = window.ROUTE_META || {};
  var hiddenIds = {
    "spb-karelia": true,
    "spb-city": true,
    "turkey-ny-holidays": true,
    "pack-essentials": true,
    "yachtsmen": true,
  };
  var routes = allRoutes.filter(function (r) {
    return !hiddenIds[r.id];
  });

  var homeView = document.getElementById("home-view");
  var routePages = document.getElementById("route-pages");
  var routeGrid = document.getElementById("route-grid");
  var veloGrid = document.getElementById("velo-grid");
  var stayGrid = document.getElementById("stay-grid");
  var filterBar = document.getElementById("filter-bar");
  var navLinks = document.querySelectorAll("[data-nav]");
  var maps = {};
  var activeFilter = "all";
  var baseTitle = document.title;
  var sectionNav = { velo: true, stay: true, contact: true };
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealObserver = null;

  function getMeta(route) {
    return (
      meta[route.id] || {
        transport: ["mixed"],
        transportLabel: "Маршрут",
        category: "russia",
        image: "",
        mapCenter: [55.75, 37.62],
        mapZoom: 5,
        stopCoords: {},
      }
    );
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
    var pattern = /(https?:\/\/[^\s<]+|\b[a-z0-9][a-z0-9-]*\.(?:ru|com|net|org)(?:\/[^\s<]*)?)/g;
    return safe.replace(pattern, function (match) {
      var url = /^https?:/.test(match) ? match : "https://" + match;
      var label = match;
      if (match.indexOf("booking.com") !== -1) label = "Booking";
      else if (match.indexOf("telegra.ph") !== -1) label = "Telegraph";
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

  function matchesFilter(route, filter) {
    if (filter === "all") return true;
    var m = getMeta(route);
    if (filter === "turkey" || filter === "russia" || filter === "asia") {
      return m.category === filter;
    }
    return m.transport.indexOf(filter) !== -1;
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
    return L.divIcon({
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

  function renderMediaImage(imageUrl, className, altText, eager) {
    if (!imageUrl) {
      return '<div class="' + className + ' ' + className + '--empty"></div>';
    }
    return (
      '<div class="' +
      className +
      '"><img src="' +
      escapeHtml(imageUrl) +
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

  function categorize(text) {
    var t = text.toLowerCase();
    if (/^если дождь|^запасной план/.test(t)) return "sights";
    if (/^(ужин|обед|завтрак|бранч|кофейн)/.test(t)) return "food";
    if (/замок|музей|дворец|усадьба|монастыр|лавра/.test(t)) return "sights";
    if (/^заселение/.test(t)) return "logistics";
    if (/отель|hotel|апартам|коттедж|баз[аы] «|жиль|гостин|гостев|кварти|booking|hermitage mansard|hostel|палатк|ночёв|ночев|глэмпинг|^дом \d|дом на берегу|кемпинг/.test(t)) {
      return "hotels";
    }
    if (/катер|яхт|charter|чартер|парус|сплав|raft|лодк|sup|каяк/.test(t)) {
      return "charter";
    }
    if (
      /ужин|(^|[\s:«—-])обед|завтрак|ресторан|кафе|кофе|бар|пивовар|рынок|рынк|суши|ролл|рам[эе]н|кимчи|bbq|шашлык|морепродукт|устри|кухн|куш|пахлав|шавух|эчпочмак|krab|крабовая станция|bist|betulla|zuma|gusto|chin chin|чин чин|animals|moloko|supra|coffetory|kafema|koryo|boroda|morskoy|ussuriyskaya|tokyo kawaii|korean house|asiatiq|консерватор|mansarda|«на дне»|огонёк|port cafe|порт кафе|фурукава|ганс/.test(
        t
      )
    ) {
      return "food";
    }
    if (/поезд|машин|трансфер|авто|самол|рейс|вокзал|вагон|паром|такси|прилёт|приезд|прокат маш|сдача маш/.test(t)) {
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

  function renderListItems(items, withPlace) {
    if (!items.length) {
      return '<p class="info-empty">—</p>';
    }
    return (
      "<ul>" +
      items
        .map(function (item) {
          var prefix = withPlace
            ? '<span class="info-place">' + escapeHtml(item.place) + ":</span> "
            : "";
          return "<li>" + prefix + formatText(item.text) + "</li>";
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
    var fromTo = routeFromTo(route);
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
      '<div class="route-card__body">' +
      plannedBadge +
      '<span class="route-card__transport">' +
      escapeHtml(m.transportLabel) +
      "</span>" +
      (fromTo
        ? '<span class="route-card__fromto">' + escapeHtml(fromTo) + "</span>"
        : "") +
      '<span class="route-card__region">' +
      escapeHtml(route.region) +
      "</span>" +
      '<h3 class="route-card__title">' +
      escapeHtml(route.title) +
      "</h3>" +
      '<p class="route-card__about">' +
      escapeHtml(route.about) +
      "</p>" +
      '<div class="route-card__path">' +
      renderPathCompact(route.path, 5) +
      "</div>" +
      '<span class="route-card__cta">Смотреть маршрут</span>' +
      "</div></button>"
    );
  }

  function renderStopPanel(route, stopIndex) {
    var stop = route.stops[stopIndex];
    var groups = { sights: [], hotels: [], food: [], charter: [], logistics: [] };
    stop.activities.forEach(function (item) {
      groups[categorize(item)].push(item);
    });

    function block(title, items) {
      if (!items.length) return "";
      return (
        '<div class="stop-block">' +
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
      block("Что посмотреть", groups.sights) +
      block("Жильё и отели", groups.hotels) +
      block("Заведения", groups.food) +
      block("Транспорт и чартеры", groups.charter) +
      block("Логистика", groups.logistics) +
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
    var groups = collectByCategory(route);
    var cards = "";
    if (groups.hotels.length) {
      cards +=
        '<aside class="info-card">' +
        "<h4>Где остановиться</h4>" +
        renderListItems(groups.hotels, true) +
        "</aside>";
    }
    if (groups.food.length) {
      cards +=
        '<aside class="info-card">' +
        "<h4>Куда сходить</h4>" +
        renderListItems(groups.food, true) +
        "</aside>";
    }
    if (!cards) return "";
    return '<div class="reco-grid">' + cards + "</div>";
  }

  function renderStayDirectory() {
    if (!stayGrid) return;
    var cards = routes
      .map(function (route) {
        var hotels = collectByCategory(route).hotels;
        if (!hotels.length) return "";
        return (
          '<article class="info-card stay-card reveal">' +
          '<p class="stay-card__region">' +
          escapeHtml(route.region) +
          "</p>" +
          '<h3 class="stay-card__title">' +
          escapeHtml(route.title) +
          "</h3>" +
          renderListItems(hotels, true) +
          '<button type="button" class="stay-card__link" data-open-route="' +
          route.id +
          '">Маршрут целиком</button>' +
          "</article>"
        );
      })
      .filter(Boolean)
      .join("");
    stayGrid.innerHTML = cards
      ? cards
      : '<p class="empty-state">Данные по жилью появятся позже.</p>';
    setupReveal();
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
        '" target="_blank" rel="noopener noreferrer" class="text-link">Исходник в Telegraph</a></p>'
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
      renderMediaImage(m.image, "route-hero__media", route.title, true) +
      '<div class="route-hero__content">' +
      '<p class="route-hero__eyebrow">' +
      escapeHtml(route.region) +
      " · " +
      escapeHtml(m.transportLabel) +
      "</p>" +
      "<h2>" +
      escapeHtml(route.title) +
      "</h2>" +
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
      '<a class="btn btn--ghost" href="#contact">Telegram</a>' +
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
      renderRecommendations(route) +
      renderTips(route) +
      "</div></div></div></section>"
    );
  }

  function initMap(route) {
    if (typeof L === "undefined") return;
    var el = document.getElementById("map-" + route.id);
    if (!el || maps[route.id]) return;

    var m = getMeta(route);
    var map = L.map(el, {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView(m.mapCenter, m.mapZoom);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
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
      markers.push(marker);
    });

    if (pathLine.length > 1) {
      L.polyline(pathLine, {
        color: "#1a7568",
        weight: 4,
        opacity: 0.88,
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
        entry.map.panTo(marker.getLatLng(), { animate: true, duration: 0.45 });
      }
    });
  }

  function setActiveNav(id) {
    for (var i = 0; i < navLinks.length; i++) {
      var link = navLinks[i];
      var navId = link.getAttribute("data-nav");
      link.classList.toggle("is-active", navId === id || (id === "home" && navId === "home"));
    }
  }

  function renderGrid() {
    var filtered = routes.filter(function (route) {
      return !isVelo(route) && matchesFilter(route, activeFilter);
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

  function showHome() {
    homeView.hidden = false;
    var pages = routePages.querySelectorAll(".route-page");
    for (var i = 0; i < pages.length; i++) {
      pages[i].classList.remove("is-active");
    }
    setActiveNav("home");
    document.title = baseTitle;
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname);
    }
    window.scrollTo(0, 0);
  }

  function showRoute(id) {
    var route = routes.find(function (r) {
      return r.id === id;
    });
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
    initMap(route);
    window.setTimeout(function () {
      var entry = maps[route.id];
      if (entry) entry.map.invalidateSize();
    }, 400);
    window.scrollTo(0, 0);
  }

  function selectStop(routeId, stopIndex) {
    var route = routes.find(function (item) {
      return item.id === routeId;
    });
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

  function buildFilters() {
    var filters = ["all", "turkey", "russia", "asia", "car", "yacht", "train", "plane"];
    filterBar.innerHTML = filters
      .map(function (key) {
        var active = key === activeFilter ? " is-active" : "";
        return (
          '<button type="button" class="filter-chip' +
          active +
          '" data-filter="' +
          key +
          '">' +
          escapeHtml(window.FILTER_LABELS[key] || key) +
          "</button>"
        );
      })
      .join("");
  }

  function init() {
    buildFilters();
    renderGrid();
    renderVeloGrid();
    renderStayDirectory();
    routePages.innerHTML = routes.map(renderRoutePage).join("");

    document.body.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-filter]");
      if (chip) {
        activeFilter = chip.getAttribute("data-filter");
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
        showHome();
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
        var target = navBtn.getAttribute("data-nav");
        if (target === "home") showHome();
        else if (sectionNav[target]) {
          showHome();
          setActiveNav(target);
          var section = document.getElementById(target);
          if (section) section.scrollIntoView({ behavior: "smooth" });
        } else showRoute(target);
      }
    });

    function openFromHash() {
      var hash = window.location.hash.replace("#", "");
      var known = routes.some(function (route) {
        return route.id === hash;
      });
      if (known) showRoute(hash);
      else if (!hash) showHome();
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
