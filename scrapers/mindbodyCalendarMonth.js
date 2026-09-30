"use strict";
const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function calendarMonthDate(labels, referenceDate) {
  const parts = Array.isArray(labels) ? labels : [labels];
  const texts = parts.filter(value => typeof value === "string").map(value => value.replace(/\s+/g, " ").trim()).filter(Boolean);
  const reference = /^\d{4}-\d{2}-\d{2}$/.test(String(referenceDate || ""))
    ? new Date(referenceDate + "T12:00:00Z") : new Date();
  for (const text of texts) {
    const monthPattern = new RegExp(`\\b(${months.join("|")})\\b`, "ig");
    for (const match of text.matchAll(monthPattern)) {
      const month = months.findIndex(name => name.toLowerCase() === match[1].toLowerCase());
      if (month < 0) continue;
      const nearby = text.slice(Math.max(0, match.index - 16), Math.min(text.length, match.index + match[0].length + 24));
      const yearMatch = nearby.match(/\b(20\d{2})\b/);
      let year = yearMatch ? Number(yearMatch[1]) : reference.getUTCFullYear();
      if (!yearMatch) {
        const referenceMonth = reference.getUTCMonth();
        if (month - referenceMonth > 6) year--;
        else if (referenceMonth - month > 6) year++;
      }
      return `${year}-${String(month + 1).padStart(2, "0")}-01`;
    }
  }
  return "";
}

module.exports = {calendarMonthDate};
