# Beast

**Plan-to-code pipeline for Claude Code.** Give it a complex feature. Get back a bulletproof plan verified by 5 specialized agents. Then execute it with TDD, parallel agents, and real-world verification.

```
/beast plan "Add user authentication with OAuth"

  P1: Explorer → codebase summary
  P2: Adaptive Discussion → resolve ambiguities
  P3: Researcher → deep investigation
  P4: [Planner → Skeptic + TDD Review → Critic] ×N → consensus plan
       ↓
  FINAL-PLAN.md (approval gate — you review before executing)

/beast execute

  E0: Load plan → E1: Prerequisites check
  E2: Parse tasks → E3: TDD execution (parallel per wave)
  E4: Integration tests → E5: Real-world verification
  E5.5: Auto-fix loop → E6: Architect review
  E6.5: Code simplify → E7: Demo → Done
```

## Why

Plans have blind spots. You write steps 1-4 perfectly, then step 5 says "integrate with auth middleware" with zero details. That's where everything breaks.

Beast's Skeptic catches every "we'll figure it out later" and forces the Planner to be honest. The Critic scores the plan out of 25 — below 20 means back to the drawing board. Only when the plan is bulletproof does execution begin.

Then execution runs with strict TDD discipline: RED (failing test) → GREEN (minimal code) → REFACTOR. Parallel agents handle independent tasks. A bounded QA fixer auto-repairs common failures. An architect reviews everything before you see it.

## Install

```bash
claude plugin install https://github.com/malakhov-dmitrii/beast.git
```

Verify:
```bash
claude plugin list
# Should show: beast
```

## Commands

| Command | What it does |
|---------|-------------|
| `/beast plan "task"` | Full planning pipeline → stops at approval gate |
| `/beast execute` | Load approved plan → TDD execution to completion |
| `/beast status` | Show all sessions (active, pending, completed) |
| `/cancel-beast` | Cancel active session(s) |

## How It Works

### Planning Phase (`/beast plan`)

1. **Explorer** maps the codebase — structure, tech stack, test infrastructure, patterns
2. **Adaptive Discussion** interviews you about ambiguities — but only genuine ones. If the answer is in the codebase, it decides autonomously. Questions come with options, analysis, and recommendations
3. **Researcher** deep-dives dependencies, APIs, schemas, existing patterns
4. **Planner** creates a wave-ordered, TDD-first implementation plan with concrete test cases
5. **Skeptic + TDD Reviewer** run in parallel — one hunts mirages (claims that sound right but are wrong), the other checks TDD compliance
6. **Critic** scores /25 — APPROVED (20+), REVISE (15-19), or REJECT (<15). Loop continues until consensus

Result: `FINAL-PLAN.md` that a fresh Claude session can execute without asking a single question.

### Execution Phase (`/beast execute`)

1. **Prerequisites Check** — verifies all API keys, dependencies, infrastructure before coding
2. **TDD Execution** — RED→GREEN→REFACTOR for every task, parallel agents per wave
3. **Wave Integration Tests** — cross-component verification after each wave
4. **Real-World Verification** — browser testing, API calls, bot interactions (not just unit tests)
5. **Auto-Fix Loop** — bounded diagnosis→fix cycles for common failures (max 5)
6. **Architect Review** — final code review against plan and quality standards
7. **Code Simplify** — automatic cleanup of modified files (preserves all functionality)

## 10 Specialized Agents

| Agent | Model | Role |
|-------|-------|------|
| Explorer | Sonnet | Quick codebase mapping |
| Researcher | Sonnet | Deep investigation with confidence tagging |
| Planner | Opus | TDD-embedded plan creation |
| Skeptic | Opus | Mirage detection — verifies claims against reality |
| TDD Reviewer | Sonnet | Test-first compliance checking |
| Critic | Opus | Final quality gate, scores /25 |
| Executor | Sonnet | TDD implementation (RED→GREEN→REFACTOR) |
| QA Fixer | Sonnet | Bounded test-fix loop (max 5 cycles) |
| Architect | Opus | Code review + content quality check |
| Simplifier | Opus | Post-approval code cleanup |

## The Skeptic Hunts 10 Mirage Patterns

1. **Phantom APIs** — references endpoints that don't exist
2. **Version mismatches** — assumes features from wrong library version
3. **Missing error paths** — happy path only
4. **Wrong assumptions** — "this returns an array" when it returns null
5. **Dependency conflicts** — incompatible packages
6. **Race conditions** — concurrent access not handled
7. **Config gaps** — env vars, secrets, permissions not specified
8. **Schema drift** — plan assumes schema that doesn't match reality
9. **Auth blindness** — ignores permissions, tokens, sessions
10. **Test theater** — tests that pass but don't verify behavior

## Structure

```
beast/
├── .claude-plugin/
│   └── plugin.json           # Plugin metadata (name: "beast", version: "2.0.0")
├── agents/
│   ├── researcher.md          # Deep research with confidence tagging
│   ├── planner.md             # TDD-embedded plan creation
│   ├── skeptic.md             # Mirage detection specialist
│   ├── tdd-reviewer.md        # Test-first compliance checker
│   ├── critic.md              # Final quality gate (scores /25)
│   ├── explorer.md            # Quick codebase mapping
│   ├── executor.md            # TDD implementation agent
│   ├── architect.md           # Code review (read-only)
│   ├── simplifier.md          # Code cleanup specialist
│   └── qa-fixer.md            # Bounded test-fix loop
├── commands/
│   ├── beast.md               # Main router (/beast plan, /beast execute)
│   ├── beast-execute.md       # Direct execute shortcut
│   ├── beast-status.md        # Session status
│   └── cancel-beast.md        # Cancel sessions
├── hooks/
│   ├── hooks.json             # Stop hook registration
│   ├── stop-hook.sh           # State machine driving plan + execute loops
│   └── discover-skills.sh     # Domain skill discovery
├── skills/
│   ├── beast/
│   │   └── SKILL.md           # Full plan+execute orchestration protocol
│   └── beast-plan/
│       └── SKILL.md           # v1 planning-only protocol (backward compat)
└── tests/
    ├── test-stop-hook-execute.sh    # Execute phase hook tests
    ├── test-stop-hook-integration.sh # Planning phase hook tests
    └── test-discover-skills.sh       # Skill discovery tests
```

## Session Storage

Sessions live in `.beast-plan/` within your project:

```
.beast-plan/
├── pending-{timestamp}/      # Unclaimed session (pre-hook)
└── sessions/{session-id}/    # Active/completed session
    ├── state.json            # Full state tracking
    ├── CONTEXT.md            # Requirements + decisions
    ├── RESEARCH.md           # Research findings
    ├── FINAL-PLAN.md         # Approved plan (approval gate)
    ├── tasks.json            # Execution task tracker
    ├── wave-N-summary.md     # Per-wave execution summary
    ├── iterations/
    │   └── NN/
    │       ├── PLAN.md
    │       ├── SKEPTIC-REPORT.md
    │       ├── TDD-REPORT.md
    │       └── CRITIC-VERDICT.md
    └── logs/
        └── events.jsonl
```

Add `.beast-plan/` to `.gitignore`.

## Multi-Session Support

Run multiple sessions concurrently in the same project:

```
/beast plan "Add authentication"    # Terminal 1
/beast plan "Add payment processing" # Terminal 2

/beast status
SESSION ID   STATUS    PHASE      COMMAND  ITER  WAVE
abc123      ✓ active   pipeline   plan     2/5   -
def456      ✓ active   interview  plan     1/5   -
```

## Troubleshooting

### "No such skill" error
1. `claude plugin list` — verify beast is installed
2. `claude plugin install https://github.com/malakhov-dmitrii/beast.git` — reinstall
3. Restart Claude Code
4. Try `/beast plan "test"` again

### Stale sessions
```
/beast status        # Shows stale sessions
/cancel-beast        # Clean them up
```

### Hook not executing
```bash
ls ~/.claude/plugins/cache/*/beast/*/hooks/stop-hook.sh
chmod +x ~/.claude/plugins/cache/*/beast/*/hooks/stop-hook.sh
```

## License

MIT
