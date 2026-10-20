/**
 * Push variables from .env up to Vercel, without pasting anything by hand.
 *
 *   node scripts/sync-env.mjs                 # show what would change
 *   node scripts/sync-env.mjs --apply         # add what is missing
 *   node scripts/sync-env.mjs --apply RESEND_API_KEY EMAIL_FROM
 *   node scripts/sync-env.mjs --apply --force # also overwrite what differs
 *
 * Two rules keep this safe to run on a live project.
 *
 * It is a dry run unless you pass --apply, because the thing it writes to is
 * production and the failure mode of a careless sync is a replaced database
 * key, not a lint error.
 *
 * It only ADDS by default. A variable already set on Vercel is left exactly as
 * it is, even when .env disagrees, because the value on Vercel is the one that
 * has been serving real traffic and the one on a laptop is the one most likely
 * to be a stale experiment. --force reverses that, deliberately and loudly.
 *
 * Values are passed to the CLI on stdin rather than with --value, so a secret
 * never lands in shell history or in the output of `ps` while the command
 * runs. Nothing here ever prints a value.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");
const envName = "production";
const only = args.filter(a => !a.startsWith("--"));

/** Names that look like credentials are stored as Secret, the rest as Config. */
const SECRET_RE = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;

function parseDotEnv(file) {
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && value) out.set(key, value);
  }
  return out;
}

function vercel(cmdArgs, input) {
  return execFileSync("npx", ["vercel", ...cmdArgs], {
    cwd: ROOT,
    input,
    encoding: "utf8",
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
}

/** Names already set on Vercel for this environment. */
function remoteNames() {
  const out = vercel(["env", "ls", "--environment", envName]);
  const names = new Set();
  for (const line of out.split("\n")) {
    // Table rows look like "  NAME   Hidden   Secret   Production   3d ago".
    const m = line.match(/^\s+([A-Z][A-Z0-9_]*)\s{2,}/);
    if (m) names.add(m[1]);
  }
  return names;
}

const local = parseDotEnv(join(ROOT, ".env"));
if (!local.size) {
  console.error("No .env found, or nothing in it.");
  process.exit(1);
}

const remote = remoteNames();
const wanted = only.length ? only.filter(n => local.has(n)) : [...local.keys()];

const missingNamed = only.filter(n => !local.has(n));
if (missingNamed.length) {
  console.error(`Not in .env: ${missingNamed.join(", ")}`);
  process.exit(1);
}

const toAdd = wanted.filter(n => !remote.has(n));
const present = wanted.filter(n => remote.has(n));

console.log(`\n.env: ${local.size} variables   Vercel (${envName}): ${remote.size}\n`);

if (present.length) {
  console.log(force ? "Will OVERWRITE (--force):" : "Already set on Vercel, leaving alone:");
  for (const n of present) console.log(`  ${force ? "!" : "="} ${n}`);
  console.log("");
}

if (!toAdd.length && !(force && present.length)) {
  console.log("Nothing to do.\n");
  process.exit(0);
}

if (toAdd.length) {
  console.log("Will add:");
  for (const n of toAdd) {
    console.log(`  + ${n}  (${SECRET_RE.test(n) ? "Secret" : "Config"})`);
  }
  console.log("");
}

if (!apply) {
  console.log("Dry run. Re-run with --apply to make these changes.\n");
  process.exit(0);
}

const work = force ? [...new Set([...toAdd, ...present])] : toAdd;
let done = 0, failed = 0;

for (const name of work) {
  const type = SECRET_RE.test(name) ? "--sensitive" : "--no-sensitive";
  try {
    vercel([
      "env", "add", name,
      "--environment", envName,
      type,
      ...(force ? ["--force"] : []),
      "--yes",
    ], local.get(name));
    console.log(`  ok    ${name}`);
    done++;
  } catch (e) {
    // stderr carries the reason; the value is never in it.
    const why = (e.stderr || e.message || "").toString().trim().split("\n").pop();
    console.log(`  FAIL  ${name}  ${why}`);
    failed++;
  }
}

console.log(`\n${done} set, ${failed} failed.`);
console.log(
  failed
    ? "Fix the failures and run again.\n"
    : "Now redeploy, or the running deployment will not see them.\n",
);
process.exit(failed ? 1 : 0);
