#!/usr/bin/env node
// Shared run notes: node notes.mjs init ["contract text"] | append "<line>" | read
// File is .office/notes.md in the cwd; .office/ is self-ignoring (contains its own .gitignore).
import fs from "node:fs";

const dir = ".office", file = `${dir}/notes.md`;
const [cmd, ...rest] = process.argv.slice(2);
const line = rest.join(" ").replace(/\s+/g, " ").trim();

if (cmd === "init") {
  fs.mkdirSync(`${dir}/handoff`, { recursive: true });
  fs.writeFileSync(`${dir}/.gitignore`, "*\n");
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# Run notes\n\n## Contracts\n${line || "(none yet)"}\n\n## Findings\n`);
} else if (cmd === "append" && line) {
  if (!fs.existsSync(file)) fs.mkdirSync(dir, { recursive: true }), fs.writeFileSync(file, "## Findings\n");
  fs.appendFileSync(file, `- ${new Date().toISOString().slice(0, 16)}Z ${line.slice(0, 300)}\n`);
} else if (cmd === "read") {
  process.stdout.write(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
} else {
  console.error("usage: notes.mjs init [contract] | append <line> | read");
  process.exit(2);
}
