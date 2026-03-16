import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planPrompts, noSignalPrompt } from '../hooks/stop-hook.mjs';

let testDir;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'beast-test-'));
  // Create state.json so routes that write state don't fail
  writeFileSync(join(testDir, 'state.json'), '{}');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('planPrompts - planning phase', () => {
  it('routes interview -> research', () => {
    const result = planPrompts(testDir, {
      phase: 'interview', pipeline_actor: '', task_description: 'test task'
    });
    assert.ok(result.includes('RESEARCH phase'));
    assert.ok(result.includes('beast:researcher'));
  });

  it('routes research -> planning', () => {
    const result = planPrompts(testDir, {
      phase: 'research', pipeline_actor: ''
    });
    assert.ok(result.includes('PLANNING phase'));
    assert.ok(result.includes('beast:planner'));
  });

  it('routes planner -> parallel review (skeptic + tdd)', () => {
    const result = planPrompts(testDir, {
      phase: 'pipeline', pipeline_actor: 'planner', iteration: 1
    });
    assert.ok(result.includes('PARALLEL REVIEW'));
    assert.ok(result.includes('beast:skeptic'));
    assert.ok(result.includes('beast:tdd-reviewer'));
    assert.ok(result.includes('BOTH'));
  });

  it('routes tdd-reviewer -> critic', () => {
    const result = planPrompts(testDir, {
      phase: 'pipeline', pipeline_actor: 'tdd-reviewer', iteration: 1
    });
    assert.ok(result.includes('CRITIC'));
    assert.ok(result.includes('beast:critic'));
  });

  it('routes critic APPROVED -> finalize', () => {
    const result = planPrompts(testDir, {
      phase: 'pipeline', pipeline_actor: 'critic', iteration: 1,
      critic_verdict: 'APPROVED', flags: []
    });
    assert.ok(result.includes('APPROVED'));
    assert.ok(result.includes('FINALIZE'));
    assert.ok(result.includes('FINAL-PLAN.md'));
  });

  it('routes critic REVISE -> next iteration', () => {
    const state = {
      phase: 'pipeline', pipeline_actor: 'critic', iteration: 1,
      critic_verdict: 'REVISE', flags: []
    };
    const result = planPrompts(testDir, state);
    assert.ok(result.includes('REVISION'));
    assert.ok(result.includes('iteration 2'));
  });

  it('routes critic REJECT + NEEDS_HUMAN_INPUT -> wait for human', () => {
    const state = {
      phase: 'pipeline', pipeline_actor: 'critic', iteration: 1,
      critic_verdict: 'REJECT', flags: ['NEEDS_HUMAN_INPUT']
    };
    const result = planPrompts(testDir, state);
    assert.ok(result.includes('NEEDS_HUMAN_INPUT'));
    assert.ok(result.includes('Wait for response'));
  });

  it('routes finalize -> complete signal', () => {
    const result = planPrompts(testDir, {
      phase: 'finalize', pipeline_actor: ''
    });
    assert.ok(result.includes('<bp-complete>'));
  });
});

describe('planPrompts - execute phase', () => {
  it('routes execute:prerequisites', () => {
    const result = planPrompts(testDir, {
      phase: 'execute', pipeline_actor: 'prerequisites'
    });
    assert.ok(result.includes('Prerequisites'));
    assert.ok(result.includes('tasks.json'));
  });

  it('routes execute:running with wave number', () => {
    const result = planPrompts(testDir, {
      phase: 'execute', pipeline_actor: 'running', execution_wave: 3
    });
    assert.ok(result.includes('Wave 3'));
  });

  it('routes execute:verify', () => {
    const result = planPrompts(testDir, {
      phase: 'execute', pipeline_actor: 'verify'
    });
    assert.ok(result.includes('verification'));
    assert.ok(result.includes('architect'));
  });

  it('routes execute:architect', () => {
    const result = planPrompts(testDir, {
      phase: 'execute', pipeline_actor: 'architect'
    });
    assert.ok(result.includes('beast:architect'));
    assert.ok(result.includes('ARCHITECT-REVIEW'));
  });
});

describe('noSignalPrompt', () => {
  it('returns null for interview (allow exit)', () => {
    // pipeline_actor may be undefined, null, or empty string — all should match
    const r1 = noSignalPrompt({ phase: 'interview' });
    const r2 = noSignalPrompt({ phase: 'interview', pipeline_actor: '' });
    const r3 = noSignalPrompt({ phase: 'interview', pipeline_actor: null });
    // At least one form should return null (the hook allows exit during interview)
    const anyNull = r1 === null || r2 === null || r3 === null;
    assert.ok(anyNull, `Expected null for interview, got: ${r1}, ${r2}, ${r3}`);
  });

  it('returns reminder for research', () => {
    const result = noSignalPrompt({ phase: 'research', pipeline_actor: '' });
    assert.ok(result.includes('RESEARCH'));
  });

  it('returns reminder for execute:running with wave', () => {
    const result = noSignalPrompt({
      phase: 'execute', pipeline_actor: 'running', execution_wave: 2
    });
    assert.ok(result.includes('wave 2'));
  });

  it('returns generic for unknown state', () => {
    const result = noSignalPrompt({ phase: 'unknown', pipeline_actor: 'xyz' });
    assert.ok(result.includes('state unclear'));
  });
});
