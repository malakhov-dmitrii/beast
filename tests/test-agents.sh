#!/bin/bash
# Tests for beast agent definitions
# NOTE: No set -euo pipefail — matches established test pattern

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_DIR="$SCRIPT_DIR/../agents"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0

echo "Agent definition tests"
echo "======================"
echo

# Expected agents
AGENTS="researcher planner skeptic tdd-reviewer critic explorer executor architect simplifier qa-fixer"

# Test 1: All 10 agents exist
for agent in $AGENTS; do
  echo -n "Testing: agents/${agent}.md exists ... "
  if [[ -f "$AGENTS_DIR/${agent}.md" ]]; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC}"
    FAIL=$((FAIL + 1))
  fi
done

# Test 2: All agents have required frontmatter fields
for agent in $AGENTS; do
  echo -n "Testing: ${agent}.md has name/model/tools frontmatter ... "
  if grep -q "^name:" "$AGENTS_DIR/${agent}.md" && \
     grep -q "^model:" "$AGENTS_DIR/${agent}.md" && \
     grep -q "^tools:" "$AGENTS_DIR/${agent}.md"; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC} (missing frontmatter)"
    FAIL=$((FAIL + 1))
  fi
done

# Test 3: Model assignments are correct
echo -n "Testing: opus agents (planner, skeptic, critic, architect, simplifier) ... "
OPUS_OK=true
for agent in planner skeptic critic architect simplifier; do
  if ! grep -q "^model: opus" "$AGENTS_DIR/${agent}.md"; then
    OPUS_OK=false
  fi
done
if $OPUS_OK; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

echo -n "Testing: sonnet agents (researcher, tdd-reviewer, explorer, executor, qa-fixer) ... "
SONNET_OK=true
for agent in researcher tdd-reviewer explorer executor qa-fixer; do
  if ! grep -q "^model: sonnet" "$AGENTS_DIR/${agent}.md"; then
    SONNET_OK=false
  fi
done
if $SONNET_OK; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 4: Architect is read-only (no Write/Edit in tools)
echo -n "Testing: architect.md is read-only (no Write/Edit tools) ... "
ARCH_TOOLS=$(grep "^tools:" "$AGENTS_DIR/architect.md")
if echo "$ARCH_TOOLS" | grep -q "Write\|Edit"; then
  echo -e "${RED}FAIL${NC} (architect has Write/Edit tools)"
  FAIL=$((FAIL + 1))
else
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
fi

# Test 5: Executor HAS Write/Edit
echo -n "Testing: executor.md has Write and Edit tools ... "
EXEC_TOOLS=$(grep "^tools:" "$AGENTS_DIR/executor.md")
if echo "$EXEC_TOOLS" | grep -q "Write" && echo "$EXEC_TOOLS" | grep -q "Edit"; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 6: No agent uses LS tool (doesn't exist in Claude Code)
echo -n "Testing: no agent uses LS tool in frontmatter ... "
if ! grep "^tools:" "$AGENTS_DIR"/*.md 2>/dev/null | grep -q " LS"; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} (agents reference LS in tools)"
  FAIL=$((FAIL + 1))
fi

echo
echo "======================"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo

if [[ $FAIL -eq 0 ]]; then
  exit 0
else
  exit 1
fi
