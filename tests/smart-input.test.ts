import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// public/js/smart-input.js is a classic browser script; evaluate it in an isolated context.
const context = vm.createContext({ console });
vm.runInContext(
  `${readFileSync(new URL("../public/js/smart-input.js", import.meta.url), "utf8")}\nglobalThis.__SmartInput = SmartInput;`,
  context
);
const SmartInput = (context as any).__SmartInput;

// Thursday 15 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 15, 10, 0);

type Parsed = {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: string | null;
  recurrence: string | null;
  tags: string[];
  matches: { start: number; end: number; type: string; label: string; key: string }[];
};

/** Parse with a fixed clock; JSON round-trip so objects from the vm realm compare cleanly. */
function p(text: string, locale = "en-GB", opts: object = {}): Parsed {
  return JSON.parse(JSON.stringify(SmartInput.parse(text, NOW, locale, opts)));
}

function fields(r: Parsed) {
  const { title, dueDate, dueTime, priority, recurrence, tags } = r;
  return { title, dueDate, dueTime, priority, recurrence, tags };
}

// ---------- the headline examples ----------
test("the John example: date, time, priority and a clean title", () => {
  const r = p("Call John tomorrow at 3pm about the contract, high priority");
  assert.deepEqual(fields(r), {
    title: "Call John about the contract",
    dueDate: "2026-10-16",
    dueTime: "15:00",
    priority: "high",
    recurrence: null,
    tags: []
  });
  assert.deepEqual(r.matches.map((m) => m.label), ["Tomorrow", "3:00 PM", "High priority"]);
  assert.deepEqual(r.matches.map((m) => m.type), ["date", "time", "priority"]);
});

test("Team sync every Monday 10am #ops", () => {
  assert.deepEqual(fields(p("Team sync every Monday 10am #ops")), {
    title: "Team sync",
    dueDate: "2026-10-19",
    dueTime: "10:00",
    priority: null,
    recurrence: "weekly",
    tags: ["ops"]
  });
});

test("Pay rent end of the month", () => {
  const r = p("Pay rent end of the month");
  assert.equal(r.title, "Pay rent");
  assert.equal(r.dueDate, "2026-10-31");
});

test("Call May stays a plain title", () => {
  assert.deepEqual(p("Call May"), {
    title: "Call May",
    dueDate: null,
    dueTime: null,
    priority: null,
    recurrence: null,
    tags: [],
    matches: []
  });
});

test("nothing understood returns the text unchanged", () => {
  const r = p("  Write weekly report  ");
  assert.equal(r.title, "  Write weekly report  ");
  assert.equal(r.recurrence, null);
  assert.equal(r.matches.length, 0);
});

// ---------- dates ----------
const dateCases: [string, string, string][] = [
  ["Ship it today", "2026-10-15", "Ship it"],
  ["Submit report tomorrow", "2026-10-16", "Submit report"],
  ["Submit report by tomorrow", "2026-10-16", "Submit report"],
  ["Book venue day after tomorrow", "2026-10-17", "Book venue"],
  ["Call Ana on Monday", "2026-10-19", "Call Ana"],
  ["Call Ana Monday", "2026-10-19", "Call Ana"],
  ["Pay invoice Fri", "2026-10-16", "Pay invoice"],
  ["Board meeting Thursday", "2026-10-15", "Board meeting"],
  ["Review deck this Friday", "2026-10-16", "Review deck"],
  ["Review deck next Friday", "2026-10-23", "Review deck"],
  ["Check stock on sat", "2026-10-17", "Check stock"],
  ["Follow up in 3 days", "2026-10-18", "Follow up"],
  ["Follow up in 2 weeks", "2026-10-29", "Follow up"],
  ["Follow up in a week", "2026-10-22", "Follow up"],
  ["Plan offsite next week", "2026-10-19", "Plan offsite"],
  ["Send summary end of the week", "2026-10-16", "Send summary"],
  ["Send summary by end of week", "2026-10-16", "Send summary"],
  ["Renew licence 15 Oct", "2026-10-15", "Renew licence"],
  ["Renew licence Oct 20", "2026-10-20", "Renew licence"],
  ["Renew licence 20th October", "2026-10-20", "Renew licence"],
  ["Renew licence on the 20th of October", "2026-10-20", "Renew licence"],
  ["Renew licence October 20th", "2026-10-20", "Renew licence"],
  ["Tax return 3 March", "2027-03-03", "Tax return"],
  ["Anniversary Oct 1", "2027-10-01", "Anniversary"],
  ["Call May 5", "2027-05-05", "Call"],
  ["Quarterly close 31 Dec 2027", "2027-12-31", "Quarterly close"]
];
for (const [text, date, title] of dateCases) {
  test(`date: ${text}`, () => {
    const r = p(text);
    assert.equal(r.dueDate, date);
    assert.equal(r.title, title);
  });
}

test("Ignoring 'sat' as a bare word (it's an everyday word)", () => {
  assert.equal(p("Sat exam prep").dueDate, null);
});

test("numeric dates follow the locale, falling back when one order is impossible", () => {
  assert.equal(p("Invoice 15/10", "en-GB").dueDate, "2026-10-15");
  assert.equal(p("Invoice 10/15", "en-US").dueDate, "2026-10-15");
  assert.equal(p("Invoice 10/15", "en-GB").dueDate, "2026-10-15");
  assert.equal(p("Invoice 5/11", "en-GB").dueDate, "2026-11-05");
  assert.equal(p("Invoice 5/11", "en-US").dueDate, "2027-05-11");
  assert.equal(p("Invoice 5/11", "en-GB").title, "Invoice");
});

test("tonight sets today at 8 PM unless a time is given", () => {
  assert.deepEqual([p("Dinner tonight").dueDate, p("Dinner tonight").dueTime, p("Dinner tonight").title], ["2026-10-15", "20:00", "Dinner"]);
  const r = p("Dinner tonight at 9pm");
  assert.equal(r.dueTime, "21:00");
  assert.equal(r.dueDate, "2026-10-15");
});

// ---------- times ----------
const timeCases: [string, string, string, string][] = [
  ["Call Sam at 3pm", "15:00", "2026-10-15", "Call Sam"],
  ["Call Sam 3:30pm", "15:30", "2026-10-15", "Call Sam"],
  ["Call Sam at 3.30 pm", "15:30", "2026-10-15", "Call Sam"],
  ["Call Sam at 15:00", "15:00", "2026-10-15", "Call Sam"],
  ["Lunch noon", "12:00", "2026-10-15", "Lunch"],
  ["Lunch at midday", "12:00", "2026-10-15", "Lunch"],
  ["Coffee at 12am", "00:00", "2026-10-16", "Coffee"],
  ["Send figures eod", "17:00", "2026-10-15", "Send figures"],
  ["Send figures by end of day", "17:00", "2026-10-15", "Send figures"],
  ["Gym this evening", "18:00", "2026-10-15", "Gym"],
  ["Prep slides Friday afternoon", "14:00", "2026-10-16", "Prep slides"],
  ["Call bank tomorrow morning", "09:00", "2026-10-16", "Call bank"]
];
for (const [text, time, date, title] of timeCases) {
  test(`time: ${text}`, () => {
    const r = p(text);
    assert.equal(r.dueTime, time);
    assert.equal(r.dueDate, date);
    assert.equal(r.title, title);
  });
}

test("a time that has already passed today rolls to tomorrow", () => {
  const r = p("Stand-up 9am");
  assert.equal(r.dueTime, "09:00");
  assert.equal(r.dueDate, "2026-10-16");
});

test("'morning' inside a title is left alone", () => {
  const r = p("Morning standup notes");
  assert.equal(r.dueTime, null);
  assert.equal(r.title, "Morning standup notes");
});

test("time labels are plain English", () => {
  assert.deepEqual(p("Call at 3:05pm").matches.map((m) => m.label), ["3:05 PM"]);
});

// ---------- priority ----------
const priorityCases: [string, string, string][] = [
  ["Fix login urgent", "high", "Fix login"],
  ["Reply to Kim asap", "high", "Reply to Kim"],
  ["Sign NDA important", "high", "Sign NDA"],
  ["Sign NDA !!", "high", "Sign NDA"],
  ["Tidy drive, low priority", "low", "Tidy drive"],
  ["Tidy drive whenever", "low", "Tidy drive"],
  ["Learn Excel macros someday", "low", "Learn Excel macros"],
  ["Update CRM medium priority", "medium", "Update CRM"]
];
for (const [text, priority, title] of priorityCases) {
  test(`priority: ${text}`, () => {
    const r = p(text);
    assert.equal(r.priority, priority);
    assert.equal(r.title, title);
  });
}

test("call bank tomorrow morning, urgent", () => {
  assert.deepEqual(fields(p("call bank tomorrow morning, urgent")), {
    title: "call bank",
    dueDate: "2026-10-16",
    dueTime: "09:00",
    priority: "high",
    recurrence: null,
    tags: []
  });
});

// ---------- repeats ----------
const repeatCases: [string, string, string, string][] = [
  ["Check inbox every day", "daily", "2026-10-15", "Check inbox"],
  ["Water plants daily", "daily", "2026-10-15", "Water plants"],
  ["Timesheet every weekday", "weekdays", "2026-10-15", "Timesheet"],
  ["Timesheet weekdays", "weekdays", "2026-10-15", "Timesheet"],
  ["Team report weekly", "weekly", "2026-10-15", "Team report"],
  ["1:1 with Priya every Tuesday", "weekly", "2026-10-20", "1:1 with Priya"],
  ["send invoice every month", "monthly", "2026-10-15", "send invoice"],
  ["Pay contractors monthly", "monthly", "2026-10-15", "Pay contractors"]
];
for (const [text, rule, date, title] of repeatCases) {
  test(`repeat: ${text}`, () => {
    const r = p(text);
    assert.equal(r.recurrence, rule);
    assert.equal(r.dueDate, date);
    assert.equal(r.title, title);
  });
}

test("a daily task whose time has passed starts tomorrow", () => {
  const r = p("Stretch every day 7am");
  assert.equal(r.dueDate, "2026-10-16");
  assert.equal(r.dueTime, "07:00");
});

test("repeat labels are plain English", () => {
  assert.deepEqual(p("Team sync every Monday").matches.map((m) => m.label), ["Every Monday"]);
});

// ---------- tags ----------
test("tags are pulled out and lower-cased, duplicates dropped", () => {
  const r = p("Prepare Q4 forecast #Sales #finance #sales");
  assert.deepEqual(r.tags, ["sales", "finance"]);
  assert.equal(r.title, "Prepare Q4 forecast");
});

test("a # inside a word is not a tag", () => {
  assert.deepEqual(p("Ticket C#123 review").tags, []);
});

// ---------- quotes, ignore, combinations ----------
test("text inside quotes is never parsed", () => {
  const r = p('Read "Tomorrow and Tomorrow" tomorrow');
  assert.equal(r.dueDate, "2026-10-16");
  assert.equal(r.title, 'Read "Tomorrow and Tomorrow"');
  assert.equal(p('Watch "Friday Night Lights"').matches.length, 0);
});

test("lunch with Sara Friday 1pm", () => {
  assert.deepEqual(fields(p("lunch with Sara Friday 1pm")), {
    title: "lunch with Sara",
    dueDate: "2026-10-16",
    dueTime: "13:00",
    priority: null,
    recurrence: null,
    tags: []
  });
});

test("Call May at 3pm keeps May in the title", () => {
  const r = p("Call May at 3pm");
  assert.equal(r.title, "Call May");
  assert.equal(r.dueTime, "15:00");
});

test("an ignored part stays in the title", () => {
  const first = p("Lunch Friday 1pm");
  const dateKey = first.matches.find((m) => m.type === "date")!.key;
  const r = p("Lunch Friday 1pm", "en-GB", { ignore: [dateKey] });
  assert.equal(r.title, "Lunch Friday");
  assert.equal(r.dueTime, "13:00");
  assert.equal(r.dueDate, "2026-10-15");
});

test("only the first date is used; a second one stays in the title", () => {
  const r = p("Move meeting from Monday to Tuesday");
  assert.equal(r.dueDate, "2026-10-19");
  assert.equal(r.title, "Move meeting from to Tuesday");
});

// ---------- merge: fields the user changed win ----------
function merge(parsed: Parsed, opts: object) {
  return JSON.parse(JSON.stringify(SmartInput.merge(parsed, opts)));
}

test("manual fields win over parsed values; untouched fields take parsed values", () => {
  const parsed = p("Call John tomorrow at 3pm, high priority #legal");
  const merged = merge(parsed, {
    defaults: { priority: "medium", dueDate: "2026-10-15", dueTime: "", tags: [] },
    manual: { priority: "low", dueDate: "2026-10-15", dueTime: "", tags: ["client"] },
    dirty: ["priority", "tags"]
  });
  assert.deepEqual(merged, { priority: "low", dueDate: "2026-10-16", dueTime: "15:00", tags: ["client", "legal"] });
});

test("defaults are kept when nothing was parsed for a field", () => {
  const merged = merge(p("Call May"), {
    defaults: { priority: "medium", dueDate: "2026-10-15", dueTime: "", tags: [] },
    manual: { priority: "medium", dueDate: "2026-10-15", dueTime: "", tags: [] },
    dirty: []
  });
  assert.deepEqual(merged, { priority: "medium", dueDate: "2026-10-15", dueTime: "", tags: [] });
});

test("a manually picked date beats a typed one", () => {
  const merged = merge(p("Report tomorrow"), {
    defaults: { priority: "medium", dueDate: "", dueTime: "", tags: [] },
    manual: { priority: "medium", dueDate: "2026-12-01", dueTime: "", tags: [] },
    dirty: ["dueDate"]
  });
  assert.equal(merged.dueDate, "2026-12-01");
});
