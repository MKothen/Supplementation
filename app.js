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
  collection,
  query,
  where,
  getDocs,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ------------------------
// Defaults (your template)
// ------------------------
const DEFAULT_PLAN = {
  morning: ["Multivitamine", "B12", "Ijzer & vitamine C", "Complex weerstand"],
  midday: ["B-complex", "(B12)"],
  evening: [],
  inventory: {} // maps supplement name -> count (int)
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
  weekRange: document.getElementById("weekRange"),
  daysGrid: document.getElementById("daysGrid"),

  weeklyCompletion: document.getElementById("weeklyCompletion"),
  streakPill: document.getElementById("streakPill"),

  prevWeekBtn: document.getElementById("prevWeekBtn"),
  nextWeekBtn: document.getElementById("nextWeekBtn"),
  todayBtn: document.getElementById("todayBtn"),

  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  editPlanBtn: document.getElementById("editPlanBtn"),
  calendarBtn: document.getElementById("calendarBtn"), 

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

  // Calendar Modal DOM
  calendarModal: document.getElementById("calendarModal"),
  calendarModalBackdrop: document.getElementById("calendarModalBackdrop"),
  closeCalendarModalBtn: document.getElementById("closeCalendarModalBtn"),
  calPrevMonth: document.getElementById("calPrevMonth"),
  calNextMonth: document.getElementById("calNextMonth"),
  calMonthDisplay: document.getElementById("calMonthDisplay"),
  heatmapGrid: document.getElementById("heatmapGrid"),
};

// ------------------------
// State
// ------------------------
let currentUser = null;
let unsubPlan = null;
let unsubWeekDays = [];
let plan = structuredClone(DEFAULT_PLAN);
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
let weekStart = startOfWeek(currentDate); // Monday
let dayDocs = new Map(); // yyyy-mm-dd -> doc data

// Calendar State
let calCursor = new Date(); // Tracks the month shown in the calendar

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
  const m = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const a = new Date(d1);
  const b = new Date(d2);
  return `${a.getDate()} ${m[a.getMonth()]} - ${b.getDate()} ${m[b.getMonth()]}`;
}

function monthTitleForDate(d) {
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
      mood: 0,
      energy: 0,
      sleepHours: 0,
      updatedAt: Date.now(),
    };
    await setDoc(ref, base, { merge: true });
  }
}

// ------------------------
// Rendering
// ------------------------
function computeDayProgress(dayData) {
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

function renderDay() {
  el.monthTitle.textContent = monthTitleForDate(currentDate);

  const weekEnd = addDays(weekStart, 6);
  el.weekTitle.textContent = `${DUTCH_DAYS[currentDate.getDay()]} ${currentDate.getDate()} ${formatMonthShort(
    currentDate
  )}`;
  el.weekRange.textContent = `Week ${formatRangeDutch(weekStart, weekEnd)}`;

  el.daysGrid.innerHTML = "";

  const iso = toISODate(currentDate);
  const dayData = dayDocs.get(iso) || null;

  const { pct } = computeDayProgress(dayData);

  const card = document.createElement("article");
  card.className = "card";

  card.innerHTML = `
    <div class="card__header">
      <div>
        <div class="card__title">${DUTCH_DAYS[currentDate.getDay()]} ${currentDate.getDate()} ${formatMonthShort(
          currentDate
        )}</div>
        <div class="card__subtitle">${iso}</div>
      </div>
      <span class="pill">${pct}%</span>
    </div>

    <!-- Sleep Section -->
    <div class="sectionTitle">Slaap</div>
    <div class="metrics">
      <div class="metric">
        <label class="metric__label">Uren geslapen <span id="val_sleepHours">${dayData?.sleepHours || 0}</span></label>
        <div style="display: flex; gap: 10px; align-items: center;">
             <input type="range" class="slider" min="0" max="12" step="0.5"
               data-kind="metric" data-field="sleepHours" data-date="${iso}"
               value="${dayData?.sleepHours || 0}" style="flex:1">
        </div>
      </div>
    </div>

    <!-- Mood/Energy Section -->
    <div class="sectionTitle">Check-in</div>
    <div class="metrics">
      <div class="metric">
        <label class="metric__label">Energie <span id="val_energy">${dayData?.energy || 0}</span>/10</label>
        <input type="range" class="slider" min="0" max="10" step="1"
               data-kind="metric" data-field="energy" data-date="${iso}"
               value="${dayData?.energy || 0}">
      </div>
      <div class="metric">
        <label class="metric__label">Stemming <span id="val_mood">${dayData?.mood || 0}</span>/10</label>
        <input type="range" class="slider" min="0" max="10" step="1"
               data-kind="metric" data-field="mood" data-date="${iso}"
               value="${dayData?.mood || 0}">
      </div>
    </div>

    <div class="sectionTitle" style="display:flex; justify-content:space-between; align-items:center;">
       <span>Supplementen</span>
       <button class="btn btn--ghost pill" style="font-size: 11px; padding: 4px 8px;" 
               data-action="select-all-supps" data-date="${iso}">Alles afvinken</button>
    </div>
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
          
          // Stock Logic
          const stock = plan.inventory?.[name] ?? 0;
          let stockBadge = "";
          if (plan.inventory && name in plan.inventory) {
             const isLow = stock <= 5;
             stockBadge = `<span class="stock-tag ${isLow ? 'low' : ''}">${stock} over</span>`;
          }

          return `
            <li class="item">
              <input type="checkbox"
                     data-kind="supp"
                     data-slot="${slot}"
                     data-date="${iso}"
                     data-name="${esc(name)}"
                     id="${esc(id)}"
                     ${checked ? "checked" : ""} />
              <label class="item__label" for="${esc(id)}">
                 ${esc(name)}
                 ${stockBadge}
              </label>
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
      if (!currentUser) return;
      const t = e.currentTarget;
      const kind = t.dataset.kind;
      const iso = t.dataset.date;
      const name = t.dataset.name;
      const checked = t.checked === true;

      await handleCheck(iso, kind, name, checked, t.dataset.slot);
    });
  });

  // Metrics (Sleep, Energy, Mood)
  const metrics = el.daysGrid.querySelectorAll('input[data-kind="metric"]');
  metrics.forEach(inp => {
      inp.addEventListener('input', (e) => {
           const field = e.target.dataset.field;
           const val = e.target.value;
           const span = e.target.previousElementSibling.querySelector('span');
           if(span) span.textContent = val;
      });
      inp.addEventListener('change', async (e) => {
           if(!currentUser) return;
           const field = e.target.dataset.field;
           const iso = e.target.dataset.date;
           // sleepHours can be float
           const val = field === 'sleepHours' ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
           await ensureDayDoc(currentUser.uid, iso);
           const ref = userDayRef(currentUser.uid, iso);
           await updateDoc(ref, {
               [field]: val,
               updatedAt: Date.now()
           });
      });
  });

  // Select All Button
  const selAllBtns = el.daysGrid.querySelectorAll('button[data-action="select-all-supps"]');
  selAllBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
          if(!currentUser) return;
          const iso = e.currentTarget.dataset.date;
          // Trigger 'Select All' Logic
          await selectAllSupplements(iso);
      });
  });
}

// Helper to centralize checkbox logic (so we can reuse for 'Select All')
async function handleCheck(iso, kind, name, checked, slot = null) {
      if(!currentUser) return;
      await ensureDayDoc(currentUser.uid, iso);
      const ref = userDayRef(currentUser.uid, iso);

      if (kind === "meal") {
        await updateDoc(ref, {
          [`meals.${name}`]: checked,
          updatedAt: Date.now(),
        });
      } else if (kind === "supp") {
        // Update daily usage
        await updateDoc(ref, {
          [`taken.${slot}.${name}`]: checked,
          updatedAt: Date.now(),
        });
        
        // Update Inventory if tracked
        if (plan.inventory && (name in plan.inventory)) {
           const changeAmount = checked ? -1 : 1;
           const pRef = userPlanRef(currentUser.uid);
           await updateDoc(pRef, {
               [`inventory.${name}`]: increment(changeAmount)
           });
        }
      }
}

// Logic for 'Select All'
async function selectAllSupplements(iso) {
    if(!currentUser) return;
    
    // We need to iterate over all morning/midday/evening items in the PLAN
    // and check if they are ALREADY taken in the dayDocs.
    // If NOT taken -> mark as taken (true) AND decrement inventory.
    
    const dayData = dayDocs.get(iso);
    const updates = {};
    const inventoryUpdates = {};
    
    // Helper to process a slot
    const processSlot = (slotName) => {
        const items = plan[slotName] || [];
        const takenMap = dayData?.taken?.[slotName] || {};
        
        items.forEach(name => {
            if (takenMap[name] !== true) {
                // Not yet taken, so we 'take' it
                updates[`taken.${slotName}.${name}`] = true;
                
                // Track inventory decrement
                if (plan.inventory && (name in plan.inventory)) {
                    // Accumulate inventory changes? 
                    // Firestore updateDoc can't do multiple increments on same field easily in one go if key is dynamic?
                    // actually it can: { "inventory.B12": increment(-1) }
                    // If same item appears multiple times in day (rare), we'd need to sum it up.
                    // Assuming unique names per plan for simplicity or just simple increment.
                    if(!inventoryUpdates[name]) inventoryUpdates[name] = 0;
                    inventoryUpdates[name] -= 1;
                }
            }
        });
    };

    processSlot("morning");
    processSlot("midday");
    processSlot("evening");
    
    if (Object.keys(updates).length === 0) {
        // All already selected
        return;
    }
    
    // 1. Update Day Doc (mark all as taken)
    await ensureDayDoc(currentUser.uid, iso);
    const dayRef = userDayRef(currentUser.uid, iso);
    updates.updatedAt = Date.now();
    await updateDoc(dayRef, updates);
    
    // 2. Update Inventory (batch decrements)
    if (Object.keys(inventoryUpdates).length > 0) {
        const pRef = userPlanRef(currentUser.uid);
        const invPayload = {};
        for (const [name, change] of Object.entries(inventoryUpdates)) {
            invPayload[`inventory.${name}`] = increment(change);
        }
        await updateDoc(pRef, invPayload);
    }
}


function updateWeekStats() {
  let sum = 0;
  let count = 0;
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
    
    const stockVal = (plan.inventory && plan.inventory[name]) ?? 0;

    row.innerHTML = `
      <div class="planRow__name">${esc(name)}</div>
      
      <input type="number" 
             class="planRow__stock" 
             placeholder="#" 
             value="${stockVal}"
             data-set-stock="${esc(name)}"
             title="Voorraad"
      />

      <button class="btn btn--ghost planRow__del" data-del-slot="${slot}" data-del-name="${esc(name)}">Del</button>
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

  container.querySelectorAll("[data-set-stock]").forEach((inp) => {
      inp.addEventListener("change", async (e) => {
          const n = e.target.dataset.setStock;
          const val = parseInt(e.target.value, 10) || 0;
          await updateStock(n, val);
      });
  });
}

async function addSupplement(slot, value) {
  if (!currentUser) return;
  const name = (value || "").trim();
  if (!name) return;

  if (!plan[slot].includes(name)) {
    plan[slot] = [...plan[slot], name];
    const invUpdate = { [`inventory.${name}`]: 30 };
    
    await updateDoc(userPlanRef(currentUser.uid), { 
        [slot]: plan[slot], 
        ...invUpdate,
        updatedAt: Date.now() 
    });
  }
}

async function removeSupplement(slot, name) {
  if (!currentUser) return;
  plan[slot] = plan[slot].filter((x) => x !== name);
  await updateDoc(userPlanRef(currentUser.uid), { 
      [slot]: plan[slot], 
      updatedAt: Date.now() 
  });
}

async function updateStock(name, count) {
    if(!currentUser) return;
    await updateDoc(userPlanRef(currentUser.uid), {
        [`inventory.${name}`]: count,
        updatedAt: Date.now()
    });
}

// ------------------------
// Subscriptions
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
      inventory: data.inventory || {}
    };

    renderDay();
    renderPlanModal();
  });
}

async function subscribeWeekDays(uid) {
  clearWeekSubscriptions();

  for (let i = 0; i < 7; i++) {
    const iso = toISODate(addDays(weekStart, i));
    await ensureDayDoc(uid, iso);

    const ref = userDayRef(uid, iso);
    const unsub = onSnapshot(ref, (snap) => {
      dayDocs.set(iso, snap.data() || null);
      renderDay();
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
  if(el.calendarBtn) el.calendarBtn.disabled = !currentUser; 

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
// Day navigation
// ------------------------
function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

async function updateWeekSubscriptionIfNeeded() {
  const nextWeekStart = startOfWeek(currentDate);
  if (!isSameDay(weekStart, nextWeekStart)) {
    weekStart = nextWeekStart;
    if (currentUser) {
      await subscribeWeekDays(currentUser.uid);
    }
  }
}

el.prevWeekBtn.addEventListener("click", async () => {
  currentDate = addDays(currentDate, -1);
  await updateWeekSubscriptionIfNeeded();
  renderDay();
});

el.nextWeekBtn.addEventListener("click", async () => {
  currentDate = addDays(currentDate, 1);
  await updateWeekSubscriptionIfNeeded();
  renderDay();
});

el.todayBtn.addEventListener("click", async () => {
  currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  await updateWeekSubscriptionIfNeeded();
  renderDay();
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

// ------------------------
// Calendar Modal Logic
// ------------------------
el.calendarBtn.addEventListener("click", () => {
  if(!currentUser) return; 
  openCalendarModal();
});

el.closeCalendarModalBtn.addEventListener("click", () => {
  el.calendarModal.hidden = true;
});

el.calendarModalBackdrop.addEventListener("click", () => {
  el.calendarModal.hidden = true;
});

el.calPrevMonth.addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() - 1);
  renderCalendarGrid();
});

el.calNextMonth.addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() + 1);
  renderCalendarGrid();
});

function openCalendarModal() {
  el.calendarModal.hidden = false;
  calCursor = new Date(currentDate);
  calCursor.setDate(1); 
  renderCalendarGrid();
}

async function renderCalendarGrid() {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  
  const monthName = DUTCH_MONTHS[m];
  el.calMonthDisplay.textContent = `${monthName} ${y}`;

  el.heatmapGrid.innerHTML = '<div class="card__subtitle" style="grid-column: 1/-1; text-align:center;">Laden...</div>';

  const firstDayOfMonth = new Date(y, m, 1);
  let startDay = firstDayOfMonth.getDay(); 
  startDay = (startDay === 0 ? 6 : startDay - 1);

  const lastDayOfMonth = new Date(y, m + 1, 0).getDate();
  
  const startIso = toISODate(new Date(y, m, 1));
  const endIso = toISODate(new Date(y, m, lastDayOfMonth));

  let monthData = new Map();
  if (currentUser) {
    try {
      const q = query(
        collection(db, "users", currentUser.uid, "days"),
        where("date", ">=", startIso),
        where("date", "<=", endIso)
      );
      const snap = await getDocs(q);
      snap.forEach(docSnap => {
        monthData.set(docSnap.id, docSnap.data());
      });
    } catch (err) {
      console.error("Error fetching month data", err);
    }
  }

  el.heatmapGrid.innerHTML = "";

  for (let i = 0; i < startDay; i++) {
    const d = document.createElement("div");
    el.heatmapGrid.appendChild(d);
  }

  const todayIso = toISODate(new Date());

  for (let d = 1; d <= lastDayOfMonth; d++) {
    const currentIterDate = new Date(y, m, d);
    const iso = toISODate(currentIterDate);
    
    const dayData = monthData.get(iso);
    const { pct } = computeDayProgress(dayData);

    let level = 0;
    if (pct > 0) level = 1;
    if (pct > 20) level = 2;
    if (pct > 40) level = 3;
    if (pct > 60) level = 4;
    if (pct > 80) level = 5;

    const cell = document.createElement("div");
    cell.className = `heatmap-day level-${level}`;
    if (iso === todayIso) {
      cell.classList.add("is-today");
    }
    cell.textContent = d;
    cell.title = `${iso}: ${pct}%`; 

    el.heatmapGrid.appendChild(cell);
  }
}

renderDay();
