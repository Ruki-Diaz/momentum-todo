/**
 * Momentum — Smart typing: understands dates, times, priority, repeats and #tags
 * written naturally in a task title ("Call John tomorrow at 3pm, high priority").
 * Classic script: shares global scope with the other files in /js, loaded in order by index.html.
 *
 * SmartInput.parse() is pure (no DOM) so tests can run it in a node `vm` context.
 * SmartInput.bindComposer() wires a composer's input, fields, chips and hint in the browser.
 */

const SmartInput = (() => {
  const WD_FULL = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const WD_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WD_ABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  // Short forms that are also everyday words ("sat", "sun", "wed") need "on"/"by" in front.
  const WD_SAFE_BARE = new Set(["mon", "tue", "tues", "thu", "thur", "thurs", "fri"]);
  const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
    jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };
  const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

  const WD = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun";
  const MON = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
  const PREP = "(?:(?:on|by|due|for|until|till)\\s+)?";

  // ---------- date helpers (all local time, midnight-based) ----------
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekdayIndex = (word) => {
    const w = word.toLowerCase();
    const full = WD_FULL.indexOf(w);
    return full >= 0 ? full : WD_ABBR[w];
  };
  /** Next date falling on `dow` (0 = Sunday). Today counts when includeToday. */
  const coming = (today, dow, includeToday = true) => {
    let diff = (dow - today.getDay() + 7) % 7;
    if (diff === 0 && !includeToday) diff = 7;
    return addDays(today, diff);
  };
  /** Monday of next week (weeks start on Monday). */
  const nextMonday = (today) => addDays(today, 7 - ((today.getDay() + 6) % 7));
  const validDay = (y, m, d) => m >= 0 && m <= 11 && d >= 1 && d <= new Date(y, m + 1, 0).getDate();
  /** A calendar date; without an explicit year, dates already passed roll to next year. */
  const calendarDate = (today, month, day, year) => {
    if (year != null) {
      const y = year < 100 ? 2000 + year : year;
      return validDay(y, month, day) ? new Date(y, month, day) : null;
    }
    let y = today.getFullYear();
    if (!validDay(y, month, day) && !validDay(y + 1, month, day)) return null;
    let d = new Date(y, month, day);
    if (!validDay(y, month, day) || d < today) {
      y += 1;
      if (!validDay(y, month, day)) return null;
      d = new Date(y, month, day);
    }
    return d;
  };

  // ---------- plain-English labels ----------
  function dateLabel(d, today) {
    const diff = Math.round((startOfDay(d) - today) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff > 1 && diff < 7) return WD_LABEL[d.getDay()];
    const base = `${WD_SHORT[d.getDay()]} ${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
    return d.getFullYear() === today.getFullYear() ? base : `${base} ${d.getFullYear()}`;
  }
  function timeLabel(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  }
  const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  // ---------- rules ----------
  // Each rule: { type, re, read(match, ctx) → { value, label, impliedTime?, impliedDate? } | null }
  const RULES = [
    // Tags
    {
      type: "tag",
      re: /#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu,
      read(m, ctx) {
        const before = ctx.text[m.index - 1];
        if (before && /[\p{L}\p{N}_#]/u.test(before)) return null;
        const tag = m[1].toLowerCase();
        return { value: tag, label: `#${tag}` };
      }
    },

    // Repeats
    {
      type: "recurrence",
      re: /\b(?:(?:every|each)\s+weekdays?|(?:on\s+)?weekdays)\b/gi,
      read: () => ({ value: { rule: "weekdays" }, label: "Every weekday" })
    },
    {
      type: "recurrence",
      re: /\b(?:(?:every|each)\s+day|everyday)\b/gi,
      read: () => ({ value: { rule: "daily" }, label: "Every day" })
    },
    {
      type: "recurrence",
      re: new RegExp(`\\b(?:every|each)\\s+(${WD})\\b`, "gi"),
      read: (m) => {
        const dow = weekdayIndex(m[1]);
        return { value: { rule: "weekly", dow }, label: `Every ${WD_LABEL[dow]}` };
      }
    },
    {
      type: "recurrence",
      re: /\b(?:every|each)\s+week\b/gi,
      read: () => ({ value: { rule: "weekly" }, label: "Every week" })
    },
    {
      type: "recurrence",
      re: /\b(?:every|each)\s+month\b/gi,
      read: () => ({ value: { rule: "monthly" }, label: "Every month" })
    },
    {
      // Bare adverbs only at the end or before another detail, so "Write weekly report" stays a title.
      type: "recurrence",
      re: /\b(daily|weekly|monthly)\b(?=\s*$|\s*[,.;!?#]|\s+(?:at|on|by|from|starting|\d))/gi,
      read: (m) => {
        const rule = m[1].toLowerCase();
        const label = { daily: "Every day", weekly: "Every week", monthly: "Every month" }[rule];
        return { value: { rule }, label };
      }
    },

    // Dates
    {
      type: "date",
      re: new RegExp(`\\b${PREP}(?:the\\s+)?day\\s+after\\s+tomorrow\\b`, "gi"),
      read: (m, ctx) => ({ value: addDays(ctx.today, 2) })
    },
    {
      type: "date",
      re: new RegExp(`\\b${PREP}(?:tomorrow|tmrw|tmr)\\b`, "gi"),
      read: (m, ctx) => ({ value: addDays(ctx.today, 1) })
    },
    {
      type: "date",
      re: new RegExp(`\\b${PREP}today\\b`, "gi"),
      read: (m, ctx) => ({ value: ctx.today })
    },
    {
      type: "date",
      re: /\b(?:(?:by|for)\s+)?tonight\b/gi,
      read: (m, ctx) => ({ value: ctx.today, label: "Tonight", impliedTime: "20:00" })
    },
    {
      type: "date",
      re: /\b(?:(?:by|before)\s+)?(?:the\s+)?(?:end\s+of\s+(?:the\s+)?week|eow)\b/gi,
      read: (m, ctx) => {
        const monIdx = (ctx.today.getDay() + 6) % 7; // Monday = 0 … Sunday = 6
        return { value: addDays(ctx.today, monIdx <= 4 ? 4 - monIdx : 11 - monIdx) };
      }
    },
    {
      type: "date",
      re: /\b(?:(?:by|before)\s+)?(?:the\s+)?(?:end\s+of\s+(?:the\s+)?month|eom)\b/gi,
      read: (m, ctx) => ({ value: new Date(ctx.today.getFullYear(), ctx.today.getMonth() + 1, 0) })
    },
    {
      type: "date",
      re: new RegExp(`\\b${PREP}next\\s+week\\b`, "gi"),
      read: (m, ctx) => ({ value: nextMonday(ctx.today) })
    },
    {
      type: "date",
      re: /\bin\s+(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(days?|weeks?)\b/gi,
      read: (m, ctx) => {
        const raw = m[1].toLowerCase();
        const n = /^\d+$/.test(raw) ? Number(raw) : NUM_WORDS[raw];
        if (!n) return null;
        return { value: addDays(ctx.today, /^week/i.test(m[2]) ? n * 7 : n) };
      }
    },
    {
      type: "date",
      re: new RegExp(`\\b${PREP}(this|next)\\s+(${WD})\\b`, "gi"),
      read: (m, ctx) => {
        const dow = weekdayIndex(m[2]);
        if (m[1].toLowerCase() === "this") return { value: coming(ctx.today, dow) };
        return { value: addDays(nextMonday(ctx.today), (dow + 6) % 7) };
      }
    },
    {
      type: "date",
      re: new RegExp(`\\b(?:(on|by|due|for|until|till)\\s+)?(${WD})\\b`, "gi"),
      read: (m, ctx) => {
        const word = m[2].toLowerCase();
        if (!m[1] && word in WD_ABBR && !WD_SAFE_BARE.has(word)) return null;
        return { value: coming(ctx.today, weekdayIndex(word)) };
      }
    },
    {
      // 15 Oct, 15th October, the 15th of October, 15 Oct 2027
      type: "date",
      re: new RegExp(`\\b${PREP}(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MON})\\.?(?:\\s+(\\d{4}))?\\b`, "gi"),
      read: (m, ctx) => {
        const d = calendarDate(ctx.today, MONTHS[m[2].toLowerCase()], Number(m[1]), m[3] ? Number(m[3]) : null);
        return d ? { value: d } : null;
      }
    },
    {
      // Oct 15, October 15th, Oct 15, 2027 — a month name alone ("Call May") is never a date.
      type: "date",
      re: new RegExp(`\\b${PREP}(${MON})\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, "gi"),
      read: (m, ctx) => {
        const d = calendarDate(ctx.today, MONTHS[m[1].toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : null);
        return d ? { value: d } : null;
      }
    },
    {
      // 15/10 (day/month) or 10/15 (month/day in en-US); falls back to the other order if invalid.
      type: "date",
      re: new RegExp(`\\b${PREP}(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2}|\\d{4}))?\\b`, "gi"),
      read: (m, ctx) => {
        const before = ctx.text[m.index - 1];
        const after = ctx.text[m.index + m[0].length];
        if (before === "/" || after === "/") return null;
        const a = Number(m[1]);
        const b = Number(m[2]);
        const year = m[3] ? Number(m[3]) : null;
        const monthFirst = /^en-us$/i.test(ctx.locale || "");
        const tries = monthFirst ? [[a, b], [b, a]] : [[b, a], [a, b]];
        for (const [month, day] of tries) {
          const d = calendarDate(ctx.today, month - 1, day, year);
          if (d) return { value: d };
        }
        return null;
      }
    },

    // Times
    {
      type: "time",
      re: /\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s?([ap])\.?m\b\.?/gi,
      read: (m) => {
        let h = Number(m[1]);
        const min = m[2] ? Number(m[2]) : 0;
        if (h < 1 || h > 12 || min > 59) return null;
        const pm = m[3].toLowerCase() === "p";
        if (pm && h !== 12) h += 12;
        if (!pm && h === 12) h = 0;
        return { value: hhmm(h, min) };
      }
    },
    {
      type: "time",
      re: /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]\.?m\b)/gi,
      read: (m) => ({ value: hhmm(Number(m[1]), Number(m[2])) })
    },
    {
      type: "time",
      re: /\b(?:at\s+)?(?:noon|midday)\b/gi,
      read: () => ({ value: "12:00", label: "Noon" })
    },
    {
      type: "time",
      re: /\b(?:(?:by|before|at)\s+)?(?:eod|(?:the\s+)?end\s+of\s+(?:the\s+)?day)\b/gi,
      read: () => ({ value: "17:00", label: "End of day (5:00 PM)" })
    },
    {
      // "morning" only counts next to a date or as a clear phrase, so "Morning standup" stays a title.
      type: "time",
      re: /\b(in\s+the\s+|this\s+)?(morning|afternoon|evening)\b/gi,
      read: (m, ctx) => {
        const before = ctx.text.slice(0, m.index);
        const after = ctx.text.slice(m.index + m[0].length);
        const nextToDate = new RegExp(`(?:today|tomorrow|tmrw|tmr|${WD}|\\d)\\s*$`, "i").test(before);
        const atEnd = /^\s*(?:$|[,.;!?#])/.test(after);
        if (!m[1] && !nextToDate && !atEnd) return null;
        const part = m[2].toLowerCase();
        const value = { morning: "09:00", afternoon: "14:00", evening: "18:00" }[part];
        const res = { value, label: `${capitalizeWord(part)} (${timeLabel(value)})` };
        if (m[1] && /^this/i.test(m[1])) res.impliedDate = ctx.today;
        return res;
      }
    },

    // Priority
    {
      type: "priority",
      re: /\b(?:high[\s-]+priority|priority[\s:]+high|urgent(?:ly)?|asap|important)\b|!{2,}/gi,
      read: () => ({ value: "high", label: "High priority" })
    },
    {
      type: "priority",
      re: /\b(?:low[\s-]+priority|priority[\s:]+low|whenever|some\s?day)\b/gi,
      read: () => ({ value: "low", label: "Low priority" })
    },
    {
      type: "priority",
      re: /\b(?:medium[\s-]+priority|priority[\s:]+medium|normal\s+priority)\b/gi,
      read: () => ({ value: "medium", label: "Medium priority" })
    }
  ];

  function capitalizeWord(w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  function quotedRanges(text) {
    const ranges = [];
    const re = /"[^"]*"|“[^”]*”/g;
    let m;
    while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
    return ranges;
  }

  function tidyTitle(t) {
    let s = t.replace(/\s+/g, " ");
    s = s.replace(/\s+([,.;:!?])/g, "$1");
    s = s.replace(/([,;:])(?:\s*[,;:])+/g, "$1");
    s = s.replace(/[,;:]\s*([.!?])/g, "$1");
    s = s.replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, "");
    let prev;
    do {
      prev = s;
      s = s.replace(/\s+(?:at|on|by|for|and|due|from|in|the|starting)$/i, "").replace(/[\s,;:\-–—]+$/g, "");
    } while (s !== prev);
    return s.trim();
  }

  function matchKey(type, text) {
    return `${type}:${text.trim().toLowerCase()}`;
  }

  /**
   * Understand a task typed in plain words.
   * @param {string} text
   * @param {Date} [now]
   * @param {string} [locale]
   * @param {{ ignore?: string[] }} [opts] keys of matches the user dismissed (match.key)
   */
  function parse(text, now = new Date(), locale = (typeof navigator !== "undefined" && navigator.language) || "en-GB", opts = {}) {
    const source = typeof text === "string" ? text : "";
    const empty = { title: source, dueDate: null, dueTime: null, priority: null, recurrence: null, tags: [], matches: [] };
    if (!source.trim()) return empty;

    const today = startOfDay(now);
    const ctx = { text: source, today, now, locale };
    const ignore = new Set(opts.ignore || []);
    const quotes = quotedRanges(source);
    const inQuotes = (s, e) => quotes.some(([qs, qe]) => s < qe && e > qs);

    const candidates = [];
    RULES.forEach((rule, order) => {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(source))) {
        if (m[0].length === 0) {
          rule.re.lastIndex++;
          continue;
        }
        const start = m.index;
        const end = m.index + m[0].length;
        if (inQuotes(start, end)) continue;
        const key = matchKey(rule.type, m[0]);
        if (ignore.has(key)) continue;
        const res = rule.read(m, ctx);
        if (res) candidates.push({ type: rule.type, start, end, key, order, ...res });
      }
    });

    // Earliest first; at the same spot the longer phrase wins.
    candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.order - b.order);

    const chosen = [];
    const filled = new Set();
    const seenTags = new Set();
    for (const c of candidates) {
      if (chosen.some((s) => c.start < s.end && c.end > s.start)) continue;
      if (c.type === "tag") {
        // A repeated tag is still removed from the title, but only listed once.
        if (seenTags.has(c.value)) c.duplicate = true;
        seenTags.add(c.value);
      } else {
        if (filled.has(c.type)) continue;
        filled.add(c.type);
      }
      chosen.push(c);
    }

    if (chosen.length === 0) return empty;

    const result = { title: "", dueDate: null, dueTime: null, priority: null, recurrence: null, tags: [], matches: [] };
    let dateObj = null;
    let impliedTime = null;
    let impliedDate = null;
    let recurrence = null;

    for (const c of chosen) {
      if (c.type === "date") {
        dateObj = c.value;
        if (c.impliedTime) impliedTime = c.impliedTime;
        c.label = c.label || dateLabel(c.value, today);
      } else if (c.type === "time") {
        result.dueTime = c.value;
        if (c.impliedDate) impliedDate = c.impliedDate;
        c.label = c.label || timeLabel(c.value);
      } else if (c.type === "priority") {
        result.priority = c.value;
      } else if (c.type === "recurrence") {
        recurrence = c.value;
        result.recurrence = c.value.rule;
      } else if (c.type === "tag" && !c.duplicate) {
        result.tags.push(c.value);
      }
    }

    if (!result.dueTime && impliedTime) result.dueTime = impliedTime;
    if (!dateObj && impliedDate) dateObj = impliedDate;

    // A repeat with no date starts on its first occurrence.
    let dateFromRepeat = false;
    if (!dateObj && recurrence) {
      dateFromRepeat = true;
      if (recurrence.rule === "weekly" && recurrence.dow != null) {
        dateObj = coming(today, recurrence.dow);
      } else if (recurrence.rule === "weekdays") {
        const dow = today.getDay();
        dateObj = dow === 0 || dow === 6 ? coming(today, 1) : today;
      } else {
        dateObj = today;
      }
    }

    // A time with no date means today if it's still ahead, otherwise the next sensible day.
    const nowHHMM = hhmm(now.getHours(), now.getMinutes());
    if (result.dueTime && !dateObj) {
      dateObj = result.dueTime > nowHHMM ? today : addDays(today, 1);
    } else if (result.dueTime && dateFromRepeat && ymd(dateObj) === ymd(today) && result.dueTime <= nowHHMM) {
      if (recurrence.rule === "daily") dateObj = addDays(today, 1);
      else if (recurrence.rule === "weekdays") dateObj = today.getDay() === 5 ? addDays(today, 3) : addDays(today, 1);
    }

    result.dueDate = dateObj ? ymd(dateObj) : null;
    result.matches = chosen.filter((c) => !c.duplicate).map((c) => ({ start: c.start, end: c.end, type: c.type, label: c.label, key: c.key }));

    // Title = everything we didn't understand, tidied.
    let out = "";
    let cursor = 0;
    chosen.forEach((c) => {
      out += `${source.slice(cursor, c.start)} `;
      cursor = c.end;
    });
    out += source.slice(cursor);
    result.title = tidyTitle(out) || source.trim();
    return result;
  }

  /**
   * Combine parsed values with the composer's fields. Fields the user changed by hand win;
   * otherwise parsed values replace the composer's defaults. Tags are combined.
   */
  function merge(parsed, { defaults = {}, manual = {}, dirty = [] } = {}) {
    const isDirty = (f) => (dirty instanceof Set ? dirty.has(f) : dirty.includes(f));
    const pick = (f) => (isDirty(f) ? manual[f] : parsed && parsed[f] != null ? parsed[f] : defaults[f]);
    const baseTags = isDirty("tags") ? manual.tags : defaults.tags;
    const tags = [];
    [...(baseTags || []), ...((parsed && parsed.tags) || [])].forEach((t) => {
      const norm = String(t).trim().replace(/^#/, "").toLowerCase();
      if (norm && !tags.includes(norm)) tags.push(norm);
    });
    return {
      priority: pick("priority"),
      dueDate: pick("dueDate"),
      dueTime: pick("dueTime"),
      tags
    };
  }

  // ---------- browser UI ----------
  const HINTS = [
    "Try: lunch with Sara Friday 1pm",
    "Try: send invoice every month",
    "Try: call bank tomorrow morning, urgent"
  ];
  let hintIndex = 0;
  const CHIP_ICONS = { date: "calendar", time: "clock", priority: "flag", recurrence: "repeat", tag: "tag" };
  const AI_PREFIX = /^\s*(ai:|\/ai\s|!ai\s)/i;

  /**
   * Wire a composer. fields = { priority, dueDate, dueTime, tags } (form controls).
   * Returns { reset(), result(), refresh() }.
   */
  function bindComposer({ input, fields, preview, hint, delay = 120 }) {
    const ctl = { dirty: new Set(), ignore: new Set(), defaults: null, parsed: null, timer: null };
    const fieldNames = ["priority", "dueDate", "dueTime", "tags"];

    fieldNames.forEach((name) => {
      const el = fields[name];
      if (!el) return;
      const mark = () => ctl.dirty.add(name);
      el.addEventListener("input", mark);
      el.addEventListener("change", mark);
    });

    const readFields = () => ({
      priority: fields.priority.value,
      dueDate: fields.dueDate.value,
      dueTime: fields.dueTime.value,
      tags: fields.tags.value.split(",")
    });

    function showHint() {
      if (!hint) return;
      const empty = !input.value.trim();
      hint.hidden = !empty;
      if (empty) hint.textContent = HINTS[hintIndex % HINTS.length];
    }

    function renderChips() {
      if (!preview) return;
      preview.textContent = "";
      const matches = ctl.parsed ? ctl.parsed.matches : [];
      preview.hidden = matches.length === 0;
      matches.forEach((match) => {
        const chip = document.createElement("span");
        chip.className = `smart-chip smart-chip-${match.type}`;
        const icon = iconEl(CHIP_ICONS[match.type], 13);
        if (icon) chip.append(icon);
        const text = document.createElement("span");
        text.textContent = match.label;
        chip.append(text);
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "smart-chip-dismiss";
        dismiss.setAttribute("aria-label", `Ignore "${match.label}" and keep those words in the title`);
        dismiss.title = "Ignore this";
        dismiss.append(iconEl("x", 12));
        dismiss.addEventListener("click", () => {
          ctl.ignore.add(match.key);
          update();
          input.focus();
        });
        chip.append(dismiss);
        preview.append(chip);
      });
    }

    function applyToFields() {
      if (!ctl.defaults) return;
      const merged = merge(ctl.parsed, { defaults: ctl.defaults, manual: readFields(), dirty: ctl.dirty });
      if (!ctl.dirty.has("priority")) fields.priority.value = merged.priority || "medium";
      if (!ctl.dirty.has("dueDate")) fields.dueDate.value = merged.dueDate || "";
      if (!ctl.dirty.has("dueTime")) fields.dueTime.value = merged.dueTime || "";
    }

    function update() {
      clearTimeout(ctl.timer);
      ctl.timer = null;
      const text = input.value;
      if (!text.trim() || AI_PREFIX.test(text)) {
        ctl.parsed = null;
        if (!text.trim()) ctl.ignore.clear();
      } else {
        if (!ctl.defaults) {
          ctl.defaults = { ...readFields() };
        }
        ctl.parsed = parse(text, new Date(), undefined, { ignore: [...ctl.ignore] });
      }
      applyToFields();
      renderChips();
      showHint();
    }

    input.addEventListener("input", () => {
      if (!input.value.trim()) {
        update();
        return;
      }
      clearTimeout(ctl.timer);
      ctl.timer = setTimeout(update, delay);
    });
    input.addEventListener("focus", () => {
      if (!input.value.trim()) {
        hintIndex += 1;
        showHint();
      }
    });

    showHint();

    return {
      refresh: update,
      reset() {
        clearTimeout(ctl.timer);
        ctl.dirty.clear();
        ctl.ignore.clear();
        ctl.defaults = null;
        ctl.parsed = null;
        renderChips();
        showHint();
      },
      /** Final values for saving. Flushes any pending preview first. */
      result() {
        update();
        const merged = merge(ctl.parsed, { defaults: ctl.defaults || readFields(), manual: readFields(), dirty: ctl.dirty });
        return {
          title: ctl.parsed ? ctl.parsed.title : input.value.trim(),
          priority: merged.priority || "medium",
          dueDate: merged.dueDate || "",
          dueTime: merged.dueTime || "",
          tags: merged.tags,
          recurrence: (ctl.parsed && ctl.parsed.recurrence) || "none",
          understood: ctl.parsed ? ctl.parsed.matches.length : 0
        };
      }
    };
  }

  return { parse, merge, bindComposer, timeLabel, HINTS };
})();
