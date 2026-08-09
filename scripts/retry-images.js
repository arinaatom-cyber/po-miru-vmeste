/* Retry remaining Wikimedia URLs with delay; fallback to Unsplash if still failing */
var fs = require("fs");
var path = require("path");
var https = require("https");
var http = require("http");

var root = path.join(__dirname, "..");
var metaPath = path.join(root, "meta.js");
var outDir = path.join(root, "images");
var src = fs.readFileSync(metaPath, "utf8");

var fallbacks = [
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1280&q=80",
  "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1280&q=80",
  "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1280&q=80",
  "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?w=1280&q=80",
  "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1280&q=80",
  "https://images.unsplash.com/photo-1501785888041-af3ee95b5b63?w=1280&q=80",
  "https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?w=1280&q=80",
  "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?w=1280&q=80",
  "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=1280&q=80",
  "https://images.unsplash.com/photo-1517760444937-f6397edcbbcd?w=1280&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1280&q=80",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1280&q=80",
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1280&q=80",
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1280&q=80",
];

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function download(url, dest) {
  return new Promise(function (resolve, reject) {
    var mod = url.indexOf("https") === 0 ? https : http;
    var file = fs.createWriteStream(dest);
    var req = mod.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; po-miru-vmeste/1.0; +https://arinaatom-cyber.github.io/po-miru-vmeste/)",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: "https://commons.wikimedia.org/",
        },
      },
      function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(dest, function () {});
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, function () {});
          return reject(new Error(String(res.statusCode)));
        }
        res.pipe(file);
        file.on("finish", function () {
          file.close(resolve);
        });
      }
    );
    req.on("error", reject);
  });
}

function extFromUrl(url) {
  var e = path.extname(url.split("?")[0]).toLowerCase();
  if (e === ".jpg" || e === ".jpeg" || e === ".png" || e === ".webp") return e;
  return ".jpg";
}

(async function () {
  var re = /(image:\s*\n\s*")([^"]+)(")/g;
  var matches = [];
  var m;
  while ((m = re.exec(src))) {
    matches.push({ full: m[0], prefix: m[1], url: m[2], suffix: m[3], index: m.index });
  }

  var next = src;
  var fb = 0;
  for (var i = 0; i < matches.length; i++) {
    var item = matches[i];
    if (item.url.indexOf("images/") === 0) {
      console.log("skip local", item.url);
      continue;
    }
    var name = "route-" + (i + 1) + extFromUrl(item.url);
    var dest = path.join(outDir, name);
    var fetchUrl = item.url.replace(/\/\d+px-/g, "/800px-");
    var ok = false;
    for (var attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt) await sleep(2500 * attempt);
      try {
        process.stdout.write("retry " + name + " a" + (attempt + 1) + " ... ");
        await download(fetchUrl, dest);
        console.log("ok");
        ok = true;
      } catch (err) {
        console.log("fail " + err.message);
      }
    }
    if (!ok) {
      var fbUrl = fallbacks[fb % fallbacks.length];
      fb++;
      name = "route-" + (i + 1) + "-fb.jpg";
      dest = path.join(outDir, name);
      process.stdout.write("fallback " + name + " ... ");
      await download(fbUrl, dest);
      console.log("ok");
    }
    next = next.split(item.url).join("images/" + name);
    await sleep(800);
  }
  fs.writeFileSync(metaPath, next);
  console.log("done");
})();
