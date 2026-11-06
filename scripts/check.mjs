import {readdir, readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
async function walk(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(path);
    else if (path.endsWith(".mjs")) {
      const result = spawnSync(process.execPath, ["--check", path], {encoding: "utf8"});
      if (result.status) { process.stderr.write(result.stderr); process.exitCode = 1; }
    } else if (path.endsWith(".json")) JSON.parse(await readFile(path, "utf8"));
  }
}
await walk(".");
if (!process.exitCode) console.log("JavaScript syntax and JSON checks passed.");
