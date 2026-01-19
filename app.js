import { auth, db, googleProvider } from "./firebase.js";

import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ------------------------
// Defaults (your template)
// ------------------------
const DEFAULT_PLAN = {
  morning: ["Multivitamine", "B12", "Ijzer & vitamine C", "Complex weerstand"],
  midday: ["B-complex", "(B12)"],
  evening: [],
};

const MEALS = [
  "Ontbijt",
  "Tussendoortje 1",
  "Lunch",
  "Tussendoortje 2",
  "Avondeten",
  "2L water (minimaal)",
];

// ------------------------
// DOM
// ------------------------
const el = {
  monthTitle: document.getElementById("monthTitle"),
  weekTitle: document.getElementById("weekTitle"),
  daysGrid: document.getElementById("daysGrid"),

  weeklyCompletion: document.getElementById("weeklyCompletion"),
  streakPill: document.getElementById("streakPill"),

  prevWeekBtn: document.getElementById("prevWeekBtn"),
  nextWeekBtn: document.getElementById("nextWeekBtn"),
  todayBtn: document.getElementById("todayBtn"),

  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  editPlanBtn: document.getElementById("editPlanBtn"),
  userBadge: document.getElementById("userBadge"),
  userName: document.getElementById("userName"),

  planModal: document.getElementById("planModal"),
  planModalBackdrop: document.getElementById("planModalBackdrop"),
  closePlanModalBtn: document.getElementById("closePlanModalBtn"),

  planMorning: document.getElementById("planMorning"),
  planMidday: document.getElementById("planMidday"),
  planEvening: document.getElementById("planEvening"),

  addMorningInput: document.getElementById("addMorningInput"),
  addMiddayInput: document.getElementById("addMiddayInput"),
  addEveningInput: document.getElementById("addEveningInput"),

  addMorningBtn: document.getElementById("addMorningBtn"),
  addMiddayBtn: document.getElementById("addMiddayBtn"),
  addEveningBtn: document.getElementById("addEveningBtn"),
};

// ------------------------
// State
// ------------------------
let currentUser = null;
let unsubPlan = null;
let unsubWeekDays = [];
let plan = structuredClone(DEFAULT_PLAN);
let weekStart = startOfWeek(new Date()); // Monday
let dayDocs = new Map(); // yyyy-mm-dd -> doc data

// ------------------------
// Helpers: dates + labels
// ------------------------
const DUTCH_DAYS = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
const DUTCH_MONTHS = [
  "JANUARI",
  "FEBRUARI",
  "MAART",
  "APRIL",
  "MEI",
  "JUNI",
  "JULI",
  "AUGUSTUS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DECEMBER",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODate(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = pad2(x.getMonth() + 1);
  const dd = pad2(x.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun ... 1=Mon
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatRangeDutch(d1, d2) {
  // "19 jan - 25 jan" (lowercase month abbreviation)
  const m = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const a = new Date(d1);
  const b = new Date(d2);
  return `${a.getDate()} ${m[a.getMonth()]} - ${b.getDate()} ${m[b.getMonth()]}`;
}

function monthTitleForWeek(d) {
  // For your look: show the month of weekStart (common journaling style)
  return DUTCH_MONTHS[d.getMonth()];
}

// ------------------------
// Firestore paths
// ------------------------
function userRoot(uid) {
  return doc(db, "users", uid);
}

function userPlanRef(uid) {
  return doc(db, "users", uid, "meta", "plan");
}

function userDayRef(uid, isoDate) {
  return doc(db, "users", uid, "days", isoDate);
}

// ------------------------
// Data initialization
// ------------------------
async function ensureUserDocs(uid) {
  // Create user root (optional metadata)
  await setDoc(userRoot(uid), { createdAt: Date.now() }, { merge: true });

  // Ensure plan exists
  const planRef = userPlanRef(uid);
  const snap = await getDoc(planRef);
  if (!snap.exists()) {
    await setDoc(planRef, { ...DEFAULT_PLAN, updatedAt: Date.now() }, { merge: true });
  }
}

async function ensureDayDoc(uid, isoDate) {
  const ref = userDayRef(uid, isoDate);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const base = {
      date: isoDate,
      meals: Object.fromEntries(MEALS.map((k) => [k, false])),
      taken: {
        morning: {},
        midday: {},
        evening: {},
      },
      updatedAt: Date.now(),
    };
    await setDoc(ref, base, { merge: true });
  }
}

// ------------------------
// Rendering
// ------------------------
function computeDayProgress(dayData) {
  // total tasks = supplements (from plan) + meals
  const totalSupps = plan.morning.length + plan.midday.length + plan.evening.length;

  const totalMeals = MEALS.length;

  let doneSupps = 0;
  for (const slot of ["morning", "midday", "evening"]) {
    const slotMap = dayData?.taken?.[slot] || {};
    for (const s of plan[slot]) {
      if (slotMap[s] === true) {
        doneSupps += 1;
      }
    }
  }

  let doneMeals = 0;
  const mealsMap = dayData?.meals || {};
  for (const m of MEALS) {
    if (mealsMap[m] === true) {
      doneMeals += 1;
    }
  }

  const total = totalSupps + totalMeals;
  const done = doneSupps + doneMeals;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const fullyDone = total > 0 && done === total;
  return { total, done, pct, fullyDone };
}

function renderWeek() {
  el.monthTitle.textContent = monthTitleForWeek(weekStart);

  const weekEnd = addDays(weekStart, 6);
  el.weekTitle.textContent = `Week ${formatRangeDutch(weekStart, weekEnd)}`;

  el.daysGrid.innerHTML = "";

  for (let i = 0; i < 7; i++) {
    const dateObj = addDays(weekStart, i);
    const iso = toISODate(dateObj);
    const dayName = DUTCH_DAYS[dateObj.getDay()];
    const dayData = dayDocs.get(iso) || null;

    const { pct } = computeDayProgress(dayData);

    const card = document.createElement("article");
    card.className = "card";

    card.innerHTML = `
      <div class="card__header">
        <div>
          <div class="card__title">${dayName} ${dateObj.getDate()} ${formatMonthShort(dateObj)}</div>
          <div class="card__subtitle">${iso}</div>
        </div>
        <span class="pill">${pct}%</span>
      </div>

      <div class="sectionTitle">Supplementen</div>
      <table class="table" aria-label="Supplementen tabel">
        <tr>
          <td>Ochtend</td>
          <td>${renderSuppChecklist("morning", iso, dayData)}</td>
        </tr>
        <tr>
          <td>Middag</td>
          <td>${renderSuppChecklist("midday", iso, dayData)}</td>
        </tr>
        <tr>
          <td>Avond</td>
          <td>${renderSuppChecklist("evening", iso, dayData)}</td>
        </tr>
      </table>

      <div class="sectionTitle">Maaltijden</div>
      <ul class="checklist">
        ${MEALS.map((m) => renderMealItem(iso, m, dayData)).join("")}
      </ul>
    `;

    el.daysGrid.appendChild(card);
  }

  wireCardHandlers();
  updateWeekStats();
}

function formatMonthShort(d) {
  const m = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return m[d.getMonth()];
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSuppChecklist(slot, iso, dayData) {
  const takenMap = dayData?.taken?.[slot] || {};
  const list = plan[slot];

  if (!list.length) {
    return '<div class="card__subtitle">Geen</div>';
  }

  return `
    <ul class="checklist">
      ${list
        .map((name) => {
          const checked = takenMap[name] === true;
          const id = `supp__${slot}__${iso}__${name}`;
          return `
            <li class="item">
              <input type="checkbox"
                     data-kind="supp"
                     data-slot="${slot}"
                     data-date="${iso}"
                     data-name="${esc(name)}"
                     id="${esc(id)}"
                     ${checked ? "checked" : ""} />
              <label class="item__label" for="${esc(id)}">${esc(name)}</label>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function renderMealItem(iso, mealName, dayData) {
  const mealsMap = dayData?.meals || {};
  const checked = mealsMap[mealName] === true;
  const id = `meal__${iso}__${mealName}`;
  return `
    <li class="item">
      <input type="checkbox"
             data-kind="meal"
             data-date="${iso}"
             data-name="${esc(mealName)}"
             id="${esc(id)}"
             ${checked ? "checked" : ""} />
      <label class="item__label" for="${esc(id)}">${esc(mealName)}</label>
    </li>
  `;
}

// ------------------------
// Event wiring
// ------------------------
function wireCardHandlers() {
  const inputs = el.daysGrid.querySelectorAll('input[type="checkbox"]');
  inputs.forEach((inp) => {
    inp.addEventListener("change", async (e) => {
      if (!currentUser) {
        return;
      }
      const t = e.currentTarget;

      const kind = t.dataset.kind;
      const iso = t.dataset.date;
      const name = t.dataset.name;
      const checked = t.checked === true;

      await ensureDayDoc(currentUser.uid, iso);

      const ref = userDayRef(currentUser.uid, iso);

      if (kind === "meal") {
        await updateDoc(ref, {
          [`meals.${name}`]: checked,
          updatedAt: Date.now(),
        });
      } else if (kind === "supp") {
        const slot = t.dataset.slot;
        await updateDoc(ref, {
          [`taken.${slot}.${name}`]: checked,
          updatedAt: Date.now(),
        });
      }
    });
  });
}

function updateWeekStats() {
  // weekly completion: average of day pct
  let sum = 0;
  let count = 0;

  // streak: consecutive fully-complete days ending today (or latest completed)
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const iso = toISODate(addDays(weekStart, i));
    const dd = dayDocs.get(iso);
    const { pct } = computeDayProgress(dd);
    sum += pct;
    count += 1;
  }

  const weeklyPct = count ? Math.round(sum / count) : 0;
  el.weeklyCompletion.textContent = `Week: ${weeklyPct}%`;

  // Streak calculation (needs docs; missing doc => not complete)
  for (let back = 0; back < 365; back++) {
    const iso = toISODate(cursor);
    const dd = dayDocs.get(iso);
    const { fullyDone } = computeDayProgress(dd);
    if (fullyDone) {
      streak += 1;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }

  el.streakPill.textContent = `Streak: ${streak}`;
}

// ------------------------
// Plan modal
// ------------------------
function openPlanModal() {
  el.planModal.hidden = false;
  renderPlanModal();
}

function closePlanModal() {
  el.planModal.hidden = true;
}

function renderPlanModal() {
  renderPlanList("morning", el.planMorning);
  renderPlanList("midday", el.planMidday);
  renderPlanList("evening", el.planEvening);
}

function renderPlanList(slot, container) {
  container.innerHTML = "";
  const list = plan[slot];

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "card__subtitle";
    empty.textContent = "Geen";
    container.appendChild(empty);
    return;
  }

  list.forEach((name) => {
    const row = document.createElement("div");
    row.className = "planRow";
    row.innerHTML = `
      <div class="planRow__name">${esc(name)}</div>
      <button class="btn btn--ghost planRow__del" data-del-slot="${slot}" data-del-name="${esc(name)}">Verwijderen</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("[data-del-slot]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const s = b.dataset.delSlot;
      const n = b.dataset.delName;
      await removeSupplement(s, n);
    });
  });
}

async function addSupplement(slot, value) {
  if (!currentUser) {
    return;
  }
  const name = (value || "").trim();
  if (!name) {
    return;
  }

  if (!plan[slot].includes(name)) {
    plan[slot] = [...plan[slot], name];
    await setDoc(
      userPlanRef(currentUser.uid),
      { [slot]: plan[slot], updatedAt: Date.now() },
      { merge: true }
    );
  }
}

async function removeSupplement(slot, name) {
  if (!currentUser) {
    return;
  }
  plan[slot] = plan[slot].filter((x) => x !== name);
  await setDoc(
    userPlanRef(currentUser.uid),
    { [slot]: plan[slot], updatedAt: Date.now() },
    { merge: true }
  );
}

// ------------------------
// Subscriptions (plan + week days)
// ------------------------
function clearWeekSubscriptions() {
  unsubWeekDays.forEach((fn) => fn && fn());
  unsubWeekDays = [];
  dayDocs.clear();
}

async function subscribePlan(uid) {
  if (unsubPlan) {
    unsubPlan();
  }

  unsubPlan = onSnapshot(userPlanRef(uid), (snap) => {
    const data = snap.data();
    if (!data) {
      return;
    }

    plan = {
      morning: Array.isArray(data.morning) ? data.morning : [],
      midday: Array.isArray(data.midday) ? data.midday : [],
      evening: Array.isArray(data.evening) ? data.evening : [],
    };

    renderWeek();
    renderPlanModal();
  });
}

async function subscribeWeekDays(uid) {
  clearWeekSubscriptions();

  // Ensure docs exist so UI has predictable structure
  for (let i = 0; i < 7; i++) {
    const iso = toISODate(addDays(weekStart, i));
    await ensureDayDoc(uid, iso);

    const ref = userDayRef(uid, iso);
    const unsub = onSnapshot(ref, (snap) => {
      dayDocs.set(iso, snap.data() || null);
      renderWeek();
    });
    unsubWeekDays.push(unsub);
  }
}

// ------------------------
// Auth
// ------------------------
el.loginBtn.addEventListener("click", async () => {
  await signInWithPopup(auth, googleProvider);
});

el.logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;

  el.loginBtn.hidden = !!currentUser;
  el.logoutBtn.hidden = !currentUser;
  el.userBadge.hidden = !currentUser;

  el.editPlanBtn.disabled = !currentUser;

  if (!currentUser) {
    if (unsubPlan) {
      unsubPlan();
    }
    clearWeekSubscriptions();
    el.daysGrid.innerHTML =
      '<div class="card"><div class="card__title">Login om te starten</div><div class="card__subtitle">Je schema wordt per gebruiker opgeslagen in Firebase.</div></div>';
    return;
  }

  el.userName.textContent = currentUser.displayName || "Ingelogd";

  await ensureUserDocs(currentUser.uid);
  await subscribePlan(currentUser.uid);
  await subscribeWeekDays(currentUser.uid);
});

// ------------------------
// Week navigation
// ------------------------
el.prevWeekBtn.addEventListener("click", async () => {
  weekStart = addDays(weekStart, -7);
  if (currentUser) {
    await subscribeWeekDays(currentUser.uid);
  }
  renderWeek();
});

el.nextWeekBtn.addEventListener("click", async () => {
  weekStart = addDays(weekStart, 7);
  if (currentUser) {
    await subscribeWeekDays(currentUser.uid);
  }
  renderWeek();
});

el.todayBtn.addEventListener("click", async () => {
  weekStart = startOfWeek(new Date());
  if (currentUser) {
    await subscribeWeekDays(currentUser.uid);
  }
  renderWeek();
});

// ------------------------
// Plan modal events
// ------------------------
el.editPlanBtn.addEventListener("click", () => openPlanModal());
el.closePlanModalBtn.addEventListener("click", () => closePlanModal());
el.planModalBackdrop.addEventListener("click", () => closePlanModal());

el.addMorningBtn.addEventListener("click", async () => {
  await addSupplement("morning", el.addMorningInput.value);
  el.addMorningInput.value = "";
});

el.addMiddayBtn.addEventListener("click", async () => {
  await addSupplement("midday", el.addMiddayInput.value);
  el.addMiddayInput.value = "";
});

el.addEveningBtn.addEventListener("click", async () => {
  await addSupplement("evening", el.addEveningInput.value);
  el.addEveningInput.value = "";
});

["addMorningInput", "addMiddayInput", "addEveningInput"].forEach((id) => {
  const input = el[id];
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") {
      return;
    }
    if (id === "addMorningInput") {
      el.addMorningBtn.click();
    }
    if (id === "addMiddayInput") {
      el.addMiddayBtn.click();
    }
    if (id === "addEveningInput") {
      el.addEveningBtn.click();
    }
  });
});

// Initial render (logged out state)
renderWeek();
