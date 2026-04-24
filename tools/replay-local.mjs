//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import path from "node:path";
import process from "node:process";
import {
  loadReplayFixture,
  loadReplayFixtures,
  summarizeReplayResults
} from "../src/core/replay-fixtures.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE_DIR = path.join(ROOT, "fixtures", "replay");

async function fixtureFilesFromArgs() {
  const args = process.argv.slice(2);
  if (args.length > 0) return args.map((arg) => path.resolve(arg));
  return null;
}

async function main() {
  const explicitFiles = await fixtureFilesFromArgs();
  const results = explicitFiles
    ? await Promise.all(explicitFiles.map((file) => loadReplayFixture(file)))
    : await loadReplayFixtures(FIXTURE_DIR);

  console.log(JSON.stringify({
    ok: true,
    mode: "offline-replay",
    fixture_count: results.length,
    scenarios: results.map((result) => result.scenario),
    totals: summarizeReplayResults(results)
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
