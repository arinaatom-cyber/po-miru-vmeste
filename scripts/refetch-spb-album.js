/**
 * Re-fetch SPB album from Telegraph, skipping tickets and promo banners.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const root = path.join(__dirname, "..");
const dir = path.join(root, "images", "albums", "spb-city");
const pageUrl = "https://telegra.ph/Sankt-Peterburg-07-28-3";
const UA = "SoulTripsBot/1.0";

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(res.headers.location).then(resolve, reject);
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
          resolve(Buffer.concat(chunks));
        });
      })
      .on("error", reject);
  });
}

function extractImages(html) {
  const urls = [];
  const re = /src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1];
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/file/")) u = "https://telegra.ph" + u;
    if (u.indexOf("telegra.ph/file/") === -1) continue;
    if (urls.indexOf(u) === -1) urls.push(u);
  }
  return urls;
}

function looksLikeUi(buf) {
  // Small PNG screenshots (tickets)
  if (buf.length < 120000) return true;
  // Huge PNGs with promo overlays from websites tend to be multi-MB; prefer jpg/mid
  return false;
}

async function main() {
  const html = (await get(pageUrl)).toString("utf8");
  const urls = extractImages(html);
  console.log("found", urls.length);

  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));

  const candidates = [];
  for (let i = 0; i < urls.length; i++) {
    const buf = await get(urls[i]);
    const skipTicket = buf.length < 120000;
    // Skip known promo banner (training boats with text overlay) ~4MB
    const skipBanner = buf.length > 3500000;
    console.log(i + 1, buf.length, skipTicket ? "ticket" : skipBanner ? "banner" : "ok", urls[i]);
    if (skipTicket || skipBanner) continue;
    candidates.push({ url: urls[i], buf });
  }

  // Prefer variety: take up to 3, prefer jpg and mid-size
  candidates.sort((a, b) => {
    const aj = a.url.match(/\.jpe?g$/i) ? 0 : 1;
    const bj = b.url.match(/\.jpe?g$/i) ? 0 : 1;
    if (aj !== bj) return aj - bj;
    return a.buf.length - b.buf.length;
  });

  const saved = [];
  for (let i = 0; i < candidates.length && saved.length < 3; i++) {
    const c = candidates[i];
    const ext = c.url.match(/\.png$/i) ? ".png" : ".jpg";
    const file = "photo-" + (saved.length + 1) + ext;
    fs.writeFileSync(path.join(dir, file), c.buf);
    saved.push("images/albums/spb-city/" + file);
    console.log("kept", file, c.buf.length);
  }

  const mapPath = path.join(__dirname, "album-map.json");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  map["spb-city"] = saved;
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2));

  let meta = fs.readFileSync(path.join(root, "meta.js"), "utf8");
  meta = meta.replace(
    /("spb-city":\s*\{[\s\S]*?album:\s*)\[[^\]]*\]/,
    "$1" + JSON.stringify(saved)
  );
  fs.writeFileSync(path.join(root, "meta.js"), meta);
  console.log("done", saved);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
