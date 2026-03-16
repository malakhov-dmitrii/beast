#!/bin/bash
# Tests for beast plugin structure
# NOTE: No set -euo pipefail — matches established test pattern

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$SCRIPT_DIR/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0

echo "Plugin structure tests"
echo "======================"
echo

# Test 1: plugin.json exists and is valid JSON
echo -n "Testing: plugin.json is valid JSON ... "
if jq '.' "$PLUGIN_ROOT/.claude-plugin/plugin.json" > /dev/null 2>&1; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 2: Plugin name is "beast"
echo -n "Testing: plugin name is 'beast' ... "
NAME=$(jq -r '.name' "$PLUGIN_ROOT/.claude-plugin/plugin.json")
if [[ "$NAME" == "beast" ]]; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} (got: $NAME)"
  FAIL=$((FAIL + 1))
fi

# Test 3: Version is 2.x.x
echo -n "Testing: version is 2.x.x ... "
VERSION=$(jq -r '.version' "$PLUGIN_ROOT/.claude-plugin/plugin.json")
if [[ "$VERSION" == 2.* ]]; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} (got: $VERSION)"
  FAIL=$((FAIL + 1))
fi

# Test 4: skills/beast/SKILL.md exists
echo -n "Testing: skills/beast/SKILL.md exists ... "
if [[ -f "$PLUGIN_ROOT/skills/beast/SKILL.md" ]]; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 5: skills/beast-plan/SKILL.md exists (backward compat)
echo -n "Testing: skills/beast-plan/SKILL.md exists (backward compat) ... "
if [[ -f "$PLUGIN_ROOT/skills/beast-plan/SKILL.md" ]]; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 6: beast SKILL.md has plan and execute commands
echo -n "Testing: beast SKILL.md has plan and execute phases ... "
BEAST_SKILL="$PLUGIN_ROOT/skills/beast/SKILL.md"
if grep -q "beast plan" "$BEAST_SKILL" && grep -q "beast execute" "$BEAST_SKILL"; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 7: beast SKILL.md uses .beast-plan/ for sessions (not .beast-council/)
echo -n "Testing: beast SKILL.md uses .beast-plan/ sessions ... "
if grep -q "\.beast-plan/" "$BEAST_SKILL" && ! grep -q "\.beast-council/" "$BEAST_SKILL"; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 8: hooks.json exists
echo -n "Testing: hooks/hooks.json exists ... "
if [[ -f "$PLUGIN_ROOT/hooks/hooks.json" ]]; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 9: stop-hook.sh is executable or exists
echo -n "Testing: hooks/stop-hook.sh exists ... "
if [[ -f "$PLUGIN_ROOT/hooks/stop-hook.sh" ]]; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 10: stop-hook.sh has valid bash syntax
echo -n "Testing: stop-hook.sh has valid bash syntax ... "
if bash -n "$PLUGIN_ROOT/hooks/stop-hook.sh" 2>/dev/null; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC}"
  FAIL=$((FAIL + 1))
fi

# Test 11: All 7 commands exist
echo -n "Testing: all 7 command files exist ... "
CMD_COUNT=$(ls "$PLUGIN_ROOT/commands/"*.md 2>/dev/null | wc -l | tr -d ' ')
if [[ "$CMD_COUNT" -eq 7 ]]; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} (found $CMD_COUNT, expected 7)"
  FAIL=$((FAIL + 1))
fi

# Test 12: No stale beast-plan: subagent refs in agents or new skill
echo -n "Testing: no stale beast-plan: subagent refs ... "
if ! grep -r "beast-plan:" "$PLUGIN_ROOT/agents/" "$PLUGIN_ROOT/skills/beast/SKILL.md" 2>/dev/null | grep -q "subagent_type"; then
  echo -e "${GREEN}PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} (stale beast-plan: subagent refs found)"
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
