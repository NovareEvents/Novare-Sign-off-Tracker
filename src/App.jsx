import { useState, useEffect, useCallback } from "react";
import Papa from "papaparse";
import { storage, localPref } from "./lib/db";
import {
  Check,
  Clock,
  MapPin,
  Plus,
  X,
  ShieldCheck,
  User,
  Users,
  ChevronRight,
  Loader2,
  AlertCircle,
  Trash2,
  UploadCloud,
  Mail,
  Phone,
  BadgeCheck,
} from "lucide-react";

// ---- Design tokens ------------------------------------------------------
const C = {
  bg: "#12151B",
  surface: "#1B2029",
  surfaceAlt: "#232A35",
  border: "#2C3440",
  text: "#EDEEF2",
  textMuted: "#8A93A3",
  textFaint: "#5B6472",
  gold: "#E8A33D",
  goldDim: "#3A3323",
  blue: "#4C86C9",
  brick: "#B5563F",
  green: "#4C9A72",
};

const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
    .nv-display { font-family: 'Space Grotesk', sans-serif; }
    .nv-body { font-family: 'Inter', sans-serif; }
    .nv-mono { font-family: 'IBM Plex Mono', monospace; }
    .nv-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
    .nv-scroll::-webkit-scrollbar-thumb { background: #2C3440; border-radius: 3px; }
    input, select { color-scheme: dark; }
  `}</style>
);

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const SHIFTS_PER_VENUE = 2;

const DEFAULT_VENUES = [
  "103 West",
  "The Biltmore",
  "Guardian Works",
  "433 Bishop",
  "Bishop Station",
  "Summerour",
  "Westhouse",
  "The Stave Room",
  "The Foundry at Puritan Mill",
].map((name, i) => ({ id: `v${i + 1}`, name }));

const selectStyle = {
  background: C.surface,
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "8px 10px",
};

// ---- fuzzy matching helpers (used for Nowsta verification) ----
function guessColumn(headers, keywords) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx !== -1) return headers[idx];
  }
  return "";
}
function normalize(str) {
  return (str || "").toString().trim().toLowerCase();
}
function namesMatch(raw, name) {
  const a = normalize(raw);
  const b = normalize(name);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// Known naming quirks where Nowsta's venue text doesn't textually overlap
// with the venue's real name (e.g. an older/alternate label for the same place).
const VENUE_ALIASES = {
  "puritan mill 2": "the foundry at puritan mill",
};

// Looser matcher for venue names specifically: strips a leading "The " so
// sub-room names like "Biltmore Ballroom - Georgian" still match "The Biltmore".
function venueNamesMatch(raw, venueName) {
  const strip = (s) => normalize(s).replace(/^the\s+/, "");
  const a = strip(raw);
  const b = strip(venueName);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const alias = VENUE_ALIASES[normalize(raw)];
  return alias ? strip(alias) === b : false;
}
function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Parses a Nowsta availability-export column header like
// "Jul 11 @4:00pm - Jericka & Key'on's Wedding - WCR" into a month/day and a label.
function parseAvailabilityHeader(header) {
  const m = (header || "").match(/^(.*?@\s*(\d{1,2}:\d{2}\s*[apAP][mM]))\s*-\s*(.+)$/);
  if (!m) return null;
  const dateTimePart = m[1];
  const time = m[2];
  const label = m[3].trim();
  const dateMatch = dateTimePart.match(/^([A-Za-z]{3,9}\s+\d{1,2})/);
  if (!dateMatch) return null;
  return { monthDay: dateMatch[1].trim(), time, label };
}

function buildDateFromMonthDayYear(monthDay, year) {
  const d = new Date(`${monthDay} ${year}`);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const [venues, setVenues] = useState([]);
  const [trainees, setTrainees] = useState([]);
  const [managers, setManagers] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);

  const [role, setRole] = useState("trainee");
  const [activeTraineeId, setActiveTraineeId] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [eventVenueMap, setEventVenueMap] = useState({});
  const [calendarEvents, setCalendarEvents] = useState([]);

  // ---- load ----
  useEffect(() => {
    (async () => {
      try {
        let roster = { venues: DEFAULT_VENUES, trainees: [], managers: [] };
        try {
          const r = await storage.get("novare-roster");
          if (r && r.value) roster = JSON.parse(r.value);
        } catch (e) {
          await storage.set("novare-roster", JSON.stringify(roster));
        }
        setVenues(roster.venues || DEFAULT_VENUES);
        setTrainees(roster.trainees || []);
        setManagers(roster.managers || []);

        let shiftList = [];
        try {
          const s = await storage.get("novare-shifts");
          if (s && s.value) shiftList = JSON.parse(s.value);
        } catch (e) {
          await storage.set("novare-shifts", JSON.stringify([]));
        }
        setShifts(shiftList);

        try {
          const em = await storage.get("novare-event-map");
          if (em && em.value) setEventVenueMap(JSON.parse(em.value));
        } catch (e) {
          /* no map yet */
        }

        try {
          const ce = await storage.get("novare-calendar-events");
          if (ce && ce.value) setCalendarEvents(JSON.parse(ce.value));
        } catch (e) {
          /* no calendar events yet */
        }

        try {
          const me = await localPref.get("novare-me");
          if (me && me.value) {
            const parsed = JSON.parse(me.value);
            if (parsed.role) setRole(parsed.role);
            if (parsed.traineeId) setActiveTraineeId(parsed.traineeId);
          }
        } catch (e) {
          /* no personal record yet */
        }
      } catch (err) {
        setSaveError("Couldn't load saved data. You can still use the app this session.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persistRoster = useCallback(async (nextVenues, nextTrainees, nextManagers) => {
    try {
      await storage.set(
        "novare-roster",
        JSON.stringify({ venues: nextVenues, trainees: nextTrainees, managers: nextManagers })
      );
    } catch (e) {
      setSaveError("Changes are showing here but failed to save. Try again.");
    }
  }, []);

  const persistShifts = useCallback(async (next) => {
    try {
      await storage.set("novare-shifts", JSON.stringify(next));
    } catch (e) {
      setSaveError("Changes are showing here but failed to save. Try again.");
    }
  }, []);

  const persistEventMap = useCallback(async (next) => {
    try {
      await storage.set("novare-event-map", JSON.stringify(next));
    } catch (e) {
      setSaveError("Changes are showing here but failed to save. Try again.");
    }
  }, []);

  const persistCalendarEvents = useCallback(async (next) => {
    try {
      await storage.set("novare-calendar-events", JSON.stringify(next));
    } catch (e) {
      setSaveError("Changes are showing here but failed to save. Try again.");
    }
  }, []);

  const rememberMe = async (nextRole, traineeId) => {
    try {
      await localPref.set("novare-me", JSON.stringify({ role: nextRole, traineeId }));
    } catch (e) {
      /* non-critical */
    }
  };

  // ---- roster actions ----
  const addTrainee = (name, pin) => {
    if (!name.trim()) return;
    const next = [...trainees, { id: uid(), name: name.trim(), pin: (pin || "").trim() }];
    setTrainees(next);
    persistRoster(venues, next, managers);
  };
  const resetTraineePin = (id, pin) => {
    const next = trainees.map((t) => (t.id === id ? { ...t, pin: (pin || "").trim() } : t));
    setTrainees(next);
    persistRoster(venues, next, managers);
  };
  const removeTrainee = (id) => {
    const next = trainees.filter((t) => t.id !== id);
    setTrainees(next);
    persistRoster(venues, next, managers);
  };
  const renameVenue = (id, name) => {
    const next = venues.map((v) => (v.id === id ? { ...v, name } : v));
    setVenues(next);
    persistRoster(next, trainees, managers);
  };
  const addVenue = () => {
    const next = [...venues, { id: uid(), name: `Venue ${venues.length + 1}` }];
    setVenues(next);
    persistRoster(next, trainees, managers);
  };
  const removeVenue = (id) => {
    const next = venues.filter((v) => v.id !== id);
    setVenues(next);
    persistRoster(next, trainees, managers);
  };
  const restoreDefaultVenues = () => {
    const next = DEFAULT_VENUES.map((v) => ({ ...v, id: uid() }));
    setVenues(next);
    persistRoster(next, trainees, managers);
  };
  const addManager = (name, phone, email) => {
    if (!name.trim()) return;
    const next = [...managers, { id: uid(), name: name.trim(), phone: phone.trim(), email: email.trim() }];
    setManagers(next);
    persistRoster(venues, trainees, next);
  };
  const removeManager = (id) => {
    const next = managers.filter((m) => m.id !== id);
    setManagers(next);
    persistRoster(venues, trainees, next);
  };

  // ---- shift actions ----
  const submitShift = (payload) => {
    const record = { id: uid(), createdAt: Date.now(), ...payload };
    const next = [record, ...shifts];
    setShifts(next);
    persistShifts(next);
  };

  const setShiftStatus = (id, status) => {
    const next = shifts.map((s) => (s.id === id ? { ...s, status } : s));
    setShifts(next);
    persistShifts(next);
  };

  // Bulk-add shifts from an admin's Nowsta CSV export. Skips exact duplicates
  // (same trainee + venue + date already present).
  const bulkImportShifts = (rows) => {
    const existingKeys = new Set(shifts.map((s) => `${s.traineeId}|${s.venueId}|${s.date}`));
    const additions = [];
    let skippedDupes = 0;
    rows.forEach((r) => {
      const key = `${r.traineeId}|${r.venueId}|${r.date}`;
      if (existingKeys.has(key)) {
        skippedDupes += 1;
        return;
      }
      existingKeys.add(key);
      additions.push({
        id: uid(),
        traineeId: r.traineeId,
        venueId: r.venueId,
        managerId: r.managerId || null,
        date: r.date,
        note: r.note || "Imported from Nowsta",
        status: "approved",
        loggedBy: "nowsta-import",
        nowstaVerified: true,
        createdAt: Date.now(),
      });
    });
    if (additions.length) {
      const next = [...additions, ...shifts];
      setShifts(next);
      persistShifts(next);
    }
    return { added: additions.length, skippedDupes };
  };

  // Reconcile "scheduled" (upcoming, not-yet-worked) shifts against a fresh
  // upload from one source (event-overview or worker-availability). A shift
  // that source previously reported but no longer does gets removed — it's
  // treated as no longer happening. Shifts already approved/pending/rejected
  // are never touched here, since those are resolved outcomes, not schedule.
  const bulkReconcileScheduled = (rows, source) => {
    const newKeys = new Set(rows.map((r) => `${r.traineeId}|${r.venueId}|${r.date}`));
    let removed = 0;
    const kept = shifts.filter((s) => {
      if (s.status !== "scheduled" || s.scheduleSource !== source) return true;
      const stillPresent = newKeys.has(`${s.traineeId}|${s.venueId}|${s.date}`);
      if (!stillPresent) removed += 1;
      return stillPresent;
    });
    const existingKeys = new Set(kept.map((s) => `${s.traineeId}|${s.venueId}|${s.date}`));
    const additions = [];
    rows.forEach((r) => {
      const key = `${r.traineeId}|${r.venueId}|${r.date}`;
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      additions.push({
        id: uid(),
        traineeId: r.traineeId,
        venueId: r.venueId,
        managerId: null,
        date: r.date,
        note: r.label ? `Scheduled: ${r.label}` : "Scheduled via Nowsta",
        status: "scheduled",
        loggedBy: "nowsta-scheduled",
        scheduleSource: source,
        nowstaVerified: false,
        createdAt: Date.now(),
      });
    });
    const next = [...additions, ...kept];
    setShifts(next);
    persistShifts(next);
    return { added: additions.length, removed };
  };

  const saveEventVenueMap = (next) => {
    setEventVenueMap(next);
    persistEventMap(next);
  };

  const dedupeAssignmentsByTrainee = (list) => {
    const map = {};
    list.forEach((a) => {
      map[a.traineeId] = a;
    });
    return Object.values(map);
  };

  // Reconcile the calendar against a fresh upload from one source. Events that
  // source still reports get updated; events it no longer reports get their
  // contribution from that source stripped (and the whole event removed if no
  // other source vouches for it); brand-new events get added.
  const mergeCalendarEvents = (newSnapshotEvents, source) => {
    const newByKey = {};
    newSnapshotEvents.forEach((e) => {
      newByKey[`${e.venueId}|${e.date}|${e.eventName}`] = e;
    });

    const resultByKey = {};
    calendarEvents.forEach((existing) => {
      const key = `${existing.venueId}|${existing.date}|${existing.eventName}`;
      const eventSources = existing.eventSources || (existing.source ? [existing.source] : ["event-overview"]);
      const hadThisSource = eventSources.includes(source);
      const newData = newByKey[key];

      if (newData) {
        const otherAssignments = (existing.assignments || []).filter((a) => a.source !== source);
        const theseAssignments = (newData.assignments || []).map((a) => ({ ...a, source }));
        resultByKey[key] = {
          ...existing,
          time: newData.time || existing.time,
          address: newData.address || existing.address,
          eventSources: Array.from(new Set([...eventSources, source])),
          assignments: dedupeAssignmentsByTrainee([...otherAssignments, ...theseAssignments]),
        };
        delete newByKey[key];
      } else if (hadThisSource) {
        const remainingSources = eventSources.filter((s) => s !== source);
        if (remainingSources.length > 0) {
          resultByKey[key] = {
            ...existing,
            eventSources: remainingSources,
            assignments: (existing.assignments || []).filter((a) => a.source !== source),
          };
        }
        // else: no source vouches for this event anymore — drop it entirely.
      } else {
        resultByKey[key] = existing;
      }
    });

    let addedCount = 0;
    Object.entries(newByKey).forEach(([key, e]) => {
      addedCount += 1;
      resultByKey[key] = {
        id: uid(),
        venueId: e.venueId,
        date: e.date,
        eventName: e.eventName,
        time: e.time || "",
        address: e.address || "",
        eventSources: [source],
        assignments: (e.assignments || []).map((a) => ({ ...a, source })),
      };
    });

    const next = Object.values(resultByKey);
    setCalendarEvents(next);
    persistCalendarEvents(next);
    return { count: newSnapshotEvents.length, added: addedCount };
  };

  const seedDemoData = () => {
    const demoVenues = [
      { id: uid(), name: "103 West" },
      { id: uid(), name: "The Biltmore" },
      { id: uid(), name: "Guardian Works" },
      { id: uid(), name: "433 Bishop" },
      { id: uid(), name: "Bishop Station" },
      { id: uid(), name: "Summerour" },
      { id: uid(), name: "Westhouse" },
      { id: uid(), name: "The Stave Room" },
      { id: uid(), name: "The Foundry at Puritan Mill" },
    ];
    const demoTrainees = [
      { id: uid(), name: "Jordan Reyes", pin: "1234" },
      { id: uid(), name: "Priya Nair", pin: "2345" },
      { id: uid(), name: "Sam Whitfield", pin: "3456" },
    ];
    const demoManagers = [
      { id: uid(), name: "Dana Kessler", phone: "(555) 210-4471", email: "dana.kessler@novare.com" },
      { id: uid(), name: "Marcus Webb", phone: "(555) 384-9012", email: "marcus.webb@novare.com" },
    ];
    const today = new Date();
    const daysAgo = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const demoShifts = [
      { id: uid(), traineeId: demoTrainees[0].id, venueId: demoVenues[0].id, managerId: demoManagers[0].id, date: daysAgo(20), note: "", status: "approved", loggedBy: "admin", nowstaVerified: false, createdAt: Date.now() - 20 },
      { id: uid(), traineeId: demoTrainees[0].id, venueId: demoVenues[0].id, managerId: demoManagers[0].id, date: daysAgo(14), note: "", status: "approved", loggedBy: "trainee-verified", nowstaVerified: true, createdAt: Date.now() - 19 },
      { id: uid(), traineeId: demoTrainees[0].id, venueId: demoVenues[1].id, managerId: demoManagers[1].id, date: daysAgo(10), note: "", status: "approved", loggedBy: "admin", nowstaVerified: false, createdAt: Date.now() - 18 },
      { id: uid(), traineeId: demoTrainees[0].id, venueId: demoVenues[1].id, managerId: demoManagers[1].id, date: daysAgo(7), note: "", status: "approved", loggedBy: "trainee-verified", nowstaVerified: true, createdAt: Date.now() - 17 },
      { id: uid(), traineeId: demoTrainees[0].id, venueId: demoVenues[2].id, managerId: demoManagers[0].id, date: daysAgo(2), note: "covered load-in", status: "pending", loggedBy: "trainee", nowstaVerified: false, createdAt: Date.now() - 1 },
      { id: uid(), traineeId: demoTrainees[1].id, venueId: demoVenues[0].id, managerId: demoManagers[0].id, date: daysAgo(30), note: "", status: "approved", loggedBy: "admin", nowstaVerified: false, createdAt: Date.now() - 30 },
      { id: uid(), traineeId: demoTrainees[1].id, venueId: demoVenues[3].id, managerId: demoManagers[1].id, date: daysAgo(12), note: "", status: "approved", loggedBy: "trainee-verified", nowstaVerified: true, createdAt: Date.now() - 12 },
      { id: uid(), traineeId: demoTrainees[2].id, venueId: demoVenues[4].id, managerId: demoManagers[0].id, date: daysAgo(3), note: "", status: "approved", loggedBy: "admin", nowstaVerified: false, createdAt: Date.now() - 3 },
    ];
    setVenues(demoVenues);
    setTrainees(demoTrainees);
    setManagers(demoManagers);
    setShifts(demoShifts);
    persistRoster(demoVenues, demoTrainees, demoManagers);
    persistShifts(demoShifts);
  };

  const resetAllData = () => {
    setVenues(DEFAULT_VENUES);
    setTrainees([]);
    setManagers([]);
    setShifts([]);
    persistRoster(DEFAULT_VENUES, [], []);
    persistShifts([]);
  };

  // ---- derived ----
  const totalRequired = venues.length * SHIFTS_PER_VENUE;

  const approvedFor = (traineeId, venueId) =>
    shifts.filter((s) => s.traineeId === traineeId && s.venueId === venueId && s.status === "approved").length;

  const totalFor = (traineeId) =>
    venues.reduce((sum, v) => sum + Math.min(approvedFor(traineeId, v.id), SHIFTS_PER_VENUE), 0);

  const isReady = (traineeId) => totalFor(traineeId) >= totalRequired && totalRequired > 0;

  const pending = shifts.filter((s) => s.status === "pending");
  const scheduled = shifts.filter((s) => s.status === "scheduled").sort((a, b) => (a.date > b.date ? 1 : -1));
  const recentActivity = [...shifts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);

  const traineeName = (id) => trainees.find((t) => t.id === id)?.name || "Unknown";
  const venueName = (id) => venues.find((v) => v.id === id)?.name || "Unknown venue";
  const managerById = (id) => managers.find((m) => m.id === id) || null;
  const approvedShiftsForTrainee = (traineeId) =>
    shifts.filter((s) => s.traineeId === traineeId && s.status === "approved").sort((a, b) => (a.date < b.date ? 1 : -1));
  const scheduledShiftsForTrainee = (traineeId) =>
    shifts.filter((s) => s.traineeId === traineeId && s.status === "scheduled").sort((a, b) => (a.date > b.date ? 1 : -1));
  const shiftCountForTrainee = (traineeId) => shifts.filter((s) => s.traineeId === traineeId).length;
  const shiftCountForVenue = (venueId) => shifts.filter((s) => s.venueId === venueId).length;

  const readyCount = trainees.filter((t) => isReady(t.id)).length;
  const avgPct =
    trainees.length && totalRequired
      ? Math.round(
          (trainees.reduce((sum, t) => sum + totalFor(t.id), 0) / (trainees.length * totalRequired)) * 100
        )
      : 0;

  if (loading) {
    return (
      <div className="nv-body flex items-center justify-center min-h-[500px]" style={{ background: C.bg, color: C.textMuted }}>
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading roster…
      </div>
    );
  }

  return (
    <div className="nv-body min-h-[600px] w-full rounded-lg overflow-hidden" style={{ background: C.bg, color: C.text }}>
      {FONTS}

      {/* Header */}
      <div className="px-6 pt-6 pb-4" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="nv-mono text-xs tracking-widest uppercase mb-1" style={{ color: C.gold }}>
              Novare · Field Training
            </div>
            <h1 className="nv-display text-2xl font-semibold">Shift Sign-Off Tracker</h1>
            <p className="text-sm mt-1" style={{ color: C.textMuted }}>
              {venues.length} venues · {SHIFTS_PER_VENUE} shifts each · {totalRequired} to go solo
            </p>
          </div>

          <RoleSwitch
            role={role}
            setRole={(r) => {
              setRole(r);
              setTab("dashboard");
              rememberMe(r, activeTraineeId);
            }}
            trainees={trainees}
            activeTraineeId={activeTraineeId}
            setActiveTraineeId={(id) => {
              setActiveTraineeId(id);
              setTab("dashboard");
              rememberMe(role, id);
            }}
          />
        </div>

        <div className="flex gap-6 mt-5 flex-wrap">
          <Stat label="Trainees" value={trainees.length} />
          <Stat label="Ready to solo" value={readyCount} accent={C.green} />
          <Stat label="Pending approvals" value={pending.length} accent={pending.length ? C.gold : undefined} />
          <Stat label="Upcoming" value={scheduled.length} accent={scheduled.length ? C.blue : undefined} />
          <Stat label="Avg. completion" value={`${avgPct}%`} />
        </div>

        {saveError && (
          <div className="mt-4 text-xs flex items-center gap-2 px-3 py-2 rounded" style={{ background: C.goldDim, color: C.gold }}>
            <AlertCircle size={14} /> {saveError}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4 flex gap-1 flex-wrap">
        {[
          { id: "dashboard", label: "Dashboard" },
          { id: "log", label: "Log a shift" },
          ...(role === "trainee" && activeTraineeId ? [{ id: "my-calendar", label: "My Calendar" }] : []),
          ...(role === "admin"
            ? [
                { id: "approvals", label: `Approvals${pending.length ? ` (${pending.length})` : ""}` },
                { id: "calendar", label: "Calendar" },
                { id: "import", label: "Bulk import (Nowsta)" },
                { id: "roster", label: "Roster" },
              ]
            : []),
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3.5 py-2 text-sm rounded-t transition-colors"
            style={{
              background: tab === t.id ? C.surface : "transparent",
              color: tab === t.id ? C.text : C.textMuted,
              borderBottom: tab === t.id ? `2px solid ${C.gold}` : "2px solid transparent",
              fontWeight: tab === t.id ? 600 : 500,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-6" style={{ background: C.surface }}>
        {tab === "dashboard" && (
          <Dashboard
            trainees={trainees}
            venues={venues}
            approvedFor={approvedFor}
            totalFor={totalFor}
            totalRequired={totalRequired}
            isReady={isReady}
            recentActivity={recentActivity}
            scheduled={scheduled}
            traineeName={traineeName}
            venueName={venueName}
            managerById={managerById}
            approvedShiftsForTrainee={approvedShiftsForTrainee}
            scheduledShiftsForTrainee={scheduledShiftsForTrainee}
          />
        )}

        {tab === "my-calendar" && role === "trainee" && activeTraineeId && (
          <MyCalendar events={calendarEvents} venues={venues} traineeId={activeTraineeId} />
        )}

        {tab === "log" && (
          <LogShift
            role={role}
            trainees={trainees}
            venues={venues}
            managers={managers}
            activeTraineeId={activeTraineeId}
            onSubmit={submitShift}
          />
        )}

        {tab === "approvals" && role === "admin" && (
          <Approvals
            pending={pending}
            scheduled={scheduled}
            traineeName={traineeName}
            venueName={venueName}
            managerById={managerById}
            onApprove={(id) => setShiftStatus(id, "approved")}
            onReject={(id) => setShiftStatus(id, "rejected")}
          />
        )}

        {tab === "calendar" && role === "admin" && (
          <CalendarView events={calendarEvents} venues={venues} />
        )}

        {tab === "import" && role === "admin" && (
          <ImportCsv
            trainees={trainees}
            venues={venues}
            managers={managers}
            onImport={bulkImportShifts}
            onImportScheduled={bulkReconcileScheduled}
            onImportEvents={mergeCalendarEvents}
            eventVenueMap={eventVenueMap}
            onSaveEventVenueMap={saveEventVenueMap}
          />
        )}

        {tab === "roster" && role === "admin" && (
          <RosterManager
            trainees={trainees}
            venues={venues}
            managers={managers}
            totalFor={totalFor}
            totalRequired={totalRequired}
            shiftCountForTrainee={shiftCountForTrainee}
            shiftCountForVenue={shiftCountForVenue}
            onAddTrainee={addTrainee}
            onResetTraineePin={resetTraineePin}
            onRemoveTrainee={removeTrainee}
            onRenameVenue={renameVenue}
            onAddVenue={addVenue}
            onRestoreDefaultVenues={restoreDefaultVenues}
            onRemoveVenue={removeVenue}
            onAddManager={addManager}
            onRemoveManager={removeManager}
            onSeedDemo={seedDemoData}
            onResetAll={resetAllData}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
function Stat({ label, value, accent }) {
  return (
    <div>
      <div className="nv-display text-xl font-semibold" style={{ color: accent || "#EDEEF2" }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: "#8A93A3" }}>
        {label}
      </div>
    </div>
  );
}

function RoleSwitch({ role, setRole, trainees, activeTraineeId, setActiveTraineeId }) {
  const [pendingId, setPendingId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const activeTrainee = trainees.find((t) => t.id === activeTraineeId);

  const confirmPin = () => {
    const candidate = trainees.find((t) => t.id === pendingId);
    if (!candidate) return;
    if (!candidate.pin) {
      // No PIN set on this trainee record — admin hasn't configured one yet.
      setActiveTraineeId(pendingId);
      setPendingId("");
      setPin("");
      setError("");
      return;
    }
    if (pin === candidate.pin) {
      setActiveTraineeId(pendingId);
      setPendingId("");
      setPin("");
      setError("");
    } else {
      setError("Incorrect PIN. Try again.");
    }
  };

  const switchIdentity = () => {
    setActiveTraineeId("");
    setPendingId("");
    setPin("");
    setError("");
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md overflow-hidden text-sm" style={{ border: `1px solid ${C.border}` }}>
          {["trainee", "admin"].map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className="px-3 py-1.5 flex items-center gap-1.5"
              style={{ background: role === r ? C.gold : "transparent", color: role === r ? "#1B140A" : C.textMuted, fontWeight: 600 }}
            >
              {r === "admin" ? <ShieldCheck size={14} /> : <User size={14} />}
              {r === "admin" ? "Admin" : "Trainee"}
            </button>
          ))}
        </div>

        {role === "trainee" && activeTrainee && (
          <div className="flex items-center gap-2 text-sm">
            <span style={{ color: C.text }}>Signed in as {activeTrainee.name}</span>
            <button onClick={switchIdentity} className="text-xs px-2 py-1 rounded" style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
              Not you?
            </button>
          </div>
        )}

        {role === "trainee" && !activeTrainee && (
          <select
            value={pendingId}
            onChange={(e) => { setPendingId(e.target.value); setPin(""); setError(""); }}
            className="text-sm rounded-md px-2.5 py-1.5"
            style={{ background: C.surfaceAlt, color: C.text, border: `1px solid ${C.border}` }}
          >
            <option value="">I am…</option>
            {trainees.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {role === "trainee" && !activeTrainee && pendingId && (
        <div className="flex items-center gap-2">
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmPin()}
            placeholder="Enter your PIN"
            className="text-sm rounded-md px-2.5 py-1.5"
            style={{ background: C.surfaceAlt, color: C.text, border: `1px solid ${error ? C.brick : C.border}`, width: 140 }}
          />
          <button onClick={confirmPin} className="text-sm px-3 py-1.5 rounded-md font-semibold" style={{ background: C.gold, color: "#1B140A" }}>
            Confirm
          </button>
        </div>
      )}
      {error && <div className="text-xs" style={{ color: C.brick }}>{error}</div>}
    </div>
  );
}

// ---- Punch-card dashboard ----
function Dashboard({ trainees, venues, approvedFor, totalFor, totalRequired, isReady, recentActivity, scheduled, traineeName, venueName, managerById, approvedShiftsForTrainee, scheduledShiftsForTrainee }) {
  const [selectedTraineeId, setSelectedTraineeId] = useState("");

  if (trainees.length === 0) {
    return <EmptyState title="No trainees yet" body="Add your first trainee from the Roster tab to start tracking shifts." />;
  }

  if (selectedTraineeId) {
    const t = trainees.find((tr) => tr.id === selectedTraineeId);
    const history = approvedShiftsForTrainee ? approvedShiftsForTrainee(selectedTraineeId) : [];
    const upcoming = scheduledShiftsForTrainee ? scheduledShiftsForTrainee(selectedTraineeId) : [];
    const total = totalFor(selectedTraineeId);
    return (
      <div className="flex flex-col gap-6">
        <button
          onClick={() => setSelectedTraineeId("")}
          className="text-sm flex items-center gap-1 self-start"
          style={{ color: C.gold }}
        >
          ← Back to all trainees
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="nv-display text-xl font-semibold">{t ? t.name : "Trainee"}</span>
          <span className="nv-mono text-sm" style={{ color: C.textMuted }}>{total}/{totalRequired} shifts completed</span>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide mb-3" style={{ color: C.textMuted }}>
            Confirmed to work (upcoming)
          </div>
          {upcoming.length === 0 ? (
            <div className="text-sm" style={{ color: C.textFaint }}>Nothing upcoming right now.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map((s) => (
                <div key={s.id} className="rounded-lg p-4" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: C.blue }} />
                    <MapPin size={14} style={{ color: C.textMuted }} />
                    <span className="font-semibold">{venueName(s.venueId)}</span>
                    <span style={{ color: C.textFaint }}>·</span>
                    <span className="nv-mono text-xs" style={{ color: C.textMuted }}>{s.date}</span>
                  </div>
                  {s.note && <div className="text-xs italic mt-1" style={{ color: C.textFaint }}>“{s.note}”</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide mb-3" style={{ color: C.textMuted }}>
            Completed
          </div>
          {history.length === 0 ? (
            <EmptyState title="No completed shifts yet" body="Once shifts are approved, they'll show up here with venue and details." />
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((s) => {
                const mgr = managerById(s.managerId);
                return (
                  <div key={s.id} className="rounded-lg p-4" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <MapPin size={14} style={{ color: C.textMuted }} />
                      <span className="font-semibold">{venueName(s.venueId)}</span>
                      <span style={{ color: C.textFaint }}>·</span>
                      <span className="nv-mono text-xs" style={{ color: C.textMuted }}>{s.date}</span>
                      {s.nowstaVerified && (
                        <span title="Matched a Nowsta timesheet record" style={{ color: C.green }}>
                          <BadgeCheck size={14} />
                        </span>
                      )}
                    </div>
                    {mgr && (
                      <div className="text-xs mt-1" style={{ color: C.textMuted }}>Worked with {mgr.name}</div>
                    )}
                    {s.note && (
                      <div className="text-xs italic mt-1" style={{ color: C.textFaint }}>“{s.note}”</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {trainees.map((t) => {
        const total = totalFor(t.id);
        const ready = isReady(t.id);
        const pct = totalRequired ? Math.round((total / totalRequired) * 100) : 0;
        return (
          <button
            key={t.id}
            onClick={() => setSelectedTraineeId(t.id)}
            className="rounded-lg p-4 text-left w-full"
            style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, cursor: "pointer" }}
          >
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="nv-display font-semibold">{t.name}</span>
                {ready && (
                  <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "#1D3327", color: C.green }}>
                    <Check size={12} /> Ready to solo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="nv-mono text-sm" style={{ color: C.textMuted }}>
                  {total}/{totalRequired}
                </span>
                <ChevronRight size={16} style={{ color: C.textFaint }} />
              </div>
            </div>

            <div className="h-1.5 rounded-full mb-4 overflow-hidden" style={{ background: C.border }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ready ? C.green : C.gold }} />
            </div>

            <div className="flex flex-wrap gap-3">
              {venues.map((v) => {
                const count = Math.min(approvedFor(t.id, v.id), SHIFTS_PER_VENUE);
                return (
                  <div key={v.id} className="flex flex-col items-center gap-1" style={{ width: 64 }}>
                    <Punch count={count} />
                    <span className="text-[10px] text-center leading-tight nv-mono" style={{ color: C.textFaint }} title={v.name}>
                      {v.name.length > 10 ? v.name.slice(0, 9) + "…" : v.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </button>
        );
      })}

      {scheduled && scheduled.length > 0 && (
        <div className="rounded-lg p-4 mt-2" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-wide mb-3" style={{ color: C.textMuted }}>
            Upcoming — confirmed or requested to work
          </div>
          <div className="flex flex-col gap-2">
            {scheduled.slice(0, 10).map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm flex-wrap">
                <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: C.blue }} />
                <span style={{ color: C.text }}>{traineeName(s.traineeId)}</span>
                <span style={{ color: C.textFaint }}>·</span>
                <span style={{ color: C.textMuted }}>{venueName(s.venueId)}</span>
                <span style={{ color: C.textFaint }}>·</span>
                <span className="nv-mono text-xs" style={{ color: C.textFaint }}>{s.date}</span>
              </div>
            ))}
            {scheduled.length > 10 && (
              <div className="text-xs mt-1" style={{ color: C.textFaint }}>+{scheduled.length - 10} more — see Approvals for the full list.</div>
            )}
          </div>
        </div>
      )}

      {recentActivity.length > 0 && (
        <div className="rounded-lg p-4 mt-2" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-wide mb-3" style={{ color: C.textMuted }}>
            Recent activity
          </div>
          <div className="flex flex-col gap-2">
            {recentActivity.map((s) => {
              const mgr = managerById(s.managerId);
              return (
                <div key={s.id} className="flex items-center gap-2 text-sm flex-wrap">
                  <StatusDot status={s.status} />
                  <span style={{ color: C.text }}>{traineeName(s.traineeId)}</span>
                  <span style={{ color: C.textFaint }}>·</span>
                  <span style={{ color: C.textMuted }}>{venueName(s.venueId)}</span>
                  <span style={{ color: C.textFaint }}>·</span>
                  <span className="nv-mono text-xs" style={{ color: C.textFaint }}>{s.date || "no date"}</span>
                  {mgr && (
                    <>
                      <span style={{ color: C.textFaint }}>·</span>
                      <span className="text-xs" style={{ color: C.textMuted }}>with {mgr.name}</span>
                    </>
                  )}
                  {s.nowstaVerified && (
                    <span title="Matched a Nowsta timesheet record" style={{ color: C.green }}>
                      <BadgeCheck size={14} />
                    </span>
                  )}
                  <span className="text-xs ml-auto capitalize" style={{ color: s.status === "approved" ? C.green : s.status === "rejected" ? C.brick : s.status === "scheduled" ? C.blue : C.gold }}>
                    {s.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }) {
  const color = status === "approved" ? C.green : status === "rejected" ? C.brick : status === "scheduled" ? C.blue : C.gold;
  return <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: color }} />;
}

function Punch({ count }) {
  if (count >= SHIFTS_PER_VENUE) {
    return (
      <div className="rounded-full flex items-center justify-center" style={{ width: 32, height: 32, background: C.gold, color: "#1B140A" }}>
        <Check size={16} strokeWidth={3} />
      </div>
    );
  }
  if (count === 1) {
    return (
      <div className="rounded-full flex items-center justify-center" style={{ width: 32, height: 32, border: `2px solid ${C.gold}` }}>
        <div className="rounded-full" style={{ width: 8, height: 8, background: C.gold }} />
      </div>
    );
  }
  return <div className="rounded-full" style={{ width: 32, height: 32, border: `2px solid ${C.border}` }} />;
}

// ---- Log shift (with manager selection + Nowsta verification) ----
function LogShift({ role, trainees, venues, managers, activeTraineeId, onSubmit }) {
  const [traineeId, setTraineeId] = useState(activeTraineeId || "");
  const [venueId, setVenueId] = useState(venues[0]?.id || "");
  const [managerId, setManagerId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [confirmMsg, setConfirmMsg] = useState("");

  const [csvFields, setCsvFields] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [matchStatus, setMatchStatus] = useState("idle"); // idle | matched | unmatched

  useEffect(() => {
    if (role === "trainee") setTraineeId(activeTraineeId);
  }, [activeTraineeId, role]);

  // Re-check the match whenever the relevant fields or the uploaded file change.
  useEffect(() => {
    if (csvRows.length === 0) {
      setMatchStatus("idle");
      return;
    }
    const trainee = trainees.find((t) => t.id === traineeId);
    const venue = venues.find((v) => v.id === venueId);
    if (!trainee || !venue || !date) {
      setMatchStatus("unmatched");
      return;
    }
    const nameCol = guessColumn(csvFields, ["worker", "employee", "name", "staff"]);
    const venueCol = guessColumn(csvFields, ["venue", "position", "event", "location", "site"]);
    const dateCol = guessColumn(csvFields, ["date"]);
    const found = csvRows.some((row) => {
      const rawName = row[nameCol] || "";
      const rawVenue = row[venueCol] || "";
      const rawDate = row[dateCol] || "";
      return namesMatch(rawName, trainee.name) && namesMatch(rawVenue, venue.name) && parseDate(rawDate) === date;
    });
    setMatchStatus(found ? "matched" : "unmatched");
  }, [csvRows, csvFields, traineeId, venueId, date, trainees, venues]);

  if (trainees.length === 0 || venues.length === 0) {
    return <EmptyState title="Set up your roster first" body="Add trainees and venues from the Roster tab (admin) before logging shifts." />;
  }
  if (role === "trainee" && !activeTraineeId) {
    return <EmptyState title="Tell us who you are" body="Use the 'I am…' menu at the top right to select your name before logging a shift." />;
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = Papa.parse(ev.target.result, { header: true, skipEmptyLines: true });
      if (!parsed.meta.fields || parsed.meta.fields.length === 0) {
        setParseError("Couldn't find column headers in that file — make sure it's a CSV export from Nowsta.");
        setCsvRows([]);
        setCsvFields([]);
        return;
      }
      setCsvFields(parsed.meta.fields);
      setCsvRows(parsed.data);
    };
    reader.onerror = () => setParseError("Couldn't read that file. Try exporting it again from Nowsta.");
    reader.readAsText(file);
  };

  const clearFile = () => {
    setFileName("");
    setCsvRows([]);
    setCsvFields([]);
    setMatchStatus("idle");
    setParseError("");
  };

  const submit = () => {
    if (!traineeId || !venueId || !date) return;
    const verified = matchStatus === "matched";
    const autoApprove = role === "admin" || verified;
    onSubmit({
      traineeId,
      venueId,
      managerId: managerId || null,
      date,
      note,
      nowstaVerified: verified,
      status: autoApprove ? "approved" : "pending",
      loggedBy: role === "admin" ? "admin" : verified ? "trainee-verified" : "trainee",
    });
    setNote("");
    clearFile();
    if (role === "admin") {
      setConfirmMsg("Shift logged and approved.");
    } else if (verified) {
      setConfirmMsg("Matched your Nowsta record — shift approved automatically.");
    } else {
      setConfirmMsg("Submitted — an admin will confirm this with your manager before approving.");
    }
    setTimeout(() => setConfirmMsg(""), 4500);
  };

  return (
    <div className="max-w-md">
      <div className="flex flex-col gap-3">
        {role === "admin" && (
          <Field label="Trainee">
            <select value={traineeId} onChange={(e) => setTraineeId(e.target.value)} style={selectStyle}>
              <option value="">Select trainee…</option>
              {trainees.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Venue">
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)} style={selectStyle}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Manager on duty">
          {managers.length === 0 ? (
            <div className="text-xs px-2 py-2 rounded" style={{ background: C.goldDim, color: C.gold }}>
              No managers set up yet — ask an admin to add one in Roster so you can select who you worked with.
            </div>
          ) : (
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)} style={selectStyle}>
              <option value="">Select the manager you worked with…</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Shift date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={selectStyle} />
        </Field>

        <Field label="Note (optional)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. covered load-in and breakdown" style={selectStyle} />
        </Field>

        <div className="rounded-md p-3 mt-1" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-semibold mb-1 flex items-center gap-2">
            <UploadCloud size={14} style={{ color: C.gold }} />
            Verify with Nowsta
            <span className="text-xs font-normal" style={{ color: C.textFaint }}>(optional, but skips admin review)</span>
          </div>
          <div className="text-xs mb-2" style={{ color: C.textMuted }}>
            Upload your Nowsta timesheet CSV for this shift. If it matches this trainee, venue, and
            date, the shift is verified and approved automatically instead of waiting on an admin.
          </div>
          {!fileName ? (
            <label className="text-xs px-3 py-1.5 rounded-md cursor-pointer inline-block" style={{ background: C.gold, color: "#1B140A", fontWeight: 600 }}>
              Choose CSV file
              <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
            </label>
          ) : (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span style={{ color: C.textMuted }}>{fileName}</span>
              <button onClick={clearFile} style={{ color: C.textFaint }}><X size={13} /></button>
              {matchStatus === "matched" && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "#1D3327", color: C.green }}>
                  <Check size={12} /> Matched
                </span>
              )}
              {matchStatus === "unmatched" && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: C.goldDim, color: C.gold }}>
                  <AlertCircle size={12} /> No matching row found for this trainee/venue/date
                </span>
              )}
            </div>
          )}
          {parseError && (
            <div className="text-xs mt-2 flex items-center gap-1" style={{ color: C.brick }}>
              <AlertCircle size={12} /> {parseError}
            </div>
          )}
        </div>

        <button
          onClick={submit}
          disabled={!traineeId || !venueId}
          className="mt-2 rounded-md py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
          style={{
            background: !traineeId || !venueId ? C.border : C.gold,
            color: !traineeId || !venueId ? C.textFaint : "#1B140A",
            cursor: !traineeId || !venueId ? "not-allowed" : "pointer",
          }}
        >
          {role === "admin" ? "Log shift" : matchStatus === "matched" ? "Submit — verified" : "Submit for approval"}
          <ChevronRight size={16} />
        </button>

        {confirmMsg && (
          <div className="text-sm flex items-center gap-2" style={{ color: C.green }}>
            <Check size={14} /> {confirmMsg}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="text-sm flex flex-col gap-1">
      <span style={{ color: C.textMuted }}>{label}</span>
      {children}
    </label>
  );
}

// ---- Approvals ----
function Approvals({ pending, scheduled, traineeName, venueName, managerById, onApprove, onReject }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <div>
        <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>
          Pending approval
        </div>
        {pending.length === 0 ? (
          <EmptyState title="All caught up" body="No shifts are waiting on approval right now." />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.sort((a, b) => b.createdAt - a.createdAt).map((s) => {
              const mgr = managerById(s.managerId);
              return (
                <div key={s.id} className="rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      <User size={14} style={{ color: C.textMuted }} />
                      <span className="font-semibold">{traineeName(s.traineeId)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm flex-wrap" style={{ color: C.textMuted }}>
                      <MapPin size={14} /> {venueName(s.venueId)}
                      <Clock size={14} className="ml-2" /> {s.date}
                    </div>
                    {mgr ? (
                      <div className="flex items-center gap-3 text-xs mt-1" style={{ color: C.textMuted }}>
                        <span>Worked with <span style={{ color: C.text }}>{mgr.name}</span></span>
                        {mgr.phone && <a href={`tel:${mgr.phone}`} className="flex items-center gap-1" style={{ color: C.gold }}><Phone size={12} /> {mgr.phone}</a>}
                        {mgr.email && <a href={`mailto:${mgr.email}`} className="flex items-center gap-1" style={{ color: C.gold }}><Mail size={12} /> email</a>}
                      </div>
                    ) : (
                      <div className="text-xs mt-1" style={{ color: C.brick }}>No manager on duty was selected — verify manually.</div>
                    )}
                    {s.note && <div className="text-xs italic mt-1" style={{ color: C.textFaint }}>“{s.note}”</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => onApprove(s.id)} className="px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-1" style={{ background: C.green, color: "#0E1F16" }}>
                      <Check size={14} /> Approve
                    </button>
                    <button onClick={() => onReject(s.id)} className="px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-1" style={{ background: "transparent", color: C.brick, border: `1px solid ${C.brick}` }}>
                      <X size={14} /> Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold mb-1" style={{ color: C.text }}>
          Upcoming (confirmed on Nowsta, not yet worked)
        </div>
        <div className="text-xs mb-3" style={{ color: C.textMuted }}>
          These came from a Nowsta availability import. Once the date passes, confirm whether it
          actually happened — that's what moves it onto the trainee's total.
        </div>
        {scheduled.length === 0 ? (
          <EmptyState title="Nothing upcoming" body="Import a Nowsta availability report to see confirmed upcoming shifts here." />
        ) : (
          <div className="flex flex-col gap-2">
            {scheduled.map((s) => {
              const isPast = s.date < today;
              return (
                <div key={s.id} className="rounded-md p-3 flex items-center justify-between gap-3 flex-wrap text-sm" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: C.blue }} />
                    <span>{traineeName(s.traineeId)}</span>
                    <span style={{ color: C.textFaint }}>·</span>
                    <span style={{ color: C.textMuted }}>{venueName(s.venueId)}</span>
                    <span style={{ color: C.textFaint }}>·</span>
                    <span className="nv-mono text-xs" style={{ color: C.textMuted }}>{s.date}</span>
                  </div>
                  {isPast ? (
                    <div className="flex gap-2">
                      <button onClick={() => onApprove(s.id)} className="px-2.5 py-1 rounded text-xs font-semibold" style={{ background: C.green, color: "#0E1F16" }}>
                        Confirm completed
                      </button>
                      <button onClick={() => onReject(s.id)} className="px-2.5 py-1 rounded text-xs font-semibold" style={{ background: "transparent", color: C.brick, border: `1px solid ${C.brick}` }}>
                        No-show
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs" style={{ color: C.blue }}>Scheduled</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Roster manager ----
function RosterManager({ trainees, venues, managers, totalFor, totalRequired, shiftCountForTrainee, shiftCountForVenue, onAddTrainee, onResetTraineePin, onRemoveTrainee, onRenameVenue, onAddVenue, onRestoreDefaultVenues, onRemoveVenue, onAddManager, onRemoveManager, onSeedDemo, onResetAll }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [resettingId, setResettingId] = useState("");
  const [newPin, setNewPin] = useState("");
  const [mgrName, setMgrName] = useState("");
  const [mgrPhone, setMgrPhone] = useState("");
  const [mgrEmail, setMgrEmail] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmDeleteTraineeId, setConfirmDeleteTraineeId] = useState("");
  const [confirmDeleteVenueId, setConfirmDeleteVenueId] = useState("");

  const handleRemoveTrainee = (id) => {
    const count = shiftCountForTrainee ? shiftCountForTrainee(id) : 0;
    if (count > 0 && confirmDeleteTraineeId !== id) {
      setConfirmDeleteTraineeId(id);
      return;
    }
    setConfirmDeleteTraineeId("");
    onRemoveTrainee(id);
  };

  const handleRemoveVenue = (id) => {
    const count = shiftCountForVenue ? shiftCountForVenue(id) : 0;
    if (count > 0 && confirmDeleteVenueId !== id) {
      setConfirmDeleteVenueId(id);
      return;
    }
    setConfirmDeleteVenueId("");
    onRemoveVenue(id);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg p-4 flex items-center justify-between flex-wrap gap-3" style={{ background: C.goldDim, border: `1px solid ${C.gold}` }}>
        <div className="text-sm" style={{ color: C.text }}>
          <span className="font-semibold">Want to see how this looks in use?</span>{" "}
          <span style={{ color: C.textMuted }}>Load sample trainees, venues, managers, and shifts.</span>
        </div>
        <div className="flex gap-2">
          <button onClick={onSeedDemo} className="text-sm px-3 py-1.5 rounded-md font-semibold" style={{ background: C.gold, color: "#1B140A" }}>
            Load demo data
          </button>
          {confirmingReset ? (
            <button onClick={() => { onResetAll(); setConfirmingReset(false); }} className="text-sm px-3 py-1.5 rounded-md font-semibold" style={{ background: C.brick, color: "#fff" }}>
              Confirm clear all
            </button>
          ) : (
            <button onClick={() => setConfirmingReset(true)} className="text-sm px-3 py-1.5 rounded-md" style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
              Clear all data
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <div>
          <div className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: C.text }}>
            <User size={14} /> Trainees
          </div>
          <div className="flex gap-2 mb-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={{ ...selectStyle, flex: 1 }} />
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4-digit PIN"
              maxLength={8}
              style={{ ...selectStyle, width: 110 }}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onAddTrainee(name, pin); setName(""); setPin(""); } }}
            />
            <button onClick={() => { if (name.trim()) { onAddTrainee(name, pin); setName(""); setPin(""); } }} className="px-3 rounded-md flex items-center" style={{ background: C.gold, color: "#1B140A" }}>
              <Plus size={16} />
            </button>
          </div>
          <div className="flex flex-col gap-2 nv-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
            {trainees.length === 0 && <div className="text-sm" style={{ color: C.textFaint }}>No trainees added yet.</div>}
            {trainees.map((t) => (
              <div key={t.id} className="flex flex-col gap-1.5 px-3 py-2 rounded-md text-sm" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between">
                  <span>{t.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="nv-mono text-xs" style={{ color: C.textMuted }}>{totalFor(t.id)}/{totalRequired}</span>
                    <button onClick={() => handleRemoveTrainee(t.id)} style={{ color: confirmDeleteTraineeId === t.id ? C.brick : C.textFaint }}><Trash2 size={14} /></button>
                  </div>
                </div>
                {confirmDeleteTraineeId === t.id && (
                  <div className="text-xs px-2 py-1.5 rounded flex items-center justify-between gap-2" style={{ background: C.goldDim, color: C.gold }}>
                    <span>Has {shiftCountForTrainee(t.id)} shift record(s) — deleting removes their history too. Click the trash icon again to confirm.</span>
                    <button onClick={() => setConfirmDeleteTraineeId("")} style={{ color: C.textMuted }}>Cancel</button>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs" style={{ color: C.textFaint }}>
                  {t.pin ? "PIN set" : "No PIN set"}
                  {resettingId === t.id ? (
                    <>
                      <input value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="New PIN" maxLength={8} style={{ ...selectStyle, padding: "3px 8px", width: 90 }} />
                      <button
                        onClick={() => { onResetTraineePin(t.id, newPin); setResettingId(""); setNewPin(""); }}
                        className="px-2 py-1 rounded"
                        style={{ background: C.gold, color: "#1B140A", fontWeight: 600 }}
                      >
                        Save
                      </button>
                      <button onClick={() => { setResettingId(""); setNewPin(""); }} style={{ color: C.textFaint }}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setResettingId(t.id)} className="px-2 py-0.5 rounded" style={{ border: `1px solid ${C.border}` }}>
                      {t.pin ? "Reset PIN" : "Set PIN"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: C.text }}>
            <MapPin size={14} /> Venues
          </div>
          <div className="flex flex-col gap-2 nv-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
            {venues.length === 0 && <div className="text-sm mb-1" style={{ color: C.textFaint }}>No venues set up yet.</div>}
            {venues.map((v) => (
              <div key={v.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input value={v.name} onChange={(e) => onRenameVenue(v.id, e.target.value)} style={{ ...selectStyle, flex: 1 }} />
                  <button onClick={() => handleRemoveVenue(v.id)} style={{ color: confirmDeleteVenueId === v.id ? C.brick : C.textFaint }}><Trash2 size={14} /></button>
                </div>
                {confirmDeleteVenueId === v.id && (
                  <div className="text-xs px-2 py-1.5 rounded flex items-center justify-between gap-2" style={{ background: C.goldDim, color: C.gold }}>
                    <span>Has {shiftCountForVenue(v.id)} shift record(s) tied to it — trainees will lose credit for those. Click the trash icon again to confirm.</span>
                    <button onClick={() => setConfirmDeleteVenueId("")} style={{ color: C.textMuted }}>Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <button onClick={onAddVenue} className="text-sm px-3 py-1.5 rounded-md flex items-center gap-1" style={{ background: "transparent", color: C.gold, border: `1px solid ${C.gold}` }}>
              <Plus size={14} /> Add venue
            </button>
            <button onClick={onRestoreDefaultVenues} className="text-sm px-3 py-1.5 rounded-md flex items-center gap-1" style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}` }}>
              Restore your 9 venues
            </button>
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: C.text }}>
            <Users size={14} /> Managers
          </div>
          <div className="flex flex-col gap-2 mb-3">
            <input value={mgrName} onChange={(e) => setMgrName(e.target.value)} placeholder="Manager name" style={selectStyle} />
            <input value={mgrPhone} onChange={(e) => setMgrPhone(e.target.value)} placeholder="Phone (optional)" style={selectStyle} />
            <input value={mgrEmail} onChange={(e) => setMgrEmail(e.target.value)} placeholder="Email (optional)" style={selectStyle} />
            <button
              onClick={() => { if (mgrName.trim()) { onAddManager(mgrName, mgrPhone, mgrEmail); setMgrName(""); setMgrPhone(""); setMgrEmail(""); } }}
              className="px-3 py-1.5 rounded-md text-sm font-semibold flex items-center justify-center gap-1"
              style={{ background: C.gold, color: "#1B140A" }}
            >
              <Plus size={14} /> Add manager
            </button>
          </div>
          <div className="flex flex-col gap-2 nv-scroll" style={{ maxHeight: 260, overflowY: "auto" }}>
            {managers.length === 0 && <div className="text-sm" style={{ color: C.textFaint }}>No managers added yet.</div>}
            {managers.map((m) => (
              <div key={m.id} className="flex items-start justify-between px-3 py-2 rounded-md text-sm" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
                <div>
                  <div>{m.name}</div>
                  <div className="text-xs" style={{ color: C.textFaint }}>{[m.phone, m.email].filter(Boolean).join(" · ")}</div>
                </div>
                <button onClick={() => onRemoveManager(m.id)} style={{ color: C.textFaint }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Bulk CSV import (admin) ----
function matchIdByName(raw, list) {
  const hit = list.find((item) => namesMatch(raw, item.name));
  return hit ? hit.id : null;
}

function CompletedShiftsImport({ trainees, venues, managers, onImport }) {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({ name: "", venue: "", date: "", note: "" });
  const [resolvedRows, setResolvedRows] = useState([]);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = Papa.parse(ev.target.result, { header: true, skipEmptyLines: true });
      if (!parsed.meta.fields || parsed.meta.fields.length === 0) {
        setParseError("Couldn't find column headers in that file. Make sure it's a CSV export with a header row.");
        return;
      }
      setHeaders(parsed.meta.fields);
      setRawRows(parsed.data);
      setMapping({
        name: guessColumn(parsed.meta.fields, ["worker", "employee", "name", "staff"]),
        venue: guessColumn(parsed.meta.fields, ["venue", "position", "event", "location", "site"]),
        date: guessColumn(parsed.meta.fields, ["date"]),
        note: guessColumn(parsed.meta.fields, ["note", "comment"]),
      });
      setStep(2);
    };
    reader.onerror = () => setParseError("Couldn't read that file. Try exporting it again from Nowsta.");
    reader.readAsText(file);
  };

  const buildPreview = () => {
    const rows = rawRows.map((row, i) => {
      const rawName = row[mapping.name] || "";
      const rawVenue = row[mapping.venue] || "";
      const rawDate = row[mapping.date] || "";
      const rawNote = mapping.note ? row[mapping.note] || "" : "";
      return {
        rowId: i,
        rawName,
        rawVenue,
        rawDate,
        note: rawNote,
        traineeId: matchIdByName(rawName, trainees),
        venueId: matchIdByName(rawVenue, venues),
        date: parseDate(rawDate),
        skip: false,
      };
    });
    setResolvedRows(rows);
    setStep(3);
  };

  const updateRow = (rowId, patch) => {
    setResolvedRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const readyRows = resolvedRows.filter((r) => !r.skip && r.traineeId && r.venueId && r.date);
  const needsAttention = resolvedRows.filter((r) => r.skip || !r.traineeId || !r.venueId || !r.date);

  const confirmImport = () => {
    const summary = onImport(readyRows);
    setResult({ ...summary, unresolved: needsAttention.filter((r) => !r.skip).length });
    setStep(4);
  };

  const reset = () => {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setRawRows([]);
    setResolvedRows([]);
    setResult(null);
    setParseError("");
  };

  return (
    <div className="max-w-3xl">
      <div className="text-sm mb-4" style={{ color: C.textMuted }}>
        Export completed timesheets from Nowsta (Payroll → CSV Reports) for the whole team, then
        upload it here in one go. Every trainee whose shifts appear in the file gets matched and
        added at once — no need to check Nowsta separately to see who's done what.
      </div>

      {step === 1 && (
        <div className="rounded-lg p-8 text-center flex flex-col items-center gap-3" style={{ background: C.surfaceAlt, border: `1px dashed ${C.border}` }}>
          <UploadCloud size={28} style={{ color: C.gold }} />
          <div className="nv-display font-semibold">Upload Nowsta CSV export</div>
          <label className="text-sm px-4 py-2 rounded-md cursor-pointer" style={{ background: C.gold, color: "#1B140A", fontWeight: 600 }}>
            Choose file
            <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
          </label>
          {parseError && (
            <div className="text-sm flex items-center gap-2" style={{ color: C.brick }}>
              <AlertCircle size={14} /> {parseError}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="text-sm" style={{ color: C.textMuted }}>
            Loaded <span style={{ color: C.text }}>{fileName}</span> — {rawRows.length} rows. Confirm which columns map to which fields.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MapField label="Worker / trainee name column" value={mapping.name} headers={headers} onChange={(v) => setMapping((m) => ({ ...m, name: v }))} />
            <MapField label="Venue / position column" value={mapping.venue} headers={headers} onChange={(v) => setMapping((m) => ({ ...m, venue: v }))} />
            <MapField label="Date column" value={mapping.date} headers={headers} onChange={(v) => setMapping((m) => ({ ...m, date: v }))} />
            <MapField label="Note column (optional)" value={mapping.note} headers={headers} onChange={(v) => setMapping((m) => ({ ...m, note: v }))} allowNone />
          </div>
          <div className="flex gap-2">
            <button
              onClick={buildPreview}
              disabled={!mapping.name || !mapping.venue || !mapping.date}
              className="px-4 py-2 rounded-md text-sm font-semibold"
              style={{ background: !mapping.name || !mapping.venue || !mapping.date ? C.border : C.gold, color: !mapping.name || !mapping.venue || !mapping.date ? C.textFaint : "#1B140A" }}
            >
              Preview matches
            </button>
            <button onClick={reset} className="px-4 py-2 rounded-md text-sm" style={{ color: C.textMuted }}>Start over</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-6 text-sm">
            <span style={{ color: C.green }}>{readyRows.length} ready to import</span>
            <span style={{ color: needsAttention.length ? C.gold : C.textFaint }}>{needsAttention.length} need attention</span>
          </div>
          <div className="flex flex-col gap-2 nv-scroll" style={{ maxHeight: 420, overflowY: "auto" }}>
            {resolvedRows.map((r) => (
              <div
                key={r.rowId}
                className="rounded-md p-3 flex flex-col gap-2 text-sm"
                style={{ background: C.surfaceAlt, border: `1px solid ${r.traineeId && r.venueId && r.date && !r.skip ? C.border : C.gold}`, opacity: r.skip ? 0.5 : 1 }}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="nv-mono text-xs" style={{ color: C.textFaint }}>row {r.rowId + 1}</span>
                  <span>{r.rawName}</span>
                  <span style={{ color: C.textFaint }}>·</span>
                  <span style={{ color: C.textMuted }}>{r.rawVenue}</span>
                  <span style={{ color: C.textFaint }}>·</span>
                  <span className="nv-mono text-xs" style={{ color: C.textMuted }}>{r.rawDate}</span>
                  <button onClick={() => updateRow(r.rowId, { skip: !r.skip })} className="ml-auto text-xs px-2 py-1 rounded" style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
                    {r.skip ? "Include row" : "Skip row"}
                  </button>
                </div>
                {!r.skip && (
                  <div className="flex flex-wrap gap-2">
                    <select value={r.traineeId || ""} onChange={(e) => updateRow(r.rowId, { traineeId: e.target.value || null })} style={{ ...selectStyle, padding: "5px 8px", borderColor: r.traineeId ? C.border : C.gold }}>
                      <option value="">No trainee match — pick one</option>
                      {trainees.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <select value={r.venueId || ""} onChange={(e) => updateRow(r.rowId, { venueId: e.target.value || null })} style={{ ...selectStyle, padding: "5px 8px", borderColor: r.venueId ? C.border : C.gold }}>
                      <option value="">No venue match — pick one</option>
                      {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <input type="date" value={r.date || ""} onChange={(e) => updateRow(r.rowId, { date: e.target.value || null })} style={{ ...selectStyle, padding: "5px 8px", borderColor: r.date ? C.border : C.gold }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmImport}
              disabled={readyRows.length === 0}
              className="px-4 py-2 rounded-md text-sm font-semibold"
              style={{ background: readyRows.length ? C.gold : C.border, color: readyRows.length ? "#1B140A" : C.textFaint }}
            >
              Import {readyRows.length} shift{readyRows.length === 1 ? "" : "s"}
            </button>
            <button onClick={reset} className="px-4 py-2 rounded-md text-sm" style={{ color: C.textMuted }}>Start over</button>
          </div>
        </div>
      )}

      {step === 4 && result && (
        <div className="rounded-lg p-6 flex flex-col gap-2" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <div className="nv-display font-semibold flex items-center gap-2" style={{ color: C.green }}>
            <Check size={18} /> Import complete
          </div>
          <div className="text-sm" style={{ color: C.textMuted }}>
            {result.added} new shift{result.added === 1 ? "" : "s"} added and auto-approved.
            {result.skippedDupes > 0 && ` ${result.skippedDupes} already existed and were skipped.`}
            {result.unresolved > 0 && ` ${result.unresolved} row(s) were left unmatched and not imported.`}
          </div>
          <button onClick={reset} className="mt-2 text-sm px-4 py-2 rounded-md self-start" style={{ background: C.gold, color: "#1B140A", fontWeight: 600 }}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

function ImportCsv({ trainees, venues, managers, onImport, onImportScheduled, onImportEvents, eventVenueMap, onSaveEventVenueMap }) {
  const [mode, setMode] = useState("event-overview");
  const modes = [
    { id: "event-overview", label: "Event Overview export" },
    { id: "scheduled", label: "Worker Availability export" },
    { id: "completed", label: "Completed shifts (Payroll export)" },
  ];
  return (
    <div>
      <div className="flex gap-2 mb-5 flex-wrap">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className="text-sm px-3 py-1.5 rounded-md font-semibold"
            style={{ background: mode === m.id ? C.gold : "transparent", color: mode === m.id ? "#1B140A" : C.textMuted, border: `1px solid ${mode === m.id ? C.gold : C.border}` }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "completed" && (
        <CompletedShiftsImport trainees={trainees} venues={venues} managers={managers} onImport={onImport} />
      )}
      {mode === "scheduled" && (
        <ScheduleImport
          trainees={trainees}
          venues={venues}
          onImport={(rows) => onImportScheduled(rows, "worker-availability")}
          onImportEvents={(events) => onImportEvents(events, "worker-availability")}
          eventVenueMap={eventVenueMap}
          onSaveEventVenueMap={onSaveEventVenueMap}
        />
      )}
      {mode === "event-overview" && (
        <EventOverviewImport
          trainees={trainees}
          venues={venues}
          onImport={(rows) => onImportScheduled(rows, "event-overview")}
          onImportEvents={(events) => onImportEvents(events, "event-overview")}
          eventVenueMap={eventVenueMap}
          onSaveEventVenueMap={onSaveEventVenueMap}
        />
      )}
    </div>
  );
}

// ---- Availability/schedule import (wide grid: one row per worker, one column per shift) ----
function ScheduleImport({ trainees, venues, onImport, onImportEvents, eventVenueMap, onSaveEventVenueMap }) {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [year, setYear] = useState(() => new Date().getFullYear().toString());
  const [parseError, setParseError] = useState("");
  const [matches, setMatches] = useState([]); // { traineeId, traineeName, label, monthDay, time }
  const [labelMap, setLabelMap] = useState({}); // label -> venueId | "skip"
  const [result, setResult] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setFileName(file.name);
    const yearGuess = file.name.match(/(20\d{2})/);
    if (yearGuess) setYear(yearGuess[1]);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = Papa.parse(ev.target.result, { header: false, skipEmptyLines: true });
      const rows = parsed.data;
      if (!rows || rows.length < 2) {
        setParseError("Couldn't read any rows from that file.");
        return;
      }
      const headerRow = rows[0];
      const nameIdx = headerRow.findIndex((h) => normalize(h).includes("worker name"));
      const scheduleIdx = headerRow.findIndex((h) => normalize(h).includes("schedule summary"));
      const workerNameIdx = nameIdx === -1 ? 0 : nameIdx;
      const firstShiftCol = scheduleIdx === -1 ? 5 : scheduleIdx + 1;

      const found = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const rawName = row[workerNameIdx] || "";
        if (!rawName || /\(agency\)/i.test(rawName)) continue;
        const trainee = trainees.find((t) => namesMatch(rawName, t.name));
        if (!trainee) continue;
        for (let c = firstShiftCol; c < headerRow.length; c++) {
          const cell = (row[c] || "").toString().trim();
          if (normalize(cell) !== "confirmed") continue;
          const parsedHeader = parseAvailabilityHeader(headerRow[c]);
          if (!parsedHeader) continue;
          found.push({
            key: `${r}-${c}`,
            traineeId: trainee.id,
            traineeName: trainee.name,
            label: parsedHeader.label,
            monthDay: parsedHeader.monthDay,
            time: parsedHeader.time || "",
          });
        }
      }
      if (found.length === 0) {
        setParseError("Found no rows matching your trainee roster with a CONFIRMED shift in this file.");
        return;
      }
      setMatches(found);
      // Pre-fill label mapping: try an exact/loose auto-match against your venue
      // list first, then fall back to the remembered cache, then leave blank.
      const uniqueLabels = [...new Set(found.map((f) => f.label))];
      const initialMap = {};
      uniqueLabels.forEach((l) => {
        if (eventVenueMap[l]) {
          initialMap[l] = eventVenueMap[l];
          return;
        }
        const autoMatch = venues.find((ven) => venueNamesMatch(l, ven.name));
        initialMap[l] = autoMatch ? autoMatch.id : "";
      });
      setLabelMap(initialMap);
      setStep(2);
    };
    reader.onerror = () => setParseError("Couldn't read that file. Try exporting it again from Nowsta.");
    reader.readAsText(file);
  };

  const uniqueLabels = [...new Set(matches.map((m) => m.label))];
  const allLabelsMapped = uniqueLabels.every((l) => labelMap[l] === "skip" || (labelMap[l] && labelMap[l] !== ""));

  const buildRows = () => {
    const rows = [];
    matches.forEach((m) => {
      const venueId = labelMap[m.label];
      if (!venueId || venueId === "skip") return;
      const date = buildDateFromMonthDayYear(m.monthDay, year);
      if (!date) return;
      rows.push({ traineeId: m.traineeId, venueId, date, label: m.label });
    });
    return rows;
  };

  const buildEvents = () => {
    const map = {};
    matches.forEach((m) => {
      const venueId = labelMap[m.label];
      if (!venueId || venueId === "skip") return;
      const date = buildDateFromMonthDayYear(m.monthDay, year);
      if (!date) return;
      const key = `${venueId}|${date}|${m.label}`;
      if (!map[key]) {
        map[key] = { venueId, date, eventName: m.label, time: m.time || "", address: "", assignments: [] };
      }
      map[key].assignments.push({ traineeId: m.traineeId, traineeName: m.traineeName, status: "Confirmed" });
    });
    return Object.values(map);
  };

  const confirmImport = () => {
    onSaveEventVenueMap({ ...eventVenueMap, ...labelMap });
    const rows = buildRows();
    const summary = onImport(rows);
    const events = buildEvents();
    onImportEvents(events);
    setResult({ ...summary, eventCount: events.length });
    setStep(3);
  };

  const reset = () => {
    setStep(1);
    setFileName("");
    setMatches([]);
    setLabelMap({});
    setResult(null);
    setParseError("");
  };

  return (
    <div className="max-w-3xl">
      <div className="text-sm mb-4" style={{ color: C.textMuted }}>
        Upload the Worker Availability export from Nowsta. Rows marked <span className="nv-mono" style={{ color: C.gold }}>CONFIRMED</span> for
        a trainee on your roster become upcoming shifts here — not yet counted toward their total until you confirm they actually happened.
      </div>

      {step === 1 && (
        <div className="rounded-lg p-8 text-center flex flex-col items-center gap-3" style={{ background: C.surfaceAlt, border: `1px dashed ${C.border}` }}>
          <UploadCloud size={28} style={{ color: C.gold }} />
          <div className="nv-display font-semibold">Upload availability export</div>
          <div className="flex items-center gap-2 text-sm">
            <span style={{ color: C.textMuted }}>Year covered by this file</span>
            <input value={year} onChange={(e) => setYear(e.target.value)} style={{ ...selectStyle, width: 80, padding: "5px 8px" }} />
          </div>
          <label className="text-sm px-4 py-2 rounded-md cursor-pointer" style={{ background: C.gold, color: "#1B140A", fontWeight: 600 }}>
            Choose file
            <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
          </label>
          {parseError && (
            <div className="text-sm flex items-center gap-2" style={{ color: C.brick }}>
              <AlertCircle size={14} /> {parseError}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="text-sm" style={{ color: C.textMuted }}>
            Found <span style={{ color: C.text }}>{matches.length}</span> confirmed shift{matches.length === 1 ? "" : "s"} across{" "}
            <span style={{ color: C.text }}>{uniqueLabels.length}</span> distinct event{uniqueLabels.length === 1 ? "" : "s"} for your trainees.
            Map each event to a venue (or mark it as not a training shift) — this is remembered for next time.
          </div>
          <div className="flex flex-col gap-2 nv-scroll" style={{ maxHeight: 400, overflowY: "auto" }}>
            {uniqueLabels.map((label) => (
              <div key={label} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm" style={{ background: C.surfaceAlt, border: `1px solid ${labelMap[label] ? C.border : C.gold}` }}>
                <span className="flex-1">{label}</span>
                <select
                  value={labelMap[label] || ""}
                  onChange={(e) => setLabelMap((m) => ({ ...m, [label]: e.target.value }))}
                  style={{ ...selectStyle, padding: "5px 8px", width: 220 }}
                >
                  <option value="">Choose venue…</option>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  <option value="skip">Not a training shift — skip</option>
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmImport}
              disabled={!allLabelsMapped}
              className="px-4 py-2 rounded-md text-sm font-semibold"
              style={{ background: allLabelsMapped ? C.gold : C.border, color: allLabelsMapped ? "#1B140A" : C.textFaint }}
            >
              Import {buildRows().length} upcoming shift{buildRows().length === 1 ? "" : "s"}
            </button>
            <button onClick={reset} className="px-4 py-2 rounded-md text-sm" style={{ color: C.textMuted }}>Start over</button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="rounded-lg p-6 flex flex-col gap-2" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <div className="nv-display font-semibold flex items-center gap-2" style={{ color: C.green }}>
            <Check size={18} /> Import complete
          </div>
          <div className="text-sm" style={{ color: C.textMuted }}>
            {result.added} upcoming shift{result.added === 1 ? "" : "s"} added — check the Approvals tab's "Upcoming" section once dates pass.
            {result.removed > 0 && ` ${result.removed} shift${result.removed === 1 ? "" : "s"} no longer confirmed and removed.`}
            {" "}Also updated the Calendar tab with {result.eventCount} event{result.eventCount === 1 ? "" : "s"}.
          </div>
          <button onClick={reset} className="mt-2 text-sm px-4 py-2 rounded-md self-start" style={{ background: C.gold, color: "#1B140A", fontWeight: 600 }}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Event Overview import (richer export: includes real venue name per event) ----
function stripWeekdayPrefix(raw) {
  return (raw || "").replace(/^[A-Za-z]+,\s*/, "");
}

function EventOverviewImport({ trainees, venues, onImport, onImportEvents, eventVenueMap, onSaveEventVenueMap }) {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [matches, setMatches] = useState([]); // { key, traineeId, venueRaw, date, eventName } — confirmed only, for shift import
  const [rawEvents, setRawEvents] = useState([]); // every event row with venue+date, for the calendar
  const [labelMap, setLabelMap] = useState({}); // venueRaw -> venueId | "skip"
  const [result, setResult] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = Papa.parse(ev.target.result, { header: true, skipEmptyLines: true });
      if (!parsed.meta.fields || parsed.meta.fields.length === 0) {
        setParseError("Couldn't find column headers in that file. Make sure it's an Event Overview export from Nowsta.");
        return;
      }
      const shiftCols = parsed.meta.fields.filter((f) => /^shift\s*\d+/i.test(f));
      if (shiftCols.length === 0) {
        setParseError("This doesn't look like an Event Overview export — no Shift columns found.");
        return;
      }
      const seen = new Set();
      const found = [];
      const events = [];
      parsed.data.forEach((row) => {
        const venueRaw = (row["Venue"] || "").trim();
        const dateStr = parseDate(stripWeekdayPrefix(row["Date"] || ""));
        const eventName = row["Name"] || "";
        const time = row["Event Time"] || "";
        const address = row["Address"] || "";
        if (!venueRaw || !dateStr) return;

        const assignments = [];
        shiftCols.forEach((col) => {
          const cell = row[col] || "";
          cell.split("\n").forEach((line) => {
            const m = line.trim().match(/^(.*)\s-\s(Confirmed|Requested|Assigned)\s*$/i);
            if (!m) return;
            const workerRaw = m[1].trim();
            const status = m[2];
            const trainee = trainees.find((t) => namesMatch(workerRaw, t.name));
            if (!trainee) return;
            assignments.push({ traineeId: trainee.id, traineeName: trainee.name, status });
          });
        });

        events.push({ venueRaw, date: dateStr, eventName, time, address, assignments });

        assignments.forEach((a) => {
          if (a.status.toLowerCase() !== "confirmed") return;
          const key = `${a.traineeId}|${venueRaw}|${dateStr}`;
          if (seen.has(key)) return;
          seen.add(key);
          found.push({ key, traineeId: a.traineeId, venueRaw, date: dateStr, eventName });
        });
      });
      if (events.length === 0) {
        setParseError("Found no rows with both a Venue and a valid Date in this file.");
        return;
      }
      setMatches(found);
      setRawEvents(events);
      const uniqueVenues = [...new Set(events.map((e) => e.venueRaw))];
      const initialMap = {};
      uniqueVenues.forEach((v) => {
        if (eventVenueMap[v]) {
          initialMap[v] = eventVenueMap[v];
          return;
        }
        const autoMatch = venues.find((ven) => venueNamesMatch(v, ven.name));
        initialMap[v] = autoMatch ? autoMatch.id : "";
      });
      setLabelMap(initialMap);
      setStep(uniqueVenues.every((v) => initialMap[v]) ? 3 : 2);
      if (uniqueVenues.every((v) => initialMap[v])) {
        const eventNameMap = {};
        events.forEach((ev) => {
          const vId = initialMap[ev.venueRaw];
          if (vId && vId !== "skip" && ev.eventName) eventNameMap[ev.eventName] = vId;
        });
        onSaveEventVenueMap({ ...eventVenueMap, ...initialMap, ...eventNameMap });
        const shiftSummary = onImport(
          found
            .filter((m) => initialMap[m.venueRaw])
            .map((m) => ({ traineeId: m.traineeId, venueId: initialMap[m.venueRaw], date: m.date, label: m.eventName }))
        );
        const calEvents = events
          .filter((ev) => initialMap[ev.venueRaw])
          .map((ev) => ({ venueId: initialMap[ev.venueRaw], date: ev.date, eventName: ev.eventName, time: ev.time, address: ev.address, assignments: ev.assignments }));
        onImportEvents(calEvents);
        setResult({ ...shiftSummary, eventCount: calEvents.length });
      }
    };
    reader.onerror = () => setParseError("Couldn't read that file. Try exporting it again from Nowsta.");
    reader.readAsText(file);
  };

  const uniqueVenues = [...new Set(rawEvents.map((e) => e.venueRaw))];
  const allMapped = uniqueVenues.every((v) => labelMap[v] === "skip" || (labelMap[v] && labelMap[v] !== ""));

  const buildRows = () =>
    matches
      .filter((m) => labelMap[m.venueRaw] && labelMap[m.venueRaw] !== "skip")
      .map((m) => ({ traineeId: m.traineeId, venueId: labelMap[m.venueRaw], date: m.date, label: m.eventName }));

  // Also caches event name -> venue, so a Worker Availability file (which only
  // has event names, not venues) can auto-resolve once this file's been imported.
  const buildEventNameMap = () => {
    const map = {};
    rawEvents.forEach((ev) => {
      const vId = labelMap[ev.venueRaw];
      if (vId && vId !== "skip" && ev.eventName) map[ev.eventName] = vId;
    });
    return map;
  };

  const buildEvents = () =>
    rawEvents
      .filter((e) => labelMap[e.venueRaw] && labelMap[e.venueRaw] !== "skip")
      .map((e) => ({
        venueId: labelMap[e.venueRaw],
        date: e.date,
        eventName: e.eventName,
        time: e.time,
        address: e.address,
        assignments: e.assignments,
      }));

  const confirmImport = () => {
    onSaveEventVenueMap({ ...eventVenueMap, ...labelMap, ...buildEventNameMap() });
    const shiftSummary = onImport(buildRows());
    const events = buildEvents();
    onImportEvents(events);
    setResult({ ...shiftSummary, eventCount: events.length });
    setStep(3);
  };

  const reset = () => {
    setStep(1);
    setFileName("");
    setMatches([]);
    setRawEvents([]);
    setLabelMap({});
    setResult(null);
    setParseError("");
  };

  return (
    <div className="max-w-3xl">
      <div className="text-sm mb-4" style={{ color: C.textMuted }}>
        Upload the Event Overview export from Nowsta. It already lists the real venue for each
        event, so mapping is a one-time step per venue name — not per event. Anyone on your roster
        marked <span className="nv-mono" style={{ color: C.gold }}>Confirmed</span> on a shift becomes an upcoming shift here.
      </div>

      {step === 1 && (
        <div className="rounded-lg p-8 text-center flex flex-col items-center gap-3" style={{ background: C.surfaceAlt, border: `1px dashed ${C.border}` }}>
          <UploadCloud size={28} style={{ color: C.gold }} />
          <div className="nv-display font-semibold">Upload Event Overview export</div>
          <label className="text-sm px-4 py-2 rounded-md cursor-pointer" style={{ background: C.gold, color: "#1B140A", fontWeight: 600 }}>
            Choose file
            <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
          </label>
          {parseError && (
            <div className="text-sm flex items-center gap-2" style={{ color: C.brick }}>
              <AlertCircle size={14} /> {parseError}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="text-sm" style={{ color: C.textMuted }}>
            Found <span style={{ color: C.text }}>{matches.length}</span> confirmed shift{matches.length === 1 ? "" : "s"} across{" "}
            <span style={{ color: C.text }}>{uniqueVenues.length}</span> venue name{uniqueVenues.length === 1 ? "" : "s"}. Most matched
            your venue list automatically — only the ones outlined in gold below need a manual pick.
          </div>
          <div className="flex flex-col gap-2 nv-scroll" style={{ maxHeight: 400, overflowY: "auto" }}>
            {uniqueVenues.map((v) => (
              <div key={v} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm" style={{ background: C.surfaceAlt, border: `1px solid ${labelMap[v] ? C.border : C.gold}` }}>
                <span className="flex-1">{v}</span>
                <select
                  value={labelMap[v] || ""}
                  onChange={(e) => setLabelMap((m) => ({ ...m, [v]: e.target.value }))}
                  style={{ ...selectStyle, padding: "5px 8px", width: 220 }}
                >
                  <option value="">Choose venue…</option>
                  {venues.map((ven) => <option key={ven.id} value={ven.id}>{ven.name}</option>)}
                  <option value="skip">Not one of your 10 venues — skip</option>
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmImport}
              disabled={!allMapped}
              className="px-4 py-2 rounded-md text-sm font-semibold"
              style={{ background: allMapped ? C.gold : C.border, color: allMapped ? "#1B140A" : C.textFaint }}
            >
              Import {buildRows().length} upcoming shift{buildRows().length === 1 ? "" : "s"}
            </button>
            <button onClick={reset} className="px-4 py-2 rounded-md text-sm" style={{ color: C.textMuted }}>Start over</button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="rounded-lg p-6 flex flex-col gap-2" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <div className="nv-display font-semibold flex items-center gap-2" style={{ color: C.green }}>
            <Check size={18} /> Import complete
          </div>
          <div className="text-sm" style={{ color: C.textMuted }}>
            {result.added} upcoming shift{result.added === 1 ? "" : "s"} added — check the Approvals tab's "Upcoming" section once dates pass.
            {result.removed > 0 && ` ${result.removed} shift${result.removed === 1 ? "" : "s"} no longer confirmed and removed.`}
            {" "}Also updated the Calendar tab with {result.eventCount} event{result.eventCount === 1 ? "" : "s"} across your venues.
          </div>
          <button onClick={reset} className="mt-2 text-sm px-4 py-2 rounded-md self-start" style={{ background: C.gold, color: "#1B140A", fontWeight: 600 }}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Calendar view: events per venue, with time, address, and trainee assignments ----
function CalendarView({ events, venues }) {
  const [groupBy, setGroupBy] = useState("venue");
  const venueName = (id) => venues.find((v) => v.id === id)?.name || "Unknown venue";

  if (events.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        body={'Import an Event Overview export from the Bulk import tab to populate this calendar.'}
      />
    );
  }

  const sorted = [...events].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

  const groups = {};
  sorted.forEach((e) => {
    const key = groupBy === "venue" ? e.venueId : e.date;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  let groupKeys = Object.keys(groups);
  if (groupBy === "venue") {
    groupKeys = groupKeys.sort((a, b) => venueName(a).localeCompare(venueName(b)));
  } else {
    groupKeys = groupKeys.sort();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2">
        <button
          onClick={() => setGroupBy("venue")}
          className="text-sm px-3 py-1.5 rounded-md font-semibold"
          style={{ background: groupBy === "venue" ? C.gold : "transparent", color: groupBy === "venue" ? "#1B140A" : C.textMuted, border: `1px solid ${groupBy === "venue" ? C.gold : C.border}` }}
        >
          By venue
        </button>
        <button
          onClick={() => setGroupBy("date")}
          className="text-sm px-3 py-1.5 rounded-md font-semibold"
          style={{ background: groupBy === "date" ? C.gold : "transparent", color: groupBy === "date" ? "#1B140A" : C.textMuted, border: `1px solid ${groupBy === "date" ? C.gold : C.border}` }}
        >
          By date
        </button>
      </div>

      {groupKeys.map((key) => (
        <div key={key} className="rounded-lg p-4" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <div className="nv-display font-semibold mb-3" style={{ color: C.gold }}>
            {groupBy === "venue" ? venueName(key) : key}
          </div>
          <div className="flex flex-col gap-3">
            {groups[key].map((e, i) => (
              <div key={i} className="pb-3" style={{ borderBottom: i < groups[key].length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-semibold">{e.eventName || "Untitled event"}</span>
                  {groupBy === "venue" ? (
                    <>
                      <span style={{ color: C.textFaint }}>·</span>
                      <span className="nv-mono text-xs" style={{ color: C.textMuted }}>{e.date}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: C.textFaint }}>·</span>
                      <span style={{ color: C.textMuted }}>{venueName(e.venueId)}</span>
                    </>
                  )}
                  {e.time && (
                    <>
                      <span style={{ color: C.textFaint }}>·</span>
                      <span className="flex items-center gap-1 text-xs" style={{ color: C.textMuted }}>
                        <Clock size={12} /> {e.time}
                      </span>
                    </>
                  )}
                </div>
                {e.address && (
                  <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: C.textFaint }}>
                    <MapPin size={11} /> {e.address}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {e.assignments.length === 0 && (
                    <span className="text-xs" style={{ color: C.textFaint }}>No trainees on this event</span>
                  )}
                  {e.assignments.map((a, j) => {
                    const statusLower = a.status.toLowerCase();
                    const color = statusLower === "confirmed" ? C.green : statusLower === "requested" ? C.gold : C.blue;
                    return (
                      <span
                        key={j}
                        className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{ background: `${color}22`, color }}
                      >
                        {a.traineeName} · {a.status}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Trainee-facing personal calendar ----
function MyCalendar({ events, venues, traineeId }) {
  const venueName = (id) => venues.find((v) => v.id === id)?.name || "Unknown venue";
  const mine = events
    .filter((e) => (e.assignments || []).some((a) => a.traineeId === traineeId))
    .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

  if (mine.length === 0) {
    return (
      <EmptyState
        title="Nothing on your calendar yet"
        body="Once you're confirmed or requested for a shift in Nowsta, it'll show up here after the next import."
      />
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      {mine.map((e, i) => {
        const mine_assignment = (e.assignments || []).find((a) => a.traineeId === traineeId);
        const statusLower = (mine_assignment?.status || "").toLowerCase();
        const color = statusLower === "confirmed" ? C.green : statusLower === "requested" ? C.gold : C.blue;
        const isPast = e.date < today;
        return (
          <div key={i} className="rounded-lg p-4" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, opacity: isPast ? 0.6 : 1 }}>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="font-semibold">{e.eventName || "Untitled event"}</span>
              <span style={{ color: C.textFaint }}>·</span>
              <span style={{ color: C.textMuted }}>{venueName(e.venueId)}</span>
              <span
                className="text-xs px-2 py-0.5 rounded-full ml-auto"
                style={{ background: `${color}22`, color }}
              >
                {mine_assignment?.status || "Scheduled"}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: C.textMuted }}>
              <span className="nv-mono">{e.date}</span>
              {e.time && (
                <span className="flex items-center gap-1"><Clock size={11} /> {e.time}</span>
              )}
            </div>
            {e.address && (
              <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: C.textFaint }}>
                <MapPin size={11} /> {e.address}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MapField({ label, value, headers, onChange, allowNone }) {
  return (
    <label className="text-sm flex flex-col gap-1">
      <span style={{ color: C.textMuted }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {allowNone && <option value="">None</option>}
        {!allowNone && !value && <option value="">Select column…</option>}
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="rounded-lg p-8 text-center" style={{ background: C.surfaceAlt, border: `1px dashed ${C.border}` }}>
      <div className="nv-display font-semibold mb-1" style={{ color: C.text }}>{title}</div>
      <div className="text-sm" style={{ color: C.textMuted }}>{body}</div>
    </div>
  );
}
