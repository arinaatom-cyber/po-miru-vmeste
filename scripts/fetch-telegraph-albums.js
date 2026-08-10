/**
 * Download a few photos from Telegraph pages into images/albums/{routeId}/
 * and write album paths into meta.js via a sidecar JSON for easy merge.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "images", "albums");
const mapPath = path.join(root, "scripts", "album-map.json");

const ROUTES = [
  { id: "karelia-yacht", urls: ["https://telegra.ph/YAHTSMENY-V-DELE-07-20"] },
  { id: "turkey-istanbul", urls: ["https://telegra.ph/Poezdka-v-Novogodnie-prazdniki-12-27"] },
  { id: "turkey-cappadocia", urls: ["https://telegra.ph/Turciya-2026-06-13"] },
  { id: "new-new-year", urls: ["https://telegra.ph/Novyj-Novyj-God-11-17"] },
  { id: "hainan-china", urls: ["https://telegra.ph/More-more-Kitajskoe-09-08"] },
  { id: "sergiev-posad", urls: ["https://telegra.ph/Sergiev-Posad-03-18"] },
  {
    id: "vladivostok",
    urls: [
      "https://telegra.ph/VLADIVOSTOK-08-04-3",
      "https://telegra.ph/Vladivostok-03-18-2",
    ],
  },
  { id: "karelia", urls: ["https://telegra.ph/SPB---Kareliya-2-sezd-po-pidorski-06-08"] },
  { id: "sakhalin", urls: ["https://telegra.ph/SAHALIN-03-10"] },
  { id: "spb-city", urls: ["https://telegra.ph/Sankt-Peterburg-07-28-3"] },
];

const MAX_PER_ROUTE = 4;
const UA =
  "SoulTripsBot/1.0 (personal travel album mirror; github.com/arinaatom-cyber/po-miru-vmeste)";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      { headers: { "User-Agent": UA, Accept: "text/html,*/*" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fetchText(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode + " " + url));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("error", reject);
  });
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchBinary(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("HTTP " + res.statusCode + " " + url));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
  });
}

function extractImages(html) {
  const urls = [];
  const re = /(?:src|data-src)=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1];
    if (!u) continue;
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/file/")) u = "https://telegra.ph" + u;
    u = u.replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(u)) continue;
    if (!/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u) && u.indexOf("telegra.ph/file/") === -1) {
      continue;
    }
    if (u.indexOf("favicon") !== -1 || u.indexOf("emoji") !== -1) continue;
    if (urls.indexOf(u) === -1) urls.push(u);
  }
  // Telegraph API-style figure images often in og:image too
  const og = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (og && og[1] && urls.indexOf(og[1]) === -1) urls.unshift(og[1]);
  return urls;
}

function extFromUrl(url) {
  const clean = url.split("?")[0];
  const m = clean.match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? "." + m[1].toLowerCase().replace("jpeg", "jpg") : ".jpg";
}

async function processRoute(route) {
  const dir = path.join(outDir, route.id);
  fs.mkdirSync(dir, { recursive: true });
  const collected = [];
  for (const pageUrl of route.urls) {
    try {
      const html = await fetchText(pageUrl);
      const imgs = extractImages(html);
      console.log(route.id, pageUrl, "images:", imgs.length);
      for (const img of imgs) {
        if (collected.length >= MAX_PER_ROUTE) break;
        if (collected.indexOf(img) !== -1) continue;
        collected.push(img);
      }
    } catch (e) {
      console.warn("fail page", pageUrl, e.message);
    }
    if (collected.length >= MAX_PER_ROUTE) break;
  }

  const saved = [];
  for (let i = 0; i < collected.length; i++) {
    const url = collected[i];
    const file = "photo-" + (i + 1) + extFromUrl(url);
    const dest = path.join(dir, file);
    try {
      const buf = await fetchBinary(url);
      if (buf.length < 2000) {
        console.warn("skip tiny", url, buf.length);
        continue;
      }
      fs.writeFileSync(dest, buf);
      saved.push("images/albums/" + route.id + "/" + file);
      console.log("  saved", file, buf.length);
    } catch (e) {
      console.warn("  fail img", url, e.message);
    }
  }
  return saved;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const map = {};
  for (const route of ROUTES) {
    map[route.id] = await processRoute(route);
  }
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2), "utf8");
  console.log("Wrote", mapPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
