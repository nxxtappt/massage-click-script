"use strict";
const {calendarMonthDate} = require("./mindbodyCalendarMonth");

const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
const keyOf = date => date.toISOString().slice(0, 10);
function dateKey(value) {
  const raw = normalize(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(raw + "T12:00:00Z");
    return !Number.isNaN(date.getTime()) && keyOf(date) === raw ? raw : "";
  }
  const date = new Date(raw + " 12:00:00 UTC");
  return Number.isNaN(date.getTime()) ? "" : keyOf(date);
}
function timeValue(value) {
  const match = normalize(value).match(/^(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(AM|PM)$/i);
  return match ? `${Number(match[1])}:${match[2] || "00"} ${match[3].toUpperCase()}` : "";
}
function windowFor(business) {
  const timezone = business.timeZone || business.timezone || "America/Chicago";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const start = dateKey(business.scrapeStartDate || today);
  const count = Math.max(1, Math.ceil(Number(business.daysForward || Number(business.lookaheadHours || 24) / 24)));
  if (!start || !Number.isFinite(count)) throw new Error("Mindbody invalid scrape window");
  const endDate = new Date(start + "T12:00:00Z");
  endDate.setUTCDate(endDate.getUTCDate() + count - 1);
  const end = dateKey(business.scrapeEndDate || keyOf(endDate));
  if (!end || end < start) throw new Error("Mindbody invalid scrape end date");
  const dates = [];
  for (let date = new Date(start + "T12:00:00Z"); keyOf(date) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (dates.length >= 31) throw new Error("Mindbody scrape window exceeds 31 days");
    dates.push(keyOf(date));
  }
  return { dates, scrapeStartDate: start, scrapeEndDate: end, daysForward: dates.length,
    lookaheadHours: Number(business.lookaheadHours || dates.length * 24), scrapeWindowMode: business.scrapeWindowMode || "days_forward" };
}
async function poll(page, read, accept, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (accept(value)) return value;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  throw new Error(`Mindbody timeout: ${label}`);
}
async function widgetFrame(page) {
  return poll(page, async () => {
    for (const frame of page.frames()) {
      if (/https:\/\/go\.mindbodyonline\.com\/book\/widgets\/appointments(?:\/|$)/i.test(frame.url())) {
        if (!await frame.locator("[role='progressbar']:visible").count() &&
          await frame.locator("[data-service-id], [data-testid='service-select'], h1, h2, h3").count()) return frame;
      }
    }
    return null;
  }, Boolean, "appointment widget frame", 30000);
}
// One browser-side resolver shared by discovery and activation. Prices and
// duration captions never take part in the service-name comparison.
function resolveService({ ids, name, category, activate }) {
  const norm = value => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = el => {
    const style = getComputedStyle(el), box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const enabled = el => !el.disabled && el.getAttribute("aria-disabled") !== "true";
  const controls = [...document.querySelectorAll("[data-service-id], [data-testid='service-select'], button, [role='button']")];
  let candidates = controls.filter(el => visible(el) && enabled(el) &&
    ids.some(id => el.getAttribute("data-service-id") === id || el.id === id));
  let strategy = "service_id";
  if (!candidates.length && name) {
    strategy = "service_heading";
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[data-testid='service-name']")];
    const names = [norm(name)];
    // Older configuration sometimes appends a separate duration caption.
    const withoutCaption = norm(name).replace(/\s+\d+\s+min$/, "");
    if (withoutCaption !== norm(name)) names.push(withoutCaption);
    for (const wanted of names) {
      candidates = headings.filter(el => visible(el) && norm(el.textContent) === wanted)
        .map(el => el.closest("[data-testid='service-select'],[data-service-id],button,[role='button']"))
        .filter(el => el && visible(el) && enabled(el));
      candidates = [...new Set(candidates)];
      if (category && candidates.length > 1) {
        const scoped = candidates.filter(el => {
          const region = el.closest("[role='region'], section");
          const container = region && region.parentElement;
          return container && [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")]
            .some(h => norm(h.textContent) === norm(category));
        });
        if (scoped.length) candidates = scoped;
      }
      if (candidates.length) break;
    }
  }
  candidates = [...new Set(candidates)];
  if (candidates.length > 1) throw new Error("Mindbody ambiguous service match; configure an exact service name/category");
  const el = candidates[0];
  if (!el) return { found: false };
  if (activate) {
    el.scrollIntoView({ block: "center" });
    el.click();
  }
  return { found: true, strategy };
}
function serviceArgs(business, activate = false) {
  return { ids: [...new Set([business.serviceButtonId, business.platformServiceId, business.serviceId].filter(v => v != null && v !== "").map(String))],
    name: business.serviceName || "", category: business.categoryText || business.categoryName || "", activate };
}
async function exposeService(frame, page, business) {
  const args = serviceArgs(business);
  if (!args.ids.length && !args.name) throw new Error("Mindbody missing service ID and name");
  if ((await frame.evaluate(resolveService, args)).found) return true;
  if (!args.category) throw new Error("Mindbody service hidden/not found; configure categoryText");
  const toggled = await frame.evaluate(category => {
    const norm = value => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span")].filter(h => norm(h.textContent) === norm(category));
    for (const h of headings) {
      let el = h.closest("button,[role='button']");
      if (!el) {
        let container = h.parentElement;
        for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
          el = [...container.querySelectorAll("button,[role='button'],a")].find(b =>
            /^(show|expand|open)$/i.test(norm(b.textContent)) || b.getAttribute("aria-expanded") === "false");
          if (el) break;
        }
      }
      if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (el.getAttribute("aria-expanded") === "true" || /\b(hide|collapse)\b/i.test(el.textContent)) return true;
      el.click(); return true;
    }
    return false;
  }, args.category);
  if (!toggled) throw new Error(`Mindbody category not found: ${args.category}`);
  await poll(page, () => frame.evaluate(resolveService, args), r => r.found, "service after category expansion");
  return true;
}
async function selectService(frame, page, business) {
  const selected = await frame.evaluate(resolveService, serviceArgs(business, true));
  if (!selected.found) throw new Error(`Mindbody service not found: ${business.serviceName}`);
  console.log(`[MINDBODY] Service selection via ${selected.strategy}`);
  await poll(page, () => frame.locator("body").innerText(), text =>
    /first available|select (?:your )?(?:employee|staff|provider)|choose (?:your )?(?:employee|provider)|continue|add.?on|enhancement|select date|availability for|fully booked|no appointments available/i.test(text),
    "service transition");
  return true;
}
async function snapshot(frame) {
  const state = await frame.evaluate(() => {
    const visible = el => {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map(el => el.textContent.trim());
    const controls = [...document.querySelectorAll("button,a,[role='button']")]
      .filter(el => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true")
      .map(el => (el.innerText || el.textContent || "").trim());
    return { headings, controls, text: document.body.innerText,
      loading: [...document.querySelectorAll("[role='progressbar'],[aria-busy='true']")].some(visible) };
  });
  // Never use "Go to..." or "Next available..." as the displayed date.
  const heading = state.headings.find(h => /^(Availability for|Available on|Appointments for)\s+/i.test(h));
  const label = state.text.match(/(?:Availability for|Available on|Appointments for|fully booked for today,)\s*([A-Za-z]+ \d{1,2}, \d{4})/i);
  const emptyToday = state.text.match(/There is no availability today,\s*([A-Za-z]+ \d{1,2})/i);
  const monthHeading = state.headings.find(h => /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/i.test(h));
  const emptyTodayDate = emptyToday && monthHeading
    ? dateKey(`${emptyToday[1]}, ${monthHeading.split(" ").pop()}`)
    : "";
  const date = heading
    ? dateKey(heading.replace(/^(Availability for|Available on|Appointments for)\s+/i, ""))
    : label ? dateKey(label[1]) : emptyTodayDate;
  const times = [...new Set(state.controls.map(timeValue).filter(Boolean))];
  return { ...state, date, times };
}
function networkMonitor(page) {
  const pending = new Set();
  let lastActivity = Date.now();
  const relevant = request => {
    try { return /(^|\.)mindbodyonline\.com$/i.test(new URL(request.url()).hostname) &&
      ["xhr","fetch"].includes(request.resourceType()); } catch { return false; }
  };
  const started = request => { if (relevant(request)) {pending.add(request);lastActivity=Date.now();} };
  const finished = request => { if (pending.delete(request)) lastActivity=Date.now(); };
  page.on("request",started);
  page.on("requestfinished",finished);
  page.on("requestfailed",finished);
  return {
    quiet:() => pending.size === 0 && Date.now()-lastActivity >= 750,
    dispose:() => {page.off("request",started);page.off("requestfinished",finished);page.off("requestfailed",finished);}
  };
}
async function settledSnapshot(frame, page, expectedDate, monitor) {
  let previous = "", consecutive = 0, lastState = null;
  try {
    return await poll(page, async () => {
      lastState = await snapshot(frame);
      return lastState;
    }, state => {
      if (state.loading || !state.date || expectedDate && state.date !== expectedDate) {
        consecutive = 0;
        return false;
      }
      const fingerprint = JSON.stringify([state.date, state.times, state.text]);
      consecutive = fingerprint === previous ? consecutive + 1 : 0;
      previous = fingerprint;
      return consecutive >= 6;
    }, `availability for ${expectedDate || "displayed date"}`);
  } catch (error) {
    const state = lastState || await snapshot(frame).catch(() => null);
    console.error("[MINDBODY AVAILABILITY DIAGNOSTIC]", JSON.stringify({
      expectedDate: expectedDate || null,
      observedDate: state && state.date || null,
      headings: state && state.headings || [],
      times: state && state.times || [],
      loading: state && state.loading,
      bodyPreview: state && String(state.text || "").slice(0, 3000)
    }, null, 2));
    throw error;
  }
}
async function navigateDate(frame, page, target, monitor) {
  const wanted = new Date(target + "T12:00:00Z");
  const long = wanted.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  // Old widget: fully dated controls, never bare day numbers or next-time suggestions.
  const direct = await frame.evaluate(({target, long}) => {
    for (const el of document.querySelectorAll("button,a,[role='button'],[role='gridcell']")) {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      const values = [el.getAttribute("data-date"), el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent.trim()];
      if (values.some(v => v === target || v === long || v === "Go to " + long)) { el.click(); return true; }
    }
    return false;
  }, {target, long});
  if (direct) return settledSnapshot(frame, page, target, monitor);
  const opener = frame.getByRole("button", {name: "Open calendar", exact: true});
  if (!await opener.isVisible().catch(() => false)) throw new Error(`Mindbody date control not found: ${target}`);
  await opener.click();
  const targetMonth = wanted.getUTCFullYear() * 12 + wanted.getUTCMonth();
  for (let step = 0; step < 24; step++) {
    const grid = frame.getByRole("grid").first();
    await grid.waitFor({state:"visible",timeout:5000});
    const label = await grid.getAttribute("aria-label");
    const calendarContext = await frame.evaluate(() => {
      const visible = el => { const box=el.getBoundingClientRect(), style=getComputedStyle(el); return box.width>0&&box.height>0&&style.display!=="none"&&style.visibility!=="hidden"; };
      let node=[...document.querySelectorAll("[role='grid']")].find(visible), parts=[];
      for(let depth=0;node&&depth<4;depth++,node=node.parentElement) {
        for(const value of [node.getAttribute("aria-label"),node.getAttribute("title"),node.innerText||node.textContent]) if(value) parts.push(value);
      }
      return parts;
    });
    const displayed = calendarMonthDate([label, ...calendarContext], (await snapshot(frame)).date || target);
    if (!displayed) throw new Error("Mindbody calendar month could not be verified");
    const shown = new Date(displayed + "T12:00:00Z");
    const month = shown.getUTCFullYear() * 12 + shown.getUTCMonth();
    if (month === targetMonth) {
      const day = grid.getByRole("gridcell", {name:String(wanted.getUTCDate()),exact:true});
      if (await day.count() !== 1 || !await day.isEnabled()) throw new Error(`Mindbody calendar date unavailable: ${target}`);
      await day.click();
      const apply = frame.getByRole("button", {name:"Apply",exact:true});
      if (await apply.isVisible().catch(() => false)) await apply.click();
      return settledSnapshot(frame, page, target, monitor);
    }
    const arrow = frame.getByRole("button", {name:month < targetMonth ? "Next month" : "Previous month",exact:true});
    if (!await arrow.isEnabled()) throw new Error(`Mindbody calendar cannot reach ${target}`);
    const calendarBefore = JSON.stringify([await grid.getAttribute("aria-label"), await grid.innerText()]);
    await arrow.click();
    await poll(page, async () => {
      const currentGrid = frame.getByRole("grid").first();
      return JSON.stringify([await currentGrid.getAttribute("aria-label"), await currentGrid.innerText()]);
    }, next => next !== calendarBefore, "calendar month change",5000);
  }
  throw new Error(`Mindbody calendar navigation limit: ${target}`);
}
module.exports = {dateKey,timeValue,windowFor,poll,widgetFrame,resolveService,serviceArgs,exposeService,selectService,snapshot,settledSnapshot,navigateDate,networkMonitor};
