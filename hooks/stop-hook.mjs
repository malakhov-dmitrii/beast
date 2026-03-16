#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Helpers ---

function readStdin() {
  try {
    return readFileSync('/dev/stdin', 'utf-8');
  } catch {
    return '{}';
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function allow() {
  process.exit(0);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// --- Session Management ---

function getSessionId(hookInput) {
  const transcriptPath = hookInput.transcript_path || '';
  if (transcriptPath) {
    const filename = basename(transcriptPath, '.json');
    return filename.replace(/^transcript-/, '');
  }
  return `fallback-${Date.now()}-${process.pid}`;
}

function claimSession(sessionId, transcriptPath) {
  const finalDir = `.beast-plan/sessions/${sessionId}`;

  // Already claimed?
  if (existsSync(finalDir)) return finalDir;

  // Find newest unclaimed pending session
  let pendingDir = null;
  let newestTime = 0;

  try {
    const entries = readdirSync('.beast-plan').filter(e => e.startsWith('pending-'));
    for (const entry of entries) {
      const dir = `.beast-plan/${entry}`;
      const state = readJson(`${dir}/state.json`);
      if (!state || state.transcript_path || !state.active) continue;

      const ts = state.updated_at ? new Date(state.updated_at).getTime() : 0;
      if (ts > newestTime) {
        newestTime = ts;
        pendingDir = dir;
      }
    }
  } catch { /* no .beast-plan dir */ }

  if (!pendingDir) {
    // Check legacy flat structure
    if (existsSync('.beast-plan/state.json') && !existsSync('.beast-plan/sessions')) {
      return '.beast-plan';
    }
    return null;
  }

  // Claim: move pending -> sessions
  try {
    mkdirSync('.beast-plan/sessions', { recursive: true });
    renameSync(pendingDir, finalDir);
  } catch {
    return existsSync(finalDir) ? finalDir : null;
  }

  // Update state with session ID and transcript path
  const state = readJson(`${finalDir}/state.json`);
  if (state) {
    state.session_id = sessionId;
    state.transcript_path = transcriptPath;
    state.updated_at = new Date().toISOString();
    writeJson(`${finalDir}/state.json`, state);
  }

  return finalDir;
}

// --- Skill Discovery ---

function discoverSkills(taskDesc) {
  try {
    const script = join(__dirname, 'discover-skills.sh');
    const result = execFileSync('bash', [script, taskDesc], {
      encoding: 'utf-8', timeout: 10000
    });
    return JSON.parse(result);
  } catch {
    return [];
  }
}

// --- Last Output Extraction ---

function getLastOutput(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.includes('"role":"assistant"'));
    const lastLine = lines[lines.length - 1];
    if (!lastLine) return '';
    const msg = JSON.parse(lastLine);
    return (msg.message?.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  } catch {
    return '';
  }
}

// --- Prompt Templates ---

export function planPrompts(baseDir, state) {
  const { phase, pipeline_actor: actor, iteration = 1, critic_verdict: verdict, flags = [] } = state;
  const iterDir = pad(iteration);
  const key = `${phase}:${actor || ''}`;
  const flagStr = Array.isArray(flags) ? flags.join(',') : flags;

  switch (key) {
    case 'interview:': {
      const taskDesc = state.task_description || '';
      const skills = discoverSkills(taskDesc);
      let skillContent = '';
      if (skills.length > 0) {
        skillContent = '\n\n## Detected Domain Skills\n\n';
        for (const skill of skills) {
          try {
            const preview = readFileSync(skill.path, 'utf-8').split('\n').slice(0, 100).join('\n');
            skillContent += `### Skill: ${skill.name}\n\n\`\`\`\n${preview}\n\`\`\`\n\n`;
          } catch { /* skip */ }
        }
        state.detected_skills = skills.map(s => s.name);
        writeJson(`${baseDir}/state.json`, state);
      }
      return `BEAST-PLAN: Interview complete. Now run the RESEARCH phase.

1. Read \`${baseDir}/CONTEXT.md\` to understand the requirements and decisions.
2. Spawn the researcher agent:
   \`\`\`
   Task(subagent_type="beast:researcher", model="sonnet", prompt=<CONTEXT.md content + research instructions>)
   \`\`\`
   Pass the full CONTEXT.md content in the prompt.${skillContent}
3. Write the researcher's output to \`${baseDir}/RESEARCH.md\`
4. Update \`${baseDir}/state.json\`: set \`phase\` to \`"research"\`, \`pipeline_actor\` to \`""\`
5. Emit \`<bp-phase-done>\``;
    }

    case 'research:':
      return `BEAST-PLAN: Research complete. Now run the PLANNING phase.

1. Read \`${baseDir}/CONTEXT.md\` and \`${baseDir}/RESEARCH.md\`
2. Spawn the planner agent:
   \`\`\`
   Task(subagent_type="beast:planner", model="opus", prompt=<CONTEXT.md + RESEARCH.md content>)
   \`\`\`
3. Create directory \`${baseDir}/iterations/01/\`
4. Write output to \`${baseDir}/iterations/01/PLAN.md\`
5. Update state.json: set \`phase\` to \`"pipeline"\`, \`pipeline_actor\` to \`"planner"\`
6. Emit \`<bp-phase-done>\``;

    case 'pipeline:planner':
      return `BEAST-PLAN: Plan created. Now run PARALLEL REVIEW (Skeptic + TDD simultaneously).

1. Read \`${baseDir}/iterations/${iterDir}/PLAN.md\`
2. Spawn BOTH agents simultaneously (in parallel):

   Agent 1 - Skeptic:
   \`\`\`
   Task(subagent_type="beast:skeptic", model="opus", prompt=<PLAN.md + CONTEXT.md summary>)
   \`\`\`

   Agent 2 - TDD Reviewer:
   \`\`\`
   Task(subagent_type="beast:tdd-reviewer", model="sonnet", prompt=<PLAN.md content>)
   \`\`\`

3. Wait for BOTH to complete.
4. Write outputs to \`${baseDir}/iterations/${iterDir}/SKEPTIC-REPORT.md\` and \`TDD-REPORT.md\`
5. Update state.json: set \`pipeline_actor\` to \`"tdd-reviewer"\`
6. Emit \`<bp-phase-done>\``;

    case 'pipeline:skeptic':
      return `BEAST-PLAN: Skeptic review complete. Now run the TDD REVIEW.

1. Read \`${baseDir}/iterations/${iterDir}/PLAN.md\` and \`SKEPTIC-REPORT.md\`
2. Spawn TDD reviewer: Task(subagent_type="beast:tdd-reviewer", model="sonnet", ...)
3. Write output to \`${baseDir}/iterations/${iterDir}/TDD-REPORT.md\`
4. Update state.json: set \`pipeline_actor\` to \`"tdd-reviewer"\`
5. Emit \`<bp-phase-done>\``;

    case 'pipeline:tdd-reviewer':
      return `BEAST-PLAN: TDD review complete. Now run the CRITIC evaluation.

1. Read: PLAN.md, SKEPTIC-REPORT.md, TDD-REPORT.md, CONTEXT.md from \`${baseDir}/iterations/${iterDir}/\`
2. Spawn critic: Task(subagent_type="beast:critic", model="opus", prompt=<all files>)
3. Write output to \`${baseDir}/iterations/${iterDir}/CRITIC-REPORT.md\`
4. Parse verdict, update state.json with critic_verdict, scores, flags
5. Emit \`<bp-phase-done>\``;

    case 'pipeline:critic': {
      if (verdict === 'APPROVED') {
        return `BEAST-PLAN: Plan APPROVED! Now FINALIZE.

1. Copy \`${baseDir}/iterations/${iterDir}/PLAN.md\` to \`${baseDir}/FINAL-PLAN.md\`
2. Present to human: iterations=${iteration}, score from CRITIC-REPORT.md
3. Update state.json: phase="finalize", pipeline_actor=""
4. Emit \`<bp-phase-done>\``;
      }

      const newIter = iteration + 1;
      const newIterDir = pad(newIter);

      // Update state for next iteration
      state.iteration = newIter;
      state.critic_verdict = '';
      state.pipeline_actor = 'planner';
      writeJson(`${baseDir}/state.json`, state);

      if (verdict === 'REVISE') {
        const needsReResearch = flagStr.includes('NEEDS_RE_RESEARCH');
        return needsReResearch
          ? `BEAST-PLAN: REVISION with RE-RESEARCH (iteration ${newIter}).

1. Read Critic report, spawn researcher with targeted scope
2. Append to RESEARCH.md, read ALL feedback, spawn planner
3. Write to \`${baseDir}/iterations/${newIterDir}/PLAN.md\`
4. Update state.json, emit \`<bp-phase-done>\``
          : `BEAST-PLAN: REVISION needed (iteration ${newIter}).

1. Read ALL feedback from iteration ${iteration}
2. Spawn planner: address EVERY issue. Include Revision Notes.
3. Write to \`${baseDir}/iterations/${newIterDir}/PLAN.md\`
4. Update state.json, emit \`<bp-phase-done>\``;
      }

      // REJECT
      if (flagStr.includes('NEEDS_HUMAN_INPUT')) {
        return `BEAST-PLAN: REJECTED — NEEDS_HUMAN_INPUT (iteration ${newIter}).

1. Read Critic report, present questions to human
2. Wait for response. Do NOT emit signals until human responds.
3. Update CONTEXT.md, then continue pipeline.`;
      }
      return `BEAST-PLAN: REJECTED (iteration ${newIter}). Re-research needed.

1. Spawn researcher with targeted scope, append to RESEARCH.md
2. Spawn planner with all context
3. Write to \`${baseDir}/iterations/${newIterDir}/PLAN.md\`
4. Update state.json, emit \`<bp-phase-done>\``;
    }

    case 'finalize:':
      return 'BEAST-PLAN: Finalization complete. Emit <bp-complete> to end the session.';

    // === EXECUTE PHASE ===

    case 'execute:prerequisites':
      return `BEAST: Prerequisites checked. Parse plan into tasks.

1. Read \`${baseDir}/FINAL-PLAN.md\`, extract waves/tasks to \`${baseDir}/tasks.json\`
2. Update state.json: phase="execute", pipeline_actor="running"
3. Begin Wave 1 TDD tasks, emit \`<bp-phase-done>\` after wave completes`;

    case 'execute:running': {
      const wave = state.execution_wave || 0;
      return `BEAST: Wave ${wave} complete. Continue execution.

1. Check \`${baseDir}/tasks.json\` for remaining waves
2. If more: write wave-${wave}-summary.md, begin next wave, emit \`<bp-phase-done>\`
3. If all done: set pipeline_actor="verify", emit \`<bp-phase-done>\``;
    }

    case 'execute:verify':
      return `BEAST: All waves executed. Run verification.

1. Run full test suite, execute real-world verification steps
2. Record in \`${baseDir}/verification-results.md\`
3. Set pipeline_actor="architect", emit \`<bp-phase-done>\``;

    case 'execute:architect':
      return `BEAST: Run architect review.

1. Spawn: Task(subagent_type="beast:architect", model="opus", prompt=<diff + tests + verification>)
2. Write to \`${baseDir}/ARCHITECT-REVIEW.md\`
3. If APPROVED: phase="complete", emit \`<bp-complete>\`
4. If ISSUES: fix, re-test, emit \`<bp-phase-done>\``;

    default:
      return 'BEAST-PLAN: Unknown state. Read .beast-plan/state.json and continue.';
  }
}

export function noSignalPrompt(state) {
  const key = `${state.phase}:${state.pipeline_actor || ''}`;
  const wave = state.execution_wave || 0;

  const prompts = {
    'interview:': null, // allow exit — waiting for user
    'research:': 'BEAST-PLAN: RESEARCH phase. Spawn researcher, write RESEARCH.md, emit <bp-phase-done>.',
    'pipeline:planner': 'BEAST-PLAN: PLANNING phase. Spawn planner, write PLAN.md, emit <bp-phase-done>.',
    'pipeline:skeptic': 'BEAST-PLAN: SKEPTIC phase. Spawn skeptic, write SKEPTIC-REPORT.md, emit <bp-phase-done>.',
    'pipeline:tdd-reviewer': 'BEAST-PLAN: TDD REVIEW phase. Spawn TDD reviewer, emit <bp-phase-done>.',
    'pipeline:critic': 'BEAST-PLAN: CRITIC phase. Spawn critic, write CRITIC-REPORT.md, emit <bp-phase-done>.',
    'finalize:': 'BEAST-PLAN: Finalization in progress. Emit <bp-phase-done>.',
    'execute:prerequisites': 'BEAST: Check prerequisites from FINAL-PLAN.md, emit <bp-phase-done>.',
    'execute:running': `BEAST: Executing wave ${wave}. Continue TDD tasks. Emit <bp-phase-done> when done.`,
    'execute:verify': 'BEAST: Run verification steps, emit <bp-phase-done>.',
    'execute:architect': 'BEAST: Spawn architect agent, emit <bp-phase-done>.',
  };

  return key in prompts ? prompts[key] : 'BEAST-PLAN: Session active but state unclear. Read state.json and continue.';
}

// --- Main ---

function main() {
  const hookInput = JSON.parse(readStdin() || '{}');
  const sessionId = getSessionId(hookInput);
  const transcriptPath = hookInput.transcript_path || '';

  const baseDir = claimSession(sessionId, transcriptPath);
  if (!baseDir) allow();

  const stateFile = `${baseDir}/state.json`;
  if (!existsSync(stateFile)) allow();

  const state = readJson(stateFile);
  if (!state?.active) allow();

  const { iteration = 1, max_iterations: maxIter = 5 } = state;

  // Safety: max iterations
  if (iteration > maxIter) {
    state.phase = 'max_iterations';
    writeJson(stateFile, state);
    block(`BEAST-PLAN: Maximum iterations (${maxIter}) reached. Present the BEST plan to the human.`);
  }

  const lastOutput = getLastOutput(transcriptPath);

  // Signal: complete
  if (lastOutput.includes('<bp-complete>')) {
    state.active = false;
    state.phase = 'complete';
    writeJson(stateFile, state);
    allow();
  }

  // Signal: phase-done
  if (lastOutput.includes('<bp-phase-done>')) {
    const freshState = readJson(stateFile) || state;
    block(planPrompts(baseDir, freshState));
  }

  // No signal — remind or allow
  const prompt = noSignalPrompt(state);
  if (prompt === null) allow();
  block(prompt);
}

// Only run main when executed directly (not imported for testing)
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) main();
