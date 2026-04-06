---
name: content-forge
description: "Content creation pipeline: idea → angle → write → humanize → fact-check → second opinion. For Habr, Telegram, any public content. Plan Iron, Verify Real — but for writing."
---

# Content Forge — Write Iron, Sound Human

Same philosophy as beast-forge: refine until bulletproof, verify independently. But for content, not code.

## When to Use
- Writing a Habr article
- Writing a Telegram channel post
- Any public-facing content
- User says "content-forge", "напиши пост", "статья для хабра"

## Core Principle

Every piece of content goes through the same forge loop as code:
```
IDEA → ANGLE → WRITE → HUMANIZE → FACT-CHECK → VOICE-CHECK → SECOND OPINION
  └── FAIL? → rewrite specific section → re-check
```

## Before Writing: Load Reference

1. Read `docs/articles/reference/merged-style-guide.md` for voice patterns + rules
2. Skim last 5 posts from the target channel to match current tone
3. If Habr: check what's trending, what scores well in target hubs

---

## Pipeline

### 1. ANGLE — find the nerve

Input: raw idea ("напиши про 83 vs 16", "пост про founder journey")

**Research:**
- What's the NERVE? What universal pain does this touch?
- What's the PROMISE? What will the reader get?
- Is this a "+277 idea" (personal, emotional) or a "+3 idea" (product, tutorial)?

**If it's a "+3 idea" → reframe it.** Every technical topic has a personal angle:
- "DOM bug in browser automation" → "я неделю верил что всё работает"
- "Semgrep gotcha rules" → "я превратил список prod-багов в код который их ловит"
- "Multi-tenant leak" → "один process.env и клиент А постил от имени клиента Б"

**Formula:** [Экзистенциальная боль] + [Неожиданный поворот]
- AVOID: "Собрал X", "Сделал Y", "Нашел Z" as openers
- USE: "Кажется, [X]...", "Почему [привычная вещь] больше не работает", "N дней я думал что всё ок"

**Output:** hook (1-2 sentences) + angle + promise

### 2. STRUCTURE

```
1. КРЮК: Боль / провокация / личная история (2-3 предложения)
2. КОНТЕКСТ: "Вот что случилось" (абзац прозы, ровно столько чтобы понять)
3. МЯСО: Конкретика, цифры, код, примеры (основной объём)
4. РЕФЛЕКСИЯ: Что это значит шире (1-2 абзаца, не морализаторство)
5. ВЫХОД: Вопрос к аудитории / forward-looking / ссылка
```

**Anti-patterns:**
- NO "в этой статье я расскажу..."
- NO "подведём итоги"
- NO "это был ценный опыт"
- NO bullet-point "выводы" в конце
- NO call to action кроме канала в самом конце
- NO мотивационные цитаты

### 3. WRITE (model: opus)

**Voice (from merged-style-guide):**

Sentence level:
- Lowercase начало абзацев допустимо (~30%)
- Чередовать короткие панчи ("Дашборд зелёный.") с длинными объяснениями
- Абзацы 1-3 предложения. Редко больше 4 строк
- Тире для ритма, но не в каждом предложении

Fillers (natural, use sparingly):
- "ну типа", "короче", "прям", "вот тут", "в общем", "лол"

Emoji:
- 😁 — основной, после самоиронии
- 👇 — CTA в конце
- 🔥 — для призыва к поддержке (редко)
- NEVER: 🙏❤️💪🚀 (мотивационные)

Code-switching:
- Технические термины на английском без перевода
- Иногда целые фразы для эффекта

Self-reference:
- "я" в нижнем регистре
- Открыто про провалы, ошибки, страхи
- Не рисовать картинку успеха

**Rules:**
- Every fact MUST be true (names, numbers, dates — verify against git/memory)
- Every code snippet MUST be real (from actual codebase)
- Every emotion MUST be earned (by the story, not by adjectives)

### 4. HUMANIZE

Scan for and kill AI patterns:
- [ ] AI vocabulary: crucial, landscape, delve, foster, underscore, enhance, showcase, vibrant, pivotal, testament → replace with simple words
- [ ] Em dash overuse: if >5 per post → replace extras with commas/periods
- [ ] Rule of three: forced groups of 3 → break or reduce
- [ ] Significance inflation: "marking a pivotal moment" → just say what happened
- [ ] Negative parallelisms: "it's not just X, it's Y" → cut
- [ ] Copula avoidance: "serves as" → "is"
- [ ] Generic conclusions: "the future looks bright" → concrete next step or open question
- [ ] Sycophantic tone: "Great question!" → cut
- [ ] Superficial -ing phrases: "highlighting", "showcasing", "reflecting" → cut or rephrase
- [ ] Curly quotes: " " → " "

### 5. FACT-CHECK

Every claim against reality:
- **Project names:** match actual projects (Budget Vision, Noizer One, RepBoost, Viral Twin — NOT invented ones)
- **Numbers:** verified from git/DB/memory, not rounded or invented
- **Code snippets:** exist in codebase at referenced paths
- **Timeline:** dates match git history
- **Quotes:** real quotes only

Unverifiable claim → remove or soften to "around X" / "roughly".

### 6. VOICE-CHECK

Compare draft against last 10 channel posts:
- Does this sound like the same person?
- Would this fit naturally between the other posts?
- Is there anything that screams "AI wrote this"?
- Is it too clean/structured?
- Would the author actually say this out loud?

Specific checks:
- Are there fillers? (should be some — too clean = AI)
- Is there self-deprecation? (should be — it's the author's signature)
- Lowercase starts where natural?
- Any corporate/formal language? (kill it)

### 7. SECOND OPINION

**For Habr articles (high stakes):**

Check codex availability: `which codex`

If available:
```bash
codex exec "You are a Habr.com reader who hates AI-hype articles. 
  Read this article. Score 1-10: would you upvote? 
  What would trigger you to comment? 
  What would make you close the tab? 
  Be honest, be harsh." \
  -C $(pwd) -s read-only -c 'model_reasoning_effort="high"'
```

If unavailable: fresh opus agent with same adversarial prompt.

Also check:
- Does the title promise what the content delivers?
- Is there a clear nerve being hit?
- Would someone forward this with "посмотри, прям про нас"?

**For Telegram posts (lower stakes):**
- Voice-check + humanizer is enough
- Skip codex/second opinion

### 8. PLATFORM-SPECIFIC

**Habr:**
- Title: MUST hit a nerve. Generate 3 variants, pick the one that hurts most.
- Hubs: choose for AUDIENCE, not topic. "Тестирование", "DevOps" > "AI", "ML"
- Avoid "AI" in title if article is about engineering (anti-AI bias on Habr)
- Timing: weekday morning (Tue-Thu), NOT weekends
- Length: 1500-3000 words
- Format: "Кейс" for stories, "Мнение" for takes
- End: channel link as one-liner, not a pitch

**Telegram:**
- Length: 150-400 words
- Lowercase casual
- One idea per post
- Optional: 😁 or 👇 (not both)
- No hashtags
- Link to Habr if cross-posting

---

## Flags
```
/content-forge "idea"                    — full pipeline (default: TG post)
/content-forge --habr "idea"             — Habr article (3 title variants, full pipeline + codex)
/content-forge --tg "idea"               — Telegram post (short, voice-check only)
/content-forge --humanize <file>         — run existing text through steps 4-7 only
/content-forge --reframe "existing idea" — find the "+277 angle" on a "+3 idea"
```

---

## Reference Files

The skill uses these reference files when available:
- `docs/articles/reference/merged-style-guide.md` — voice patterns, rules, anti-patterns, checklist
- `docs/articles/reference/malakhovdm-tg-dump.json` — author's channel posts for voice matching
- `docs/articles/reference/pavlenkopro-tg-dump.json` — reference channel for hit patterns
- `docs/articles/reference/vital-habr-*` — Habr articles + comments for audience modeling

If reference files don't exist, the skill still works — it just uses the rules in this SKILL.md.
