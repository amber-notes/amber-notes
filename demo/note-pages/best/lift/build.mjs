// Builds the single-file app.html from src/: the styles, then the modules in order.
import fs from "node:fs";
const dir = new URL("./src/", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, dir), "utf8");
const js = ["exercises.js", "core.js", "live.js", "screens.js", "app.js"].map((f) => `// ---- ${f}\n` + read(f)).join("\n");
const out = read("head.html").replace("/*STYLE*/", () => read("style.css")).replace("/*SCRIPT*/", () => js);
fs.writeFileSync(new URL("./app.html", import.meta.url), out);
console.log("app.html", (Buffer.byteLength(out) / 1024).toFixed(1), "KB");
