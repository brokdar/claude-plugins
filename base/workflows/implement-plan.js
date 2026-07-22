export const meta = {
  name: "implement-plan",
  description:
    "Generic, fire-and-forget feature implementer: parse ANY phased plan (e.g. one produced by /base:feature-plan) into phases dynamically, then per phase run one developer (TDD) → qa-engineer gate (bounded fix loop) → per-phase commit. Stack-neutral — gates and build steps are read from the plan, never hardcoded. Hard-stops on a phase that can't go green.",
  // Only the statically-known phase is declared here. The per-phase groups
  // ("Phase N: …") and the conditional final "Verify" group are created at
  // runtime by their own phase() calls — declaring them here would render as
  // empty groups (no agents) on scoped runs or because their titles are dynamic.
  phases: [
    { title: "Parse", detail: "discover phases from the plan + git log" },
  ],
};

// ── Inputs ──────────────────────────────────────────────────────────────────
// `args` is delivered verbatim as a JSON value by the Workflow runtime, but we
// stay tolerant of a JSON *string* too (older runtimes / hand-launches), so a
// dropped/mis-typed `args` can never silently default to "every pending phase".
const A = (() => {
  if (typeof args !== "string") return args || {};
  let parsedArgs;
  try {
    parsedArgs = JSON.parse(args);
  } catch {
    // A bare string is taken as the plan path — the most common
    // mis-invocation (args: "<plan.md>") should not abort the run.
    return { plan: args.trim() };
  }
  // A JSON-quoted string ('"plan.md"') parses successfully — to a string,
  // not an object. Treat it as the plan path too.
  return typeof parsedArgs === "string"
    ? { plan: parsedArgs.trim() }
    : parsedArgs || {};
})();

// REQUIRED: the plan to implement. No default — this workflow ships in `base`
// and must never assume a particular project's file. SPEC (the source-of-truth
// the plan derives from) is optional; if absent, the plan itself is the source.
const PLAN = A.plan || null;
const SPEC = A.spec || null;

// Optional phase window (structured args; all default to "every pending phase"):
//   { fromPhase: N }  → start at phase N        { toPhase: M }  → stop after phase M
//   { onlyPhase: K }  → just phase K (shorthand for fromPhase=K, toPhase=K)
// The git-log committed-skip ALWAYS applies, even inside an explicit window, so a
// re-run never clobbers already-committed work. To truly redo a committed phase,
// revert its commit first.
const ONLY = A.onlyPhase != null ? Number(A.onlyPhase) : null;
const FROM =
  ONLY != null ? ONLY : A.fromPhase != null ? Number(A.fromPhase) : -Infinity;
const TO =
  ONLY != null ? ONLY : A.toPhase != null ? Number(A.toPhase) : Infinity;

// { verifyOnly: true } → implement nothing; run ONLY the whole-feature
// verification (requires every phase already committed). This exists so the
// final safety net is still reachable when a run was hard-stopped and the
// remaining phases were finished by hand — the cross-phase issues it catches
// (double work between phases, one surface breaking another) are exactly what
// per-phase QA can't see.
// Accept the string "true" too — a stringly-typed flag must not silently
// downgrade a verify-only request into "nothing to do" (skipping the very
// verification the flag exists to guarantee).
const VERIFY_ONLY = A.verifyOnly === true || A.verifyOnly === "true";

const MAX_FIX_LOOPS = 2; // QA reject → fix → re-QA, this many times, then hard-stop.

if (!PLAN) {
  log(
    "No plan provided. Pass { plan: '<path-to-plan.md>', spec?: '<path>' } as args. Aborting.",
  );
  return { error: "no-plan" };
}

const SPEC_LINE = SPEC
  ? `- ${SPEC} — the source of truth for what "correct" means.`
  : `- (no separate spec was provided — the plan itself is the source of truth.)`;

// ── Project non-negotiables injected into every implement/fix prompt ─────────
// STACK-NEUTRAL by design. This workflow does NOT know your test framework,
// linter, codegen, or integration runner — and must not guess. Every concrete
// command lives in the PLAN (its "Repo gates" header and each phase's
// "Gates that must pass to commit" / "Project-specific steps triggered" lines,
// discovered from the repo when the plan was written) or in the repo's
// CLAUDE.md. The prompt orders the agent to READ those rather than hardcoding
// any stack here, so the workflow stays reusable for any plan and any stack.
const GUARDRAILS = `
Before writing anything, READ in full:
- ${PLAN} — your phase's section, the plan's "Repo gates" header, and your phase's
  "Gates that must pass to commit" and "Project-specific steps triggered" lines (these carry
  the actual, repo-discovered commands you must satisfy), AND any phase-specific ordering the
  plan specifies (e.g. a "phase shape" / internal TDD order) — follow it step by step.
${SPEC_LINE}
- The repo's CLAUDE.md and any standing project conventions it documents — honor them verbatim.

NON-NEGOTIABLE rules:
- TDD is binding: write the tests first, confirm them RED, then implement to GREEN. If a \`tdd\`
  skill is available to you, invoke it; otherwise follow red-green-refactor manually. Each test must
  assert the SPECIFIC behavior (not a proxy) and be seen to fail for the right reason before the code.
- Run exactly the gates the plan lists for this phase — do not invent commands, and do not skip a
  listed one. If an edit triggers a project-specific build step the plan names (codegen, migration,
  mock/fixture update), run it and VERIFY its output before building anything that consumes it.
- Fix every problem you touch (failing test / lint / type / format) — no broken windows, no skips,
  no bypassing git hooks (never \`--no-verify\`).
- Do NOT git commit, do NOT \`git add\`, and do NOT modify ${PLAN}. Leave the working tree in the
  state the plan's gates require (GREEN); the orchestrator stages and commits ONLY this phase's own files.
`;

const QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "rightThingBuilt",
    "requirements",
    "gaps",
    "verification",
    "issues",
  ],
  properties: {
    status: { type: "string", enum: ["APPROVED", "REJECTED"] },
    rightThingBuilt: { type: "string" },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirement", "verdict", "evidence"],
        properties: {
          requirement: { type: "string" },
          verdict: {
            type: "string",
            enum: ["FULFILLED", "NOT_FULFILLED", "PARTIAL"],
          },
          evidence: { type: "string" },
        },
      },
    },
    gaps: { type: "string" },
    verification: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirement", "area"],
        properties: {
          requirement: { type: "string" },
          area: { type: "string" },
        },
      },
    },
  },
};

// Structured plan parse — the dynamic heart of this workflow. Stack-neutral:
// instead of a frontend/backend binary it captures the gates and build steps the
// plan discovered for each phase, plus whether the phase carries higher-level
// (integration/e2e) tests — everything the implement/commit prompts need without
// assuming any particular stack.
const PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["feature", "branch", "phases", "preexistingDirtyPaths"],
  properties: {
    feature: { type: "string" },
    branch: { type: "string" },
    // Every path dirty/untracked BEFORE the run — off-limits for phase commits.
    preexistingDirtyPaths: { type: "array", items: { type: "string" } },
    phases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "n",
          "title",
          "commitMessage",
          "gates",
          "buildSteps",
          "hasHigherLevelTests",
          "summary",
          "alreadyCommitted",
        ],
        properties: {
          n: { type: "number" },
          title: { type: "string" },
          // EXACT commit subject this phase commits with (see parse prompt for where to find it).
          commitMessage: { type: "string" },
          // The gates this phase must pass to commit clean (the repo's discovered
          // commands — test/lint/type/build), as a flat list of short strings.
          gates: { type: "array", items: { type: "string" } },
          // Project-specific build steps this phase's edits trigger (codegen,
          // migration, mock/fixture update, …) — empty array if none.
          buildSteps: { type: "array", items: { type: "string" } },
          // TRUE if the phase includes integration / end-to-end / other higher-level tests.
          hasHigherLevelTests: { type: "boolean" },
          // 2-5 sentences: what this phase delivers + the load-bearing decisions/files.
          summary: { type: "string" },
          // TRUE only if a commit with this exact subject already exists in `git log`.
          alreadyCommitted: { type: "boolean" },
        },
      },
    },
  },
};

// ── Prompt builders ──────────────────────────────────────────────────────────
function parsePrompt() {
  return `You are parsing a feature implementation plan into an ordered, machine-readable phase list for an autonomous implementer. The plan follows a phased, TDD-first format where every phase ends in a clean commit.

Read ${PLAN} in full${SPEC ? `, and skim ${SPEC} enough to understand the feature` : ""}.

Then run BOTH of these yourself:
- \`git log --oneline -40\` — to detect already-committed phases.
- \`git status --porcelain -uall\` — to capture the working tree's PRE-EXISTING changes.

Set \`preexistingDirtyPaths\` to the list of every dirty/untracked file path from \`git status --porcelain -uall\` (the path only, stripped of the 2-char status prefix; list individual files, not directories). These are unrelated to the work about to happen, and the orchestrator will keep them OUT of every phase commit. If the tree is clean, return an empty array.

Also fill the top-level \`feature\` (the feature's name/title) and \`branch\` (the git branch this work belongs on). Take \`branch\` from the plan's setup / "Task 0: Branch Creation" step — the NEW branch name it creates, i.e. the argument right after \`-c\` in \`git switch -c <branch> [start-point]\` (or after \`-b\` in an older \`git checkout -b <branch>\`). It is the feature branch (e.g. \`feature/…\`), NOT any \`origin/…\` start-point the command may branch from. This field is load-bearing: the orchestrator checks out / creates this branch before implementing, so all work lands off the base branch. If the plan names no branch anywhere, return an empty string.

Return, in the provided structured format, EVERY implementation phase in the plan, in order. For each phase:
- n / title — from the "## Phase N: <title>" headers.
- commitMessage — the EXACT commit subject this phase commits with, VERBATIM. Find it wherever the plan records the phase's commit: typically the phase's final commit step (a line like \`**Command**: git add ... && git commit -m "<subject>"\`), or — if the plan puts it there — the phase header's \`→ git commit -m "<subject>"\`. Capture only the message inside the quotes.
- gates — the checks this phase must pass to commit clean. Take the plan's top "Repo gates" header AND the phase's own "Gates that must pass to commit" line; list each as a short string (e.g. "unit tests", "lint", "type-check", "build"). If the plan names exact commands, prefer those verbatim.
- buildSteps — any project-specific build step this phase's edits trigger, from its "Project-specific steps triggered" line or body (codegen / client or type regeneration / migration / mock or fixture update). Each as a short string. Empty array if the phase triggers none.
- hasHigherLevelTests — TRUE if the phase includes integration, end-to-end, or other higher-level test work (look for an integration/E2E step); FALSE otherwise.
- summary — 2-5 sentences capturing what the phase delivers and the load-bearing decisions/files an implementer must honor.
- alreadyCommitted — TRUE only if a commit whose subject EXACTLY matches commitMessage already appears in the \`git log\` output. Do NOT trust the plan's own ✅/⬜/🔄 status markers — they drift from reality; the git history is the source of truth.

Setup/"Phase 0"/branch tasks that have no implementation commit of their own are not phases — skip them. Return only real, commit-bearing implementation phases.`;
}

// ── Per-phase context handoff ────────────────────────────────────────────────
// The Workflow tool's agents are stateless (each agent() is a fresh context), so
// true per-phase continuity isn't available. This is the approximation: the
// implement/fix agent emits a structured handoff (file map + decisions + test
// locations + weak spots); every downstream agent in the SAME phase (QA, later
// fixes) receives it and skips re-exploration — it already knows the layout and
// where to touch. A new phase starts with no handoff → fresh context.
// Kept deliberately lean to avoid output-truncation spirals: fileMap is a flat
// list of "path — role" strings (NOT array-of-objects, which truncated mid-array
// and dropped the property), and only `summary` is required so a partial/best-
// effort emit still validates instead of forcing endless StructuredOutput retries.
const HANDOFF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: { type: "string" },
    fileMap: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    testLocations: { type: "array", items: { type: "string" } },
    weakSpots: { type: "array", items: { type: "string" } },
  },
};

function handoffBlock(handoff) {
  if (!handoff) return "";
  const list = (xs) =>
    xs && xs.length ? xs.map((x) => `  - ${x}`).join("\n") : "  (none)";
  const files = (handoff.fileMap || []).map((f) => `  - ${f}`).join("\n");
  return `
CONTEXT HANDOFF from this phase's implement step — use it instead of re-exploring; you already know the layout and where things live:
Summary: ${handoff.summary}
Files touched this phase:
${files || "  (none listed)"}
Key decisions:
${list(handoff.decisions)}
Tests live at:
${list(handoff.testLocations)}
Weak spots to scrutinize:
${list(handoff.weakSpots)}
`;
}

// Appended to implement/fix prompts so the agent emits the handoff as its result.
const HANDOFF_INSTRUCTION = `

When done, return the CONTEXT HANDOFF in the provided structured format, kept DELIBERATELY BRIEF so it never overflows the output budget: a 2-3 sentence summary; fileMap as a flat list of strings, each "path — short role" (skip trivial files, keep to the ~12 most important, ONE short line each); decisions, testLocations, and weakSpots as terse one-line bullets (phrases, not prose). Only \`summary\` is required — include the rest best-effort; never pad. Downstream QA/fix agents use it only to skip re-reading everything, so concise pointers beat completeness.`;

function gatesLine(p) {
  return p.gates && p.gates.length
    ? `run every gate this phase requires (from the plan): ${p.gates.join(", ")}.`
    : `run every gate the plan lists for this phase.`;
}
function buildStepsLine(p) {
  return p.buildSteps && p.buildSteps.length
    ? ` This phase's edits trigger project-specific build step(s) the plan names — run and VERIFY them before anything depends on their output: ${p.buildSteps.join("; ")}.`
    : "";
}

// Orientation block from the PREVIOUS phase's handoff — a new phase's implement
// agent is a fresh context, but the feature's earlier phases already mapped the
// terrain; passing the map forward cuts minutes of re-exploration per phase.
function priorPhaseBlock(h) {
  if (!h) return "";
  const files = (h.fileMap || []).map((f) => `  - ${f}`).join("\n");
  return `
CONTEXT from the PREVIOUS phase's implementation — orientation only, this phase builds on it (verify anything load-bearing, but don't re-discover the layout from scratch):
Summary: ${h.summary}
Files it touched:
${files || "  (none listed)"}
`;
}

function implementPrompt(p, fixIssues, handoff, prior) {
  if (fixIssues && fixIssues.length) {
    return `The Phase ${p.n} ("${p.title}") quality gate flagged these items — fix ONLY them, confirm with the targeted tests for these items${p.hasHigherLevelTests ? " plus this phase's higher-level (integration/E2E) tests" : ""}, then re-run this phase's gates so the phase ends GREEN (your fix may have side effects beyond the flagged items, and nothing downstream re-runs the suites for you):
${fixIssues.map((i) => `- ${i.requirement} (${i.area})`).join("\n")}
${handoffBlock(handoff)}${GUARDRAILS}${HANDOFF_INSTRUCTION}`;
  }
  return `Implement Phase ${p.n} ("${p.title}") of ${PLAN} END TO END, by yourself, using TDD.

What this phase delivers: ${p.summary}
${priorPhaseBlock(prior)}

Do the complete phase: write the failing tests first (confirm RED), implement to GREEN, then ${gatesLine(p)}${p.hasHigherLevelTests ? " Also write and run this phase's higher-level (integration/end-to-end) tests — confirm them failing for the right reason, then passing." : ""}${buildStepsLine(p)} Follow any phase-specific ordering ("phase shape" / internal TDD order) the plan specifies, step by step.
${GUARDRAILS}${HANDOFF_INSTRUCTION}`;
}

// First-pass and targeted re-QA share this. The validation methodology lives in
// the qa-engineer agent definition; the execution policy below deliberately
// NARROWS the agent's default (which backgrounds full ungated suites) — in this
// pipeline the implement/fix agents already ran the phase's gates, so re-running
// them at QA time is pure redundancy.
function qaPrompt(p, rejectedIssues, handoff) {
  const pointers = `${SPEC ? `Source of truth: ${SPEC}. ` : ""}Plan, acceptance criteria, recorded decisions: ${PLAN} — the Phase ${p.n} section, every acceptance-criterion / QA-coverage-matrix row scoped to Phase ${p.n}, and any decisions or warnings those rows cite. Inspect the actual change with \`git diff --stat\` and read the diff.`;
  if (rejectedIssues && rejectedIssues.length) {
    return `Re-validate Phase ${p.n} ("${p.title}") after a fix — TARGETED. Validate ONLY the previously-rejected requirements below; do not re-validate the whole phase:
${rejectedIssues.map((i) => `- ${i.requirement} (${i.area})`).join("\n")}
${pointers}${handoffBlock(handoff)}
For each one, confirm it is now genuinely fulfilled, citing the test that exercises it. Run ONLY the targeted tests for these requirements (the specific test file or a filter) — do NOT re-run the full integration/E2E suites; the fix agent already re-ran this phase's gates after fixing. Return the verdict in the provided structured format.`;
  }
  return `Validate Phase ${p.n} ("${p.title}").
${pointers}${handoffBlock(handoff)}
Execution policy — verification here is TARGETED, not a re-run of the world: the implement agent
already ran this phase's full gates green (and any pre-commit hook re-runs what it covers at commit
time), so do NOT re-execute full test/lint/type suites. Read the diff and the tests, judge requirement
coverage against the plan, and RUN only the targeted tests that prove this phase's specific
requirements (a test file or filter at a time, in the foreground — never start a suite in the
background and poll for it). Escalate to a fuller re-run only if you find concrete evidence the
implementation's gate results can't be trusted (e.g. a test that can't fail, a gate that plainly
wasn't run) — and say so in your verdict.
Return your verdict in the provided structured format.`;
}

function commitPrompt(p, baseline) {
  const offLimits = baseline && baseline.length ? baseline : [];
  const gateHint =
    p.gates && p.gates.length
      ? `the formatter/linter among this phase's gates (${p.gates.join(", ")})`
      : `any formatter/linter the plan lists as a gate for this phase`;
  return `Phase ${p.n} ("${p.title}") passed QA. Commit ONLY this phase's own changes.

⚠️ CRITICAL — NEVER run \`git add -A\`, \`git add .\`, or \`git add -u\`. The working tree contains pre-existing, unrelated changes that MUST NOT be part of this commit. The following paths existed as dirty/untracked BEFORE this feature run — they are OFF-LIMITS, never stage or commit them:
${offLimits.length ? offLimits.map((f) => `  - ${f}`).join("\n") : "  (none — tree was clean at start)"}

Steps:
1. Run ONLY ${gateHint} so the tree is formatted as the gates expect. (This may touch off-limits files too — that's fine, you simply won't stage those.) If the plan lists no formatter, skip this step. Do NOT re-run test suites, type checks, or integration/E2E runners here — the phase was just QA-approved (and any pre-commit hook still runs on the commit itself); re-executing multi-minute suites at commit time only burns wall-clock.
2. Determine THIS PHASE's files: run \`git status --porcelain -uall\` and take every dirty path EXCEPT the off-limits paths above. ALSO always exclude any path under \`.claude/agent-memory/\` (at any depth, e.g. \`backend/.claude/agent-memory/...\`) — QA/dev agents write private memory there DURING this phase, so it appears dirty but is never feature code and the off-limits snapshot (taken before they ran) won't list it. Those remaining paths are the only files you may stage.
3. Stage them explicitly by path: \`git add -- <path1> <path2> ...\`. Never a wildcard that could catch an off-limits path.
4. Commit with EXACTLY this message: "${p.commitMessage}". NEVER use --no-verify.
5. If a pre-commit hook regenerates files (e.g. codegen / schema sync) and aborts, re-derive the phase file list the same way (current dirty MINUS off-limits), \`git add --\` exactly those, and commit again.
6. Before reporting success, run \`git show --stat --oneline HEAD\` and confirm NONE of the off-limits paths appear. If any off-limits path was committed, that is a FAILURE — report it.
Report the commit SHA and the exact list of files committed, or describe the failure if the commit could not be made cleanly.`;
}

// Ensure the feature branch exists and is checked out. The plan's "Task 0 /
// Branch Creation" setup step is intentionally NOT parsed as a phase (it has no
// implementation commit), so nothing else creates the branch — do it here, or
// every phase commits onto the base branch. Idempotent: no-op if already on it,
// plain switch if it exists, create-from-fresh-upstream if it doesn't. A NEW
// branch is cut from the remote's detected default branch (origin/HEAD), fetched
// first so it starts from current upstream — with graceful fallback to local
// HEAD when offline / no remote / a dirty tree would conflict with the new base.
// Uncommitted pre-existing changes are always preserved (never stashed or
// discarded); a failure that can't be resolved without discarding work is
// reported, not forced.
function branchPrompt(branch) {
  return `Ensure the feature branch "${branch}" exists and is checked out, BEFORE any implementation begins. The plan's setup / "Task 0: Branch Creation" step creates this branch; this workflow performs that here so all phase work lands on the feature branch, never on the base branch. Use \`git switch\` (not \`git checkout\`).

Steps:
1. Run \`git rev-parse --abbrev-ref HEAD\`. If the current branch is already "${branch}", you are done — report that and stop.
2. Run \`git rev-parse --verify --quiet refs/heads/${branch}\` to test whether the branch already exists locally:
   - If it EXISTS, switch to it: \`git switch ${branch}\`, then go to step 4. (Do NOT fetch or re-base an existing branch — this is a re-run; just get onto it.)
   - If it does NOT exist, create it from fresh upstream (step 3).
3. Create "${branch}" from the remote's current default branch:
   a. Detect the base branch: \`git symbolic-ref --quiet --short refs/remotes/origin/HEAD\` (yields e.g. "origin/main"; the base name is the part after "origin/"). If that fails because origin/HEAD isn't set, try \`git remote set-head origin --auto\` once, then re-read it.
   b. Fetch it: \`git fetch origin <baseName>\` (best-effort).
   c. Create and switch from the fetched base: \`git switch -c ${branch} origin/<baseName>\`.
   d. FALLBACK — if there is no "origin" remote, if the fetch fails (e.g. offline), or if the base can't be detected, create from the current HEAD instead: \`git switch -c ${branch}\`. Say in your report that you fell back to the local HEAD and why.
4. Pre-existing uncommitted changes are intentional and must be preserved — never stash, discard, reset, or commit them. If \`git switch -c ${branch} origin/<baseName>\` refuses because local changes would be overwritten by the base, do NOT force it: fall back to \`git switch -c ${branch}\` from the current HEAD (which cannot conflict) and note that you branched from HEAD to preserve local changes. If switching to an EXISTING branch fails for the same reason, do NOT force or discard anything — report the failure instead.
5. Confirm with \`git rev-parse --abbrev-ref HEAD\` that HEAD is now "${branch}", and report the final result (including the base you branched from and any fallback taken).

Do NOT commit anything and do NOT modify any working-tree files — this step only manipulates branches and the remote-tracking refs.`;
}

// ── Stage 0: parse the plan into phases ──────────────────────────────────────
// Echo the received args + resolved window FIRST, so a dropped/missing `args`
// (e.g. from launching by name instead of scriptPath) is visible immediately
// rather than after the run has silently implemented every phase.
log(
  `Launch args: raw=${JSON.stringify(args ?? null)} parsed=${JSON.stringify(A)} → window [${FROM === -Infinity ? "start" : "P" + FROM}..${TO === Infinity ? "end" : "P" + TO}], plan=${PLAN}`,
);
phase("Parse");
const parsed = await agent(parsePrompt(), {
  label: "parse-plan",
  phase: "Parse",
  schema: PARSE_SCHEMA,
  model: "sonnet",
});

if (!parsed || !parsed.phases || parsed.phases.length === 0) {
  log("Could not parse any phases from the plan — aborting.");
  return { error: "parse-failed", parsed };
}

// Pre-existing dirty files — kept OUT of every phase commit (never `git add -A`).
const baseline = parsed.preexistingDirtyPaths || [];
if (baseline.length) {
  log(
    `${baseline.length} pre-existing dirty path(s) will be excluded from all phase commits.`,
  );
}

const pending = VERIFY_ONLY
  ? []
  : parsed.phases.filter(
      (p) => p.n >= FROM && p.n <= TO && !p.alreadyCommitted,
    );
const committedCount = parsed.phases.filter((p) => p.alreadyCommitted).length;
const windowed = FROM !== -Infinity || TO !== Infinity;
log(
  `Feature: ${parsed.feature} (${parsed.branch}). ${parsed.phases.length} phases; ` +
    `${committedCount} already committed` +
    (windowed
      ? `; window [${FROM === -Infinity ? "start" : "P" + FROM}..${TO === Infinity ? "end" : "P" + TO}]`
      : "") +
    `. Implementing: ${pending.map((p) => `P${p.n}`).join(", ") || "(none)"}.`,
);
if (pending.length === 0 && !VERIFY_ONLY) {
  log("No phases to implement in this window — nothing to do.");
  return {
    feature: parsed.feature,
    completed: [],
    note: "no-pending-in-window",
  };
}

// ── Ensure we're on the feature branch before touching any files ─────────────
// Only when we actually have phases to implement (never for verifyOnly, which
// leaves `pending` empty and merely re-verifies already-committed work).
if (pending.length > 0) {
  if (parsed.branch) {
    phase("Setup");
    const branchResult = await agent(branchPrompt(parsed.branch), {
      label: "ensure-branch",
      phase: "Setup",
      model: "sonnet",
    });
    if (branchResult == null) {
      log(
        `HARD STOP: could not ensure feature branch "${parsed.branch}" is checked out — refusing to implement onto the base branch. Create/checkout the branch by hand, then re-launch.`,
      );
      return { stoppedAt: 0, reason: "branch-setup-failed", completed: [] };
    }
    log(`Feature branch ensured: ${parsed.branch}.`);
  } else {
    log(
      "⚠️ Plan named no feature branch — implementing on the CURRENT branch. If that is not intended, create the branch by hand and re-launch.",
    );
  }
}

// ── Drive pending phases strictly sequentially (shared files + per-phase commit) ─
const completed = [];
let prevHandoff = null; // previous phase's handoff → next phase's orientation
for (const p of pending) {
  const title = `Phase ${p.n}: ${p.title}`;
  phase(title);

  // 1. Implement — one fresh developer agent carries the whole phase via TDD,
  //    and returns a CONTEXT HANDOFF that primes the rest of the phase's agents.
  //    agent() returns null when the agent dies (transient API error) or is
  //    skipped — NEVER advance a phase to QA without an implementation: retry
  //    once, then hard-stop. (Observed failure: an implement agent died on a
  //    529 mid-exploration and QA was dispatched against an empty diff.)
  let handoff = await agent(implementPrompt(p, null, null, prevHandoff), {
    label: `P${p.n}:implement`,
    phase: title,
    model: "opus",
    schema: HANDOFF_SCHEMA,
  });
  if (handoff == null) {
    log(`Phase ${p.n} implement agent returned nothing (died/skipped) — retrying once.`);
    // The dead attempt may have left partial work in the tree — the retry must
    // assess it instead of blindly expecting a clean-slate RED confirmation.
    const retryPreamble = `NOTE: a previous attempt at this phase died partway through, so the working tree may already contain partial work (tests and/or implementation). Inspect what exists before writing anything: keep what is correct, fix or replace what isn't, and don't be derailed if some of this phase's tests already exist or already pass — bring the phase to the same end state as a clean run (all tests written, GREEN, gates passing).

`;
    handoff = await agent(retryPreamble + implementPrompt(p, null, null, prevHandoff), {
      label: `P${p.n}:implement-retry`,
      phase: title,
      model: "opus",
      schema: HANDOFF_SCHEMA,
    });
  }
  if (handoff == null) {
    log(
      `HARD STOP at Phase ${p.n}: implement produced no result after a retry. The tree may hold the attempt's partial work — revert or stash it before re-launching, or the relaunch will snapshot it as pre-existing and exclude it from the phase commit.`,
    );
    return { stoppedAt: p.n, reason: "implement-failed", completed };
  }

  // 2. QA gate with a bounded fix loop. Fix + re-QA carry the handoff so the
  //    fresh agents skip re-exploration; the re-QA is targeted to the rejections.
  let verdict = await agent(qaPrompt(p, null, handoff), {
    label: `P${p.n}:qa`,
    phase: title,
    agentType: "base:qa-engineer",
    schema: QA_SCHEMA,
    model: "opus",
  });
  let loops = 0;
  while (verdict && verdict.status === "REJECTED" && loops < MAX_FIX_LOOPS) {
    loops++;
    const rejected = verdict.issues; // re-QA validates ONLY these (targeted)
    log(
      `Phase ${p.n} REJECTED (fix ${loops}/${MAX_FIX_LOOPS}): ${verdict.gaps}`,
    );
    handoff =
      (await agent(implementPrompt(p, rejected, handoff), {
        label: `P${p.n}:fix${loops}`,
        phase: title,
        model: "opus",
        schema: HANDOFF_SCHEMA,
      })) || handoff;
    verdict = await agent(qaPrompt(p, rejected, handoff), {
      label: `P${p.n}:qa-recheck${loops}`,
      phase: title,
      agentType: "base:qa-engineer",
      schema: QA_SCHEMA,
      model: "opus",
    });
  }
  if (!verdict || verdict.status !== "APPROVED") {
    log(
      `HARD STOP at Phase ${p.n}: still not green after ${loops} fix loop(s).`,
    );
    return { stoppedAt: p.n, reason: "qa", verdict, completed };
  }

  // 3. Commit the phase with its exact plan commit message. Mechanical work —
  //    a cheap model suffices; never inherit the (possibly premium) session model.
  const commit = await agent(commitPrompt(p, baseline), {
    label: `P${p.n}:commit`,
    phase: title,
    model: "sonnet",
  });
  if (commit == null) {
    log(
      `HARD STOP at Phase ${p.n}: commit agent failed — phase is QA-approved but NOT committed; a next phase would sweep its files.`,
    );
    return { stoppedAt: p.n, reason: "commit-failed", verdict, completed };
  }
  completed.push({ phase: p.n, title: p.title, verdict, commit });
  prevHandoff = handoff;
  log(`✅ Phase ${p.n} committed.`);
}

// ── Final: whole-feature verification against the full plan/spec ─────────────
// Only when the feature is now fully committed. A scoped/partial run (a phase
// window that leaves later phases unimplemented) skips it — verifying the whole
// spec while phases remain would just report noise.
const allComplete = parsed.phases.every(
  (p) => p.alreadyCommitted || completed.some((c) => c.phase === p.n),
);
if (!allComplete) {
  if (VERIFY_ONLY) {
    log(
      "verifyOnly requested but some phases are not committed yet — nothing to verify against; finish (or run) the remaining phases first.",
    );
    return {
      feature: parsed.feature,
      note: "verify-only-blocked",
      pendingPhases: parsed.phases
        .filter((p) => !p.alreadyCommitted)
        .map((p) => p.n),
    };
  }
  log(
    "Scoped run complete — skipping whole-feature verification (phases still remain).",
  );
  return { feature: parsed.feature, completed, scoped: true };
}

phase("Verify");
const verifyTask = `All pending phases are implemented and committed. Verify the WHOLE "${parsed.feature}" feature against ALL acceptance criteria in ${PLAN} (its acceptance-criteria / QA-coverage matrix)${SPEC ? `, with ${SPEC} as the source of truth` : ""} — not just the last phase. Run every suite yourself. This is the report a human will read to sign off, so be exhaustive about any criterion that is partial, misread, or only superficially covered.`;
const verifyOpts = {
  phase: "Verify",
  agentType: "base:qa-engineer",
  schema: QA_SCHEMA,
  model: "opus",
};
let finalReport = await agent(verifyTask, {
  ...verifyOpts,
  label: "final-ac-verification",
});
if (finalReport == null) {
  // This gate is the whole reason verifyOnly exists — never drop it silently.
  log(
    "Final verification agent returned nothing (died/skipped) — retrying once.",
  );
  finalReport = await agent(verifyTask, {
    ...verifyOpts,
    label: "final-ac-verification-retry",
  });
}
if (finalReport == null) {
  log(
    "Final verification produced no report after a retry — the feature is committed but UNVERIFIED. Re-launch with { verifyOnly: true } to restore this gate.",
  );
  return { feature: parsed.feature, completed, note: "final-verification-missing" };
}

return { feature: parsed.feature, completed, finalReport };
