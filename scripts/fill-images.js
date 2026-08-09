var fs = require("fs");
var path = require("path");
var https = require("https");

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
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1280&q=80",
  "https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=1280&q=80",
];

function download(url, dest) {
  return new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, function (res) {
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
      })
      .on("error", reject);
  });
}

(async function () {
  var re = /"(https:\/\/upload\.wikimedia\.org[^"]+|https:\/\/images\.unsplash\.com[^"]+)"/g;
  var urls = [];
  var m;
  while ((m = re.exec(src))) urls.push(m[1]);
  urls = urls.filter(function (u, i, a) {
    return a.indexOf(u) === i;
  });

  var next = src;
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];
    var name = "fill-" + (i + 1) + ".jpg";
    var dest = path.join(outDir, name);
    var srcUrl = url.indexOf("unsplash") !== -1 ? url : fallbacks[i % fallbacks.length];
    try {
      process.stdout.write(name + " ... ");
      await download(srcUrl, dest);
      console.log("ok");
      next = next.split(url).join("images/" + name);
    } catch (e) {
      console.log("fail", e.message);
      // last resort: reuse an existing local file
      next = next.split(url).join("images/route-1.jpg");
    }
  }

  // also mirror hero if still remote in css/html - handled separately
  fs.writeFileSync(metaPath, next);
  console.log("meta updated, remaining wiki:", (next.match(/upload\.wikimedia/g) || []).length);
})();
