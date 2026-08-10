const fs = require("fs");
const path = require("path");

const map = JSON.parse(fs.readFileSync(path.join(__dirname, "album-map.json"), "utf8"));
const cleaned = {};

Object.keys(map).forEach(function (id) {
  cleaned[id] = map[id]
    .filter(function (f) {
      try {
        return fs.statSync(path.join(__dirname, "..", f)).size >= 40000;
      } catch (e) {
        return false;
      }
    })
    .slice(0, 3);
});

fs.writeFileSync(
  path.join(__dirname, "album-map.json"),
  JSON.stringify(cleaned, null, 2)
);

let meta = fs.readFileSync(path.join(__dirname, "..", "meta.js"), "utf8");

Object.keys(cleaned).forEach(function (id) {
  const files = cleaned[id];
  if (!files.length) return;
  if (new RegExp(id + "[\\s\\S]{0,400}album\\s*:").test(meta)) {
    console.log(id, "already has album");
    return;
  }
  const albumLine = "\n    album: " + JSON.stringify(files) + ",";
  const re = new RegExp(
    "((?:\"" +
      id +
      "\"|\\b" +
      id +
      "\\b)\\s*:\\s*\\{[\\s\\S]*?image:\\s*(?:\\n\\s*)?\"[^\"]+\",)"
  );
  if (!re.test(meta)) {
    console.log(id, "FAIL match");
    return;
  }
  meta = meta.replace(re, function (m) {
    return m + albumLine;
  });
  console.log(id, "ok", files.length);
});

fs.writeFileSync(path.join(__dirname, "..", "meta.js"), meta);
console.log("meta.js updated");
