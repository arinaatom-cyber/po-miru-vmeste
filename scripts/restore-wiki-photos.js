/**
 * Restore original Wikimedia photos via images.weserv.nl mirror into images/{id}.jpg
 */
var fs = require("fs");
var path = require("path");
var https = require("https");
var { execSync } = require("child_process");

var root = path.join(__dirname, "..");
var outDir = path.join(root, "images");
var metaPath = path.join(root, "meta.js");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

var oldMeta = execSync("git show 5dd1183:meta.js", {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

var lines = oldMeta.split(/\r?\n/);
var entries = [];
var currentId = null;
for (var i = 0; i < lines.length; i++) {
  if (lines[i].indexOf("FILTER_LABELS") !== -1) break;
  var idMatch = lines[i].match(/^\s*(?:"([a-z0-9-]+)"|([a-z0-9-]+)):\s*\{\s*$/);
  if (idMatch) {
    currentId = idMatch[1] || idMatch[2];
    continue;
  }
  if (/^\s*image:\s*$/.test(lines[i]) && lines[i + 1]) {
    var u = lines[i + 1].match(/"(https?:\/\/[^"]+)"/);
    if (u && currentId) entries.push({ id: currentId, url: u[1] });
  }
}

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function download(url, dest) {
  return new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(dest);
    var req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; po-miru-vmeste-mirror/1.0)",
          Accept: "image/*,*/*",
        },
      },
      function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch (e) {}
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch (e) {}
          return reject(new Error(String(res.statusCode)));
        }
        res.pipe(file);
        file.on("finish", function () {
          file.close(function () {
            if (fs.statSync(dest).size < 2000) reject(new Error("too small"));
            else resolve();
          });
        });
      }
    );
    req.setTimeout(90000, function () {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function mirrorUrl(original) {
  // weserv wants host/path without scheme sometimes; full encode works with url=
  var cleaned = original.replace(/\/1920px-/g, "/1280px-");
  return (
    "https://images.weserv.nl/?url=" +
    encodeURIComponent(cleaned.replace(/^https?:\/\//, "")) +
    "&w=1280&output=jpg&q=85"
  );
}

(async function () {
  console.log("entries", entries.length);
  entries.forEach(function (e) {
    console.log("-", e.id);
  });

  var mapping = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var destName = e.id + ".jpg";
    var dest = path.join(outDir, destName);

    if (e.url.indexOf("unsplash.com") !== -1) {
      mapping[e.id] = "images/hero.jpg";
      console.log(e.id, "unsplash -> hero.jpg");
      continue;
    }

    var ok = false;
    var urls = [mirrorUrl(e.url), e.url.replace(/\/1920px-/g, "/1280px-")];
    for (var u = 0; u < urls.length && !ok; u++) {
      for (var a = 1; a <= 3 && !ok; a++) {
        try {
          process.stdout.write(e.id + " src" + u + " a" + a + " ... ");
          await download(urls[u], dest);
          console.log("ok", fs.statSync(dest).size);
          ok = true;
          mapping[e.id] = "images/" + destName;
        } catch (err) {
          console.log("fail", err.message);
          await sleep(1500 * a);
        }
      }
    }
    if (!ok) console.log("FAILED", e.id);
    await sleep(800);
  }

  var meta = fs.readFileSync(metaPath, "utf8");
  Object.keys(mapping).forEach(function (id) {
    var local = mapping[id];
    var re = new RegExp(
      '("' +
        id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        '"|' +
        id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "):\\s*\\{[\\s\\S]*?image:\\s*\\n?\\s*\"([^\"]+)\""
    );
    meta = meta.replace(re, function (full) {
      return full.replace(/image:\s*\n?\s*"[^"]+"/, 'image:\n      "' + local + '"');
    });
    console.log("wired", id, "->", local);
  });
  fs.writeFileSync(metaPath, meta);
  console.log("remaining remote images:", (meta.match(/https:\/\/upload\.wikimedia|images\.unsplash|images\/fill-|images\/route-/g) || []).length);
  console.log("done");
})();
