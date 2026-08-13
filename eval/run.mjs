#!/usr/bin/env node
// Eval runner: grade every fixture in eval/fixtures with the deterministic
// checks and (when ANTHROPIC_API_KEY is set) the Fable judge, then write a
// scorecard.
//
// Usage:
//   node eval/run.mjs                 # checks + judge (if key present)
//   node eval/run.mjs --no-judge      # checks only
//   node eval/run.mjs cdmx-food       # a subset of fixtures
//
// Exit code is non-zero when any fixture has hard-rule failures or the judge
// grades a fixture below EVAL_MIN_OVERALL (default 6) — so CI turns red on a
// quality regression, not just on a crash.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runChecks, summarizeChecks } from "./checks.mjs";
import { judgeFixture } from "./judge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const resultsDir = join(here, "results");
mkdirSync(resultsDir, { recursive: true });

const args = process.argv.slice(2);
const noJudge = args.includes("--no-judge");
const wanted = args.filter(a => !a.startsWith("--"));
const MIN_OVERALL = Number(process.env.EVAL_MIN_OVERALL ?? 6);

let files;
try {
  files = readdirSync(fixturesDir).filter(f => f.endsWith(".json"));
} catch {
  files = [];
}
if (wanted.length) files = files.filter(f => wanted.includes(f.replace(/\.json$/, "")));
if (files.length === 0) {
  console.error("No fixtures found. Run `node eval/capture.mjs` first (needs SUPABASE_URL / SUPABASE_ANON_KEY).");
  process.exit(2);
}

const judgeEnabled = !noJudge && !!process.env.ANTHROPIC_API_KEY;
if (!judgeEnabled && !noJudge) {
  console.warn("ANTHROPIC_API_KEY not set — running deterministic checks only.");
}

const rows = [];
let hardFailures = 0;

for (const file of files) {
  const id = file.replace(/\.json$/, "");
  const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
  const checks = runChecks(fixture);
  const { fails, warns } = summarizeChecks(checks);

  let judge = null;
  let judgeError = null;
  if (judgeEnabled && fixture.itinerary) {
    try {
      console.log(`[${id}] judging with ${process.env.EVAL_JUDGE_MODEL ?? "claude-fable-5"}…`);
      judge = await judgeFixture(fixture);
    } catch (err) {
      judgeError = String(err);
      console.error(`[${id}] judge error: ${judgeError}`);
    }
  }

  const overall = judge?.grade?.overall ?? null;
  const failedQuality = fails > 0 || (overall !== null && overall < MIN_OVERALL) || (judgeEnabled && judgeError);
  if (failedQuality) hardFailures++;

  rows.push({ id, label: fixture.meta?.label ?? id, checks, fails, warns, judge, judgeError, overall, failedQuality });
  console.log(`[${id}] checks: ${fails} fail / ${warns} warn` + (overall !== null ? ` · judge overall: ${overall}/10` : ""));
}

// ── Scorecard ───────────────────────────────────────────────────────────────
const scorecard = {
  ranAt: new Date().toISOString(),
  judgeModel: judgeEnabled ? (rows.find(r => r.judge)?.judge?.model ?? null) : null,
  minOverall: MIN_OVERALL,
  fixtures: rows.map(r => ({
    id: r.id,
    label: r.label,
    checkFails: r.fails,
    checkWarns: r.warns,
    stats: r.checks.stats,
    findings: r.checks.findings,
    judge: r.judge?.grade ?? null,
    judgeError: r.judgeError,
    failedQuality: r.failedQuality,
  })),
};
writeFileSync(join(resultsDir, "scorecard.json"), JSON.stringify(scorecard, null, 2));

const dimNames = ["specificity", "groundedness", "tripShape", "requestFit", "diningIntegrity", "actionability"];
let md = `# Itinerary Eval Scorecard\n\nRan: ${scorecard.ranAt}` +
  (scorecard.judgeModel ? ` · Judge: \`${scorecard.judgeModel}\`` : " · checks only") + "\n\n";
md += `| Fixture | Checks | ${dimNames.map(d => d.replace(/([A-Z])/g, " $1").toLowerCase()).join(" | ")} | Overall | Ship? |\n`;
md += `|---|---|${dimNames.map(() => "---").join("|")}|---|---|\n`;
for (const r of rows) {
  const g = r.judge?.grade;
  md += `| ${r.id} | ${r.fails}F/${r.warns}W | ` +
    dimNames.map(d => g ? `${g.dimensions[d].score}` : "—").join(" | ") +
    ` | ${g ? `**${g.overall}**` : "—"} | ${g ? (g.wouldShip ? "✅" : "❌") : "—"} |\n`;
}
md += "\n";
for (const r of rows) {
  md += `## ${r.id} — ${r.label}\n\n`;
  const s = r.checks.stats;
  if (s.dayCount !== undefined) {
    md += `${s.dayCount} days · ${s.activityCount ?? 0} activities · ${s.diningCount ?? 0} dining entries ` +
      `(${s.uniqueRestaurants ?? 0} unique, ${s.emptyDiningPeriods ?? 0} empty periods) · ` +
      `${s.categoryDiningNames ?? 0} category-name dining · ${s.genericPhraseHits ?? 0} generic phrases\n\n`;
  }
  const fails = r.checks.findings.filter(f => f.level === "fail");
  if (fails.length) {
    md += `**Hard failures:**\n` + fails.map(f => `- \`${f.check}\` ${f.detail}`).join("\n") + "\n\n";
  }
  const g = r.judge?.grade;
  if (g) {
    md += `**Judge:** overall ${g.overall}/10, ship: ${g.wouldShip}\n\n`;
    if (g.topProblems?.length) md += `Top problems:\n` + g.topProblems.map(p => `- ${p}`).join("\n") + "\n\n";
    if (g.bestMoment) md += `Best moment: ${g.bestMoment}\n\n`;
    for (const d of dimNames) {
      const dim = g.dimensions[d];
      if (dim.issues?.length) md += `<details><summary>${d}: ${dim.score}/10</summary>\n\n${dim.issues.map(i => `- ${i}`).join("\n")}\n</details>\n\n`;
    }
  }
  if (r.judgeError) md += `**Judge error:** ${r.judgeError}\n\n`;
}
writeFileSync(join(resultsDir, "scorecard.md"), md);

console.log(`\nScorecard: eval/results/scorecard.md (${rows.length} fixture(s), ${hardFailures} failing quality gate)`);
process.exit(hardFailures ? 1 : 0);
