/**
 * Server-Side Recurrence Calculation Engine
 * Matches Momentum client-side logic for daily, weekdays, weekly, and monthly recurrence.
 */

export function calculateNextDueDate(currentDueDateStr: string | null | undefined, recurrence: string): string | null {
  if (!currentDueDateStr || recurrence === "none" || !recurrence) return null;

  const [year, month, day] = currentDueDateStr.split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);

  if (recurrence === "daily") {
    date.setDate(date.getDate() + 1);
  } else if (recurrence === "weekdays") {
    const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
    if (dayOfWeek === 5) {
      // Friday -> Monday (+3 days)
      date.setDate(date.getDate() + 3);
    } else if (dayOfWeek === 6) {
      // Saturday -> Monday (+2 days)
      date.setDate(date.getDate() + 2);
    } else {
      date.setDate(date.getDate() + 1);
    }
  } else if (recurrence === "weekly") {
    date.setDate(date.getDate() + 7);
  } else if (recurrence === "monthly") {
    const targetMonth = date.getMonth() + 1;
    date.setMonth(targetMonth);
    // Month-end edge cases: if month wrapped around (e.g. Jan 31 -> March 3), clamp back to last day of target month
    if (date.getMonth() !== targetMonth % 12) {
      date.setDate(0);
    }
  } else {
    return null;
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
