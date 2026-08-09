/* Download route images into ./images and rewrite meta.js paths */
var fs = require("fs");
var path = require("path");
var https = require("https");
var http = require("http");

var root = path.join(__dirname, "..");
var metaPath = path.join(root, "meta.js");
var outDir = path.join(root, "images");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

var src = fs.readFileSync(metaPath, "utf8");
var urlRe = /https?:\/\/[^\s"']+/g;
var urls = [];
var m;
while ((m = urlRe.exec(src))) {
  if (/upload\.wikimedia\.org|images\.unsplash\.com/.test(m[0])) {
    urls.push(m[0].replace(/[),.;]+$/, ""));
  }
}
urls = urls.filter(function (u, i, a) {
  return a.indexOf(u) === i;
});

function extFromUrl(url) {
  var clean = url.split("?")[0];
  var e = path.extname(clean).toLowerCase();
  if (e === ".jpg" || e === ".jpeg" || e === ".png" || e === ".webp") return e;
  return ".jpg";
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
            "po-miru-vmeste-local-mirror/1.0 (personal travel site; offline mirror)",
          Accept: "image/*,*/*",
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
          return reject(new Error(url + " -> " + res.statusCode));
        }
        res.pipe(file);
        file.on("finish", function () {
          file.close(resolve);
        });
      }
    );
    req.on("error", function (err) {
      file.close();
      fs.unlink(dest, function () {});
      reject(err);
    });
  });
}

(async function () {
  var map = {};
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];
    var name = "route-" + (i + 1) + extFromUrl(url);
    // Prefer 1280px for wiki thumbs to keep repo smaller
    var fetchUrl = url.replace(/\/\d+px-/g, "/1280px-");
    if (fetchUrl.indexOf("unsplash.com") !== -1) {
      fetchUrl = fetchUrl.replace(/w=\d+/, "w=1280");
    }
    var dest = path.join(outDir, name);
    process.stdout.write("GET " + name + " ... ");
    try {
      await download(fetchUrl, dest);
      map[url] = "images/" + name;
      console.log("ok");
    } catch (err) {
      console.log("FAIL " + err.message);
      // keep original url if download fails
      map[url] = url;
    }
  }

  var next = src;
  Object.keys(map).forEach(function (from) {
    next = next.split(from).join(map[from]);
  });
  fs.writeFileSync(metaPath, next);
  console.log("Updated meta.js with", Object.keys(map).length, "paths");
})();
