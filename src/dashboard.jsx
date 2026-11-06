import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend, LineChart, BarChart, Cell,
} from "recharts";

// ============================================================================
// DATA
// Everything comes from data.json (loaded into D before this runs). scripts/refresh.py rebuilds it every hour;
// the notes inside it are written by the scheduled Claude job. Nothing in this file holds data.
// ============================================================================

const SNAPSHOT = D.SNAPSHOT;
const PACE = D.PACE;
const todaySoFar = PACE.todaySoFar || 0;
const monthToNow = PACE.sepToDate + todaySoFar;
const DAILY = D.DAILY;
const POPUP = D.POPUP;
const CLAIMS = D.CLAIMS;
const WEEKLY = D.WEEKLY;
const COHORTS = D.COHORTS;
const QUALITY = D.QUALITY;
const FX = D.FX;
const Q_FUNNEL = D.Q_FUNNEL;
const Q_BT = D.Q_BT;
const Q_VOL = D.Q_VOL;
const TRENDS = D.TRENDS || [];
const GOLD = D.GOLD || null;
const MONTH = D.MONTH || null;
const CAMPAIGNS = D.CAMPAIGNS || [];
const N = D.notes || {};
const LBL = D.COHORT_LABELS || { now: PACE.monthShort, prev: "" };

const BT = { F: "Freelancer", SP: "Sole prop", C: "Company", LLP: "LLP", PT: "Partnership", HUF: "HUF", "": "" };
const COHORT = { FT: "First-time referrer", RN: "Repeat, never achieved", R1: "Repeat, 1-2 achieved", R3: "Repeat, 3+ achieved" };
const GIFT = { P: "Polaroid", "": "" };
const REFERRERS = (D.REFERRERS_RAW || []).map((r) => ({
  id: r[0], name: r[1] || "", bt: BT[r[2]] || r[2], onboarded: r[3] || "", activated: r[4] || "",
  signups: r[5], obs: r[6], acts: r[7], gift: GIFT[r[8]] || r[8], cohort: COHORT[r[9]] || r[9],
}));
const SHOW_NAMES = REFERRERS.some((r) => r.name);
const DETAIL = D.REFERRER_DETAIL || {};
const FX_RATE = D.FX || 95;
const BAND = { "0_10K_USD": "Under $10K", "UNDER_10L_INR": "Under $10K", "10_20K_USD": "$10K to $20K", "20_50K_USD": "$20K to $50K",
  "50_100K_USD": "$50K to $100K", ">100K_USD": "Over $100K", "OVER_10L_INR": "Over $10K", "": "" };
const STATE = { SIGNUP_COMPLETE: "Signed up", ONBOARDING_COMPLETE: "Onboarded", ACHIEVED: "Activated" };
const usd = (inr) => {
  const v = inr / FX_RATE;
  return v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Math.round(v);
};
const monthsSince = (iso) => {
  if (!iso) return 0;
  const days = (Date.now() - new Date(iso + "T00:00:00+05:30").getTime()) / 864e5;
  return Math.max(1, Math.ceil(days / 30.44));
};
const profile = (name, bt, obd, actd, band, n, vol, firstTx) => ({
  name: name || "", bt: BT[bt] || bt || "", onboarded: obd || "", activated: actd || "", band: BAND[band] || band || "",
  txCount: n || 0, volume: vol || 0, monthly: n ? (vol || 0) / monthsSince(firstTx || actd) : 0, months: n ? monthsSince(firstTx || actd) : 0,
});

const sumBy = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const HEADLINE = (() => {
  const signups = sumBy(REFERRERS, "signups"), obs = sumBy(REFERRERS, "obs"), acts = sumBy(REFERRERS, "acts");
  return {
    signups, onboardings: obs, activations: acts, referrers: REFERRERS.length,
    signupsPerReferrer: +(signups / Math.max(1, REFERRERS.length)).toFixed(2),
    signupToOb: +(100 * obs / Math.max(1, signups)).toFixed(1),
    obToAct: +(100 * acts / Math.max(1, obs)).toFixed(1),
    onboardingsPerDay: +(obs / Math.max(1, SNAPSHOT.campaignFullDays || 1)).toFixed(1),
    rewardsClaimed: REFERRERS.filter((r) => r.gift).length,
  };
})();
const RUNGS = [
  { rung: "Nothing unlocked yet", range: "0", lo: 0, hi: 0 },
  { rung: "Polaroid", range: "1-2", lo: 1, hi: 2 },
  { rung: "AirPods 4", range: "3-4", lo: 3, hi: 4 },
  { rung: "Ray-Ban Meta", range: "5-7", lo: 5, hi: 7 },
  { rung: "iPhone 17", range: "8+", lo: 8, hi: 1e9 },
];
const LADDER = RUNGS.map((g) => {
  const rs = REFERRERS.filter((r) => r.acts >= g.lo && r.acts <= g.hi);
  return { rung: g.rung, range: g.range, referrers: rs.length, signups: sumBy(rs, "signups"), onboarded: sumBy(rs, "obs"),
    achieved: sumBy(rs, "acts"), waiting: sumBy(rs, "obs") - sumBy(rs, "acts"), claimed: rs.filter((r) => r.gift).length };
});
const nextRung = (a) => (a < 1 ? [1, "Polaroid"] : a < 3 ? [3, "AirPods"] : a < 5 ? [5, "Ray-Ban"] : a < 8 ? [8, "iPhone"] : [null, "maxed"]);
const NUDGE = REFERRERS.filter((r) => r.acts >= 1)
  .sort((a, b) => b.acts - a.acts || b.obs - a.obs || b.signups - a.signups)
  .slice(0, 12)
  .map((r) => { const [t, nm] = nextRung(r.acts); return { id: r.id, name: r.name, signups: r.signups, onboarded: r.obs, achieved: r.acts, next: nm, needed: t ? t - r.acts : 0, waiting: r.obs - r.acts, claimed: r.gift }; });
const NEW_VS_REPEAT = Object.values(COHORT).map((c) => {
  const rs = REFERRERS.filter((r) => r.cohort === c); const sg = sumBy(rs, "signups"), ob = sumBy(rs, "obs");
  return { type: c, referrers: rs.length, signups: sg, perRef: +(sg / Math.max(1, rs.length)).toFixed(2), onboarded: ob, achieved: sumBy(rs, "acts"), obPct: +(100 * ob / Math.max(1, sg)).toFixed(1) };
});

// Pace projection: scale this month's full days by the share of each of the last three months that had landed by the same day.
const shares = PACE.months.filter((m) => m.full > 0).map((m) => m.firstN / m.full);
const hasPace = SNAPSHOT.fullDays > 0 && shares.length > 0;
const projMid = hasPace ? Math.round(PACE.sepToDate / (shares.reduce((a, b) => a + b, 0) / shares.length)) : null;
const projLow = hasPace ? Math.round(PACE.sepToDate / Math.max(...shares)) : null;
const projHigh = hasPace ? Math.round(PACE.sepToDate / Math.min(...shares)) : null;
const straightLine = hasPace ? Math.round((PACE.sepToDate / SNAPSHOT.fullDays) * PACE.daysInMonth) : null;

const dailyWithAvg = DAILY.map((d, i) => {
  const window = DAILY.slice(Math.max(0, i - 6), i + 1);
  return { ...d, avg7: Math.round((window.reduce((a, b) => a + b.signups, 0) / window.length) * 10) / 10 };
});

const fmt = (n) => (n === null || n === undefined ? "n/a" : n.toLocaleString("en-IN"));
const fmtc = (n) => (n === null || n === undefined ? "n/a" : Math.abs(n) >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : n.toLocaleString("en-IN"));
const pct = (a, b, d = 1) => (b ? (100 * a / b).toFixed(d) + "%" : "n/a");

// ============================================================================
// THEME (values from the validated reference palette; chart colours are passed as hex because SVG attributes cannot read CSS variables everywhere)
// ============================================================================

const THEMES = {
  light: { page: "#f9f9f7", surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7",
    s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", s4: "#eda100", dim: "#c3c2b7", good: "#006300", bad: "#d03b3b", warn: "#fab219",
    ramp: ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#1c5cab", "#104281"], wash: "rgba(42,120,214,0.10)" },
  dark: { page: "#0d0d0d", surface: "#1a1a19", ink: "#f0efec", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835",
    s1: "#3987e5", s2: "#d95926", s3: "#199e70", s4: "#c98500", dim: "#4a4a47", good: "#0ca30c", bad: "#e66767", warn: "#fab219",
    ramp: ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#184f95"], wash: "rgba(57,135,229,0.14)" },
};
// Colour follows the entity everywhere on the page: signups blue, onboardings aqua, activations orange, rolling average ink.

function currentMode() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark" || t === "light") return t;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function useTheme() {
  const [mode, setMode] = useState(currentMode);
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const fn = () => setMode(currentMode());
    if (mq) (mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn));
    window.addEventListener("themechange", fn);
    return () => { if (mq) (mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn)); window.removeEventListener("themechange", fn); };
  }, []);
  return THEMES[mode];
}
function readPref() { try { const t = localStorage.getItem("theme"); return t === "dark" || t === "light" ? t : "auto"; } catch (e) { return "auto"; } }
function setPref(pref) {
  try { if (pref === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", pref); } catch (e) { /* private window */ }
  if (pref === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = pref;
  window.dispatchEvent(new Event("themechange"));
}

// ============================================================================
// STYLES
// ============================================================================

const css = `
:root { color-scheme: light; --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #898781; --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --accent: #2a78d6; --accent-soft: rgba(42,120,214,0.10); --good: #006300; --bad: #d03b3b; --warn: #fab219; --warn-soft: rgba(250,178,25,0.16); --bad-soft: rgba(208,59,59,0.12); --good-soft: rgba(12,163,12,0.12);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --dim: #c3c2b7; --hatch-a: #b7d3f6; --hatch-b: #e1e0d9; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
  --accent: #3987e5; --accent-soft: rgba(57,135,229,0.16); --good: #0ca30c; --bad: #e66767; --warn-soft: rgba(250,178,25,0.18); --bad-soft: rgba(230,103,103,0.16); --good-soft: rgba(12,163,12,0.18);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --dim: #4a4a47; --hatch-a: #256abf; --hatch-b: #2c2c2a; } }
:root[data-theme="dark"] { color-scheme: dark; --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
  --accent: #3987e5; --accent-soft: rgba(57,135,229,0.16); --good: #0ca30c; --bad: #e66767; --warn-soft: rgba(250,178,25,0.18); --bad-soft: rgba(230,103,103,0.16); --good-soft: rgba(12,163,12,0.18);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --dim: #4a4a47; --hatch-a: #256abf; --hatch-b: #2c2c2a; }
html, body { background: var(--page); margin: 0; }
.app { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--page); font-size: 14px; line-height: 1.45; -webkit-font-smoothing: antialiased; min-height: 100vh; }
.app * { box-sizing: border-box; }
.app h1 { font-size: 20px; font-weight: 650; margin: 0; letter-spacing: -0.01em; }
.app h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
.app h3 { font-size: 13.5px; font-weight: 600; margin: 0 0 8px; }
.app p { margin: 0; }
.app a { color: var(--accent); }
.app .sub, .app .note { color: var(--ink2); font-size: 13px; }
.app .muted { color: var(--muted); }
.app .wrap { max-width: 1180px; margin: 0 auto; padding: 0 20px 56px; overflow-x: clip; }
@media (max-width: 640px) { .app .wrap { padding: 0 16px 48px; } }

/* top bar */
.app .top { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--page) 88%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
.app .topin { max-width: 1180px; margin: 0 auto; padding: 12px 20px 0; display: flex; flex-direction: column; gap: 10px; }
@media (max-width: 640px) { .app .topin { padding: 10px 16px 0; } }
.app .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.app .brand .l { display: flex; align-items: center; gap: 12px; }
.app .logo { width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 13px; letter-spacing: 0.02em; }
.app .fresh { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink2); padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); white-space: nowrap; }
.app .fresh i { width: 8px; height: 8px; border-radius: 50%; background: var(--good); display: inline-block; }
.app .fresh.stale i { background: var(--warn); } .app .fresh.old i { background: var(--bad); }
.app .r { display: flex; align-items: center; gap: 8px; }
.app .btn { font: inherit; font-size: 12.5px; padding: 5px 10px; border: 1px solid var(--border); background: var(--surface); color: var(--ink2); border-radius: 8px; cursor: pointer; }
.app .btn:hover { color: var(--ink); }
.app .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.app nav { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; margin: 0 -4px; }
.app nav::-webkit-scrollbar { display: none; }
.app nav button { font: inherit; font-size: 13.5px; font-weight: 500; padding: 8px 12px 10px; border: none; border-bottom: 2px solid transparent; background: none; cursor: pointer; color: var(--ink2); white-space: nowrap; margin-bottom: -1px; }
.app nav button.on { color: var(--ink); border-bottom-color: var(--ink); }
.app nav button:hover { color: var(--ink); }
.app nav button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 4px; }
.app nav button b { font-weight: 500; color: var(--muted); font-size: 11.5px; margin-left: 6px; }

/* page head + sections */
.app .pagehead { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin: 26px 0 18px; }
.app .pagehead .sub { max-width: 80ch; }
.app .count { text-align: right; }
.app .count b { font-size: 22px; font-weight: 650; display: block; line-height: 1.1; }
.app section { padding: 22px 0; border-top: 1px solid var(--grid); }
.app section.first { border-top: none; padding-top: 4px; }
.app .sechead { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.app .sechead .note { max-width: 72ch; }
.app .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.app .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 28px; }
.app .grid32 { display: grid; grid-template-columns: 3fr 2fr; gap: 32px; }
.app .grid2 > *, .app .grid3 > *, .app .grid32 > *, .app .live > *, .app .stats > * { min-width: 0; }
@media (max-width: 900px) { .app .grid2, .app .grid3, .app .grid32 { grid-template-columns: 1fr; gap: 24px; } }
.app .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
.app .chart { width: 100%; }
.app .chart svg { overflow: visible; }

/* stat tiles */
.app .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.app .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px 11px; min-width: 0; }
.app .stat .lab { color: var(--ink2); font-size: 12.5px; display: block; margin-bottom: 6px; }
.app .stat .val { font-size: 24px; font-weight: 650; line-height: 1.05; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.app .stat .val.hero { font-size: 40px; }
.app .stat .val svg { align-self: center; }
.app .stat .sub { display: block; font-size: 12px; margin-top: 6px; color: var(--muted); }
.app .delta { font-size: 12.5px; font-weight: 500; white-space: nowrap; }
.app .delta.up { color: var(--good); } .app .delta.down { color: var(--bad); } .app .delta.flat { color: var(--muted); }
.app .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; background: var(--accent-soft); color: var(--accent); font-weight: 500; }
.app .pill.live { background: var(--good-soft); color: var(--good); }
.app .pill.ended, .app .pill.gray { background: var(--grid); color: var(--ink2); }
.app .pill.warn { background: var(--warn-soft); color: var(--ink); }

/* pace track */
.app .track { position: relative; height: 118px; margin: 30px 0 6px; }
.app .track .rail { position: absolute; left: 0; right: 0; top: 56px; height: 14px; background: var(--grid); border-radius: 4px; }
.app .track .done { position: absolute; left: 0; top: 56px; height: 14px; background: var(--s1); border-radius: 4px 0 0 4px; }
.app .track .range { position: absolute; top: 56px; height: 14px; background: var(--accent-soft); border-left: 1px solid var(--accent); border-right: 1px solid var(--accent); }
.app .track .mark { position: absolute; top: 46px; width: 2px; height: 34px; background: var(--ink); }
.app .track .mark.light { background: var(--muted); }
.app .track .lbl { position: absolute; font-size: 12px; white-space: nowrap; color: var(--ink2); transform: translateX(-50%); }
.app .track .lbl b { display: block; color: var(--ink); font-size: 15px; font-weight: 600; }
.app .track .lbl.above { top: 0; } .app .track .lbl.below { top: 86px; }
.app .track .lbl.left { transform: translateX(0); } .app .track .lbl.right { transform: translateX(-100%); }

/* tables */
.app table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.app th { text-align: left; font-weight: 500; color: var(--ink2); padding: 6px 8px 8px 0; border-bottom: 1px solid var(--axis); white-space: nowrap; }
.app td { padding: 7px 8px 7px 0; border-bottom: 1px solid var(--grid); vertical-align: top; }
.app th.num, .app td.num { text-align: right; padding-right: 0; padding-left: 8px; }
.app tr.parent td { font-weight: 600; }
.app td.indent { padding-left: 18px; color: var(--ink2); }
.app tr.hl td { background: var(--accent-soft); }
.app .bar { display: inline-block; height: 8px; background: var(--s1); vertical-align: middle; border-radius: 2px; margin-right: 8px; }
.app .bar.neg { background: var(--bad); }
.app .tablewrap { overflow-x: auto; max-height: 640px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.app .tablewrap table { min-width: 960px; }
.app .tablewrap thead th { position: sticky; top: 0; background: var(--surface); z-index: 1; padding: 9px 8px 9px 0; }
.app .tablewrap thead th:first-child, .app .tablewrap td:first-child { padding-left: 12px; }
.app .tablewrap thead th.num, .app .tablewrap td.num { padding-right: 12px; }
.app .tablewrap.short { max-height: none; border: none; background: none; border-radius: 0; }
.app .tablewrap.short table { min-width: 560px; }
.app .tablewrap.short thead th { background: var(--page); }
.app .tablewrap.short thead th:first-child, .app .tablewrap.short td:first-child { padding-left: 0; }
.app .tablewrap.short thead th.num, .app .tablewrap.short td.num { padding-right: 0; }
.app .projtable th, .app .projtable td { white-space: nowrap; padding-left: 14px; } .app .projtable th:first-child, .app .projtable td:first-child { padding-left: 0; }
.app .sortable th { cursor: pointer; user-select: none; }
.app .sortable th:hover { color: var(--ink); }
.app tr.clickable { cursor: pointer; }
.app tr.clickable:hover td { background: var(--accent-soft); }
.app tr.clickable:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.app .modalbg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 50; display: flex; align-items: flex-start; justify-content: center; padding: 4vh 16px; overflow-y: auto; }
.app .modal { background: var(--page); color: var(--ink); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px 16px; width: min(1040px, 100%); max-height: 92vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
.app .modalhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
.app .modalhead h3 { margin: 0 0 2px; font-size: 18px; font-weight: 600; }
.app .modal h4 { margin: 16px 0 8px; font-size: 14px; font-weight: 600; }
.app .modal h4 .muted { font-weight: 400; margin-left: 6px; }
.app .profile { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.app .prow { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.app .prow span { font-size: 12px; color: var(--ink2); }
.app .prow b { font-weight: 500; font-size: 13.5px; }
.app .modaltable { max-height: 48vh; }
.app .modaltable td, .app .modaltable th { padding-right: 12px; white-space: nowrap; }
.app .modaltable td.name { white-space: normal; min-width: 140px; }
.app .sortable th .arrow { display: inline-block; width: 10px; margin-left: 4px; color: var(--accent); font-size: 11px; }
.app .sortable td { padding-top: 5px; padding-bottom: 5px; white-space: nowrap; }
.app .sortable td.name { white-space: normal; min-width: 180px; }
.app .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; font-size: 13px; color: var(--ink2); }
.app .filters select, .app .filters input { font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--ink); }

/* ladder + funnel */
.app .rung { display: grid; grid-template-columns: 150px 1fr 60px; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--grid); }
.app .rung .name { font-weight: 500; } .app .rung .name small { display: block; color: var(--ink2); font-weight: 400; font-size: 12px; }
.app .rung .fill { height: 16px; background: var(--grid); border-radius: 4px; position: relative; overflow: hidden; }
.app .rung .fill i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--s1); border-radius: 4px 0 0 4px; }
.app .rung .fill em { position: absolute; left: 0; top: 0; bottom: 0; background: repeating-linear-gradient(45deg, var(--hatch-a) 0 4px, var(--hatch-b) 4px 8px); }
.app .rung .n { text-align: right; font-weight: 600; }
.app .legend { display: flex; gap: 18px; font-size: 12px; color: var(--ink2); margin-top: 10px; flex-wrap: wrap; }
.app .legend i { display: inline-block; width: 12px; height: 10px; vertical-align: -1px; margin-right: 6px; border-radius: 2px; background: var(--s1); }
.app .legend i.hatch { background: repeating-linear-gradient(45deg, var(--hatch-a) 0 3px, var(--hatch-b) 3px 6px); }
.app .funnel .step { display: grid; grid-template-columns: 190px 1fr 92px; gap: 12px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--grid); }
.app .funnel .step .lab { font-size: 13px; } .app .funnel .step .lab small { display: block; color: var(--muted); font-size: 11.5px; }
.app .funnel .step .fill { height: 14px; background: var(--grid); border-radius: 4px; overflow: hidden; }
.app .funnel .step .fill i { display: block; height: 100%; border-radius: 4px 0 0 4px; }
.app .funnel .step .v { text-align: right; font-weight: 600; } .app .funnel .step .v small { display: block; font-weight: 400; color: var(--muted); font-size: 11.5px; }
@media (max-width: 640px) { .app .funnel .step { grid-template-columns: 1fr 70px; } .app .funnel .step .fill { grid-column: 1 / -1; } .app .rung { grid-template-columns: 120px 1fr 48px; } }

.app .tabs { display: flex; gap: 4px; margin-bottom: 12px; flex-wrap: wrap; }
.app .tabs button { font: inherit; font-size: 13px; padding: 5px 12px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--ink2); }
.app .tabs button.on { background: var(--ink); color: var(--page); border-color: var(--ink); }
.app .tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.app .callout { border-left: 3px solid var(--accent); padding: 8px 14px; color: var(--ink2); font-size: 13px; margin: 0 0 16px; max-width: 78ch; background: var(--surface); border-radius: 0 8px 8px 0; }
.app .callout.warn { border-left-color: var(--bad); }
.app .insights { max-width: 82ch; margin-top: 20px; }
.app .insights p { margin: 0 0 10px; font-size: 13.5px; color: var(--ink2); }
.app .live { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px) { .app .live { grid-template-columns: 1fr; } }
.app .livecard { display: flex; justify-content: space-between; gap: 12px; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.app .livecard:hover { border-color: var(--accent); }
.app .livecard b { display: block; font-size: 14px; }
.app .livecard span { color: var(--ink2); font-size: 12.5px; }
.app footer { color: var(--muted); font-size: 12.5px; margin-top: 30px; padding-top: 16px; border-top: 1px solid var(--grid); max-width: 86ch; }
.app .tip { background: var(--surface); border: 1px solid var(--border); padding: 8px 10px; font-size: 12.5px; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
.app .tip .t { color: var(--ink2); margin-bottom: 4px; }
.app .tip .row { display: flex; align-items: center; gap: 8px; }
.app .tip .row b { color: var(--ink); min-width: 36px; }
.app .tip .row span { color: var(--ink2); }
.app .tip .k { width: 12px; height: 3px; border-radius: 2px; display: inline-block; }
`;

// ============================================================================
// SMALL COMPONENTS
// ============================================================================

function Tip({ active, payload, label, fmtv }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="tip">
      <div className="t">{label}</div>
      {payload.map((p) => (
        <div className="row" key={p.dataKey}><i className="k" style={{ background: p.color || p.fill }} /><b>{fmtv ? fmtv(p.value, p.dataKey) : fmt(p.value)}</b><span>{p.name}</span></div>
      ))}
    </div>
  );
}

function Delta({ v, good = true, suffix = "%" }) {
  if (v === null || v === undefined || !isFinite(v)) return <span className="delta flat">n/a</span>;
  const dir = v > 1 ? "up" : v < -1 ? "down" : "flat";
  const cls = dir === "flat" ? "flat" : (dir === "up") === good ? "up" : "down";
  return <span className={`delta ${cls}`}>{dir === "up" ? "▲" : dir === "down" ? "▼" : "▬"} {Math.abs(v).toFixed(1)}{suffix}</span>;
}

function Spark({ values, color, dim, width = 76, height = 24 }) {
  const vs = values.filter((v) => v !== null && v !== undefined);
  if (vs.length < 2) return null;
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 6) + 3, height - 3 - (((v ?? min) - min) / span) * (height - 6)]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke={dim} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}

function Stat({ label, value, sub, delta, deltaGood = true, deltaSuffix, spark, T, hero }) {
  return (
    <div className="stat">
      <span className="lab">{label}</span>
      <div className={`val${hero ? " hero" : ""}`}>
        <span>{value}</span>
        {delta !== undefined && <Delta v={delta} good={deltaGood} suffix={deltaSuffix} />}
        {spark && <Spark values={spark} color={T.s1} dim={T.dim} />}
      </div>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

function Notes({ items, title }) {
  const list = Array.isArray(items) ? items : items ? [items] : [];
  if (!list.length) return null;
  return (
    <div className="insights">
      {title && <h2 style={{ marginTop: 4 }}>{title}</h2>}
      {list.map((t, i) => <p key={i}>{t}</p>)}
    </div>
  );
}

const axis = (T) => ({ tick: { fontSize: 11.5, fill: T.muted }, axisLine: false, tickLine: false });

function PaceTrack() {
  const target = PACE.target || 0, stretch = PACE.stretchPlus || 0;
  const max = Math.max(stretch, target, projHigh || 0, monthToNow) * 1.08 || 1;
  const p = (v) => `${(v / max) * 100}%`;
  return (
    <div className="track" aria-label="Monthly onboardings pace">
      <div className="rail" />
      {hasPace && <div className="range" style={{ left: p(projLow), width: p(projHigh - projLow) }} />}
      <div className="done" style={{ width: p(monthToNow) }} />
      <div className="lbl above left" style={{ left: 0 }}>
        <b>{monthToNow}</b>onboarded, 1 {PACE.monthShort} to now ({todaySoFar} today so far)
      </div>
      {hasPace && <><div className="mark light" style={{ left: p(projMid) }} />
        <div className="lbl above" style={{ left: p(projMid) }}><b>{projMid}</b>projected, range {projLow} to {projHigh}</div></>}
      {target > 0 && <><div className="mark" style={{ left: p(target) }} /><div className="lbl below" style={{ left: p(target) }}><b>{target}</b>{PACE.monthShort} target</div></>}
      {stretch > 0 && <><div className="mark" style={{ left: p(stretch) }} /><div className="lbl below" style={{ left: p(stretch) }}><b>{stretch}</b>stretch plus</div></>}
      {!target && <div className="lbl below right" style={{ left: "100%" }}><b>no target</b>set for {PACE.monthName} in config.json</div>}
    </div>
  );
}

// ============================================================================
// REFERRER TABLE
// ============================================================================

function ProfileRow({ label, value, muted }) {
  return <div className="prow"><span>{label}</span><b className={muted ? "muted" : ""}>{value}</b></div>;
}

function ReferrerModal({ id, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  const raw = DETAIL[String(id)];
  const row = REFERRERS.find((r) => r.id === id) || {};
  if (!raw) {
    return (
      <div className="modalbg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="modalhead"><h3>Exporter {id}</h3><button className="btn" onClick={onClose}>Close</button></div>
          <p className="sub">No detail record yet. It appears after the next hourly refresh.</p>
        </div>
      </div>
    );
  }
  const p = profile(raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7]);
  const referees = (raw[9] || []).map((x) => ({ id: x[0], state: STATE[x[9]] || x[9], signup: x[3], ...profile(x[1], x[2], x[4], x[5], x[6], x[7], x[8], x[5]) }));
  const refObs = referees.filter((r) => r.onboarded).length, refActs = referees.filter((r) => r.activated).length;
  const refVol = referees.reduce((a, r) => a + r.volume, 0), refTx = referees.reduce((a, r) => a + r.txCount, 0);
  const volCell = (r) => r.txCount ? <>{usd(r.monthly)}<span className="muted"> /mo, {usd(r.volume)} total</span></> : <span className="muted">none</span>;
  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modalhead">
          <div>
            <h3>{p.name ? p.name : "Exporter " + id}</h3>
            <p className="sub">Exporter {id}{p.bt ? ", " + p.bt.toLowerCase() : ""}{row.cohort ? ". " + row.cohort : ""}{row.gift ? ". Gift claimed: " + row.gift : ""}</p>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <div className="profile">
          <ProfileRow label="Business type" value={p.bt || "not set"} muted={!p.bt} />
          <ProfileRow label="Onboarded" value={p.onboarded || "not yet"} muted={!p.onboarded} />
          <ProfileRow label="Activated" value={p.activated || "not yet"} muted={!p.activated} />
          <ProfileRow label="Transactions" value={p.txCount ? fmt(p.txCount) + (raw[8] ? ", last on " + raw[8] : "") : "none"} muted={!p.txCount} />
          <ProfileRow label="Monthly volume" value={p.txCount ? usd(p.monthly) + " a month over " + p.months + (p.months === 1 ? " month" : " months") : "none"} muted={!p.txCount} />
          <ProfileRow label="Total volume" value={p.txCount ? usd(p.volume) : "none"} muted={!p.txCount} />
          <ProfileRow label="Stated volume" value={p.band || "not stated"} muted={!p.band} />
          <ProfileRow label="This campaign" value={`${referees.length} signups, ${refObs} onboarded, ${refActs} activated`} />
        </div>
        <h4>Referees <span className="muted">{referees.length}, together {fmt(refTx)} transactions and {usd(refVol)} total volume</span></h4>
        <div className="tablewrap modaltable">
          <table>
            <thead>
              <tr>
                <th className="num">Exporter ID</th>{SHOW_NAMES && <th>Name</th>}<th>Business type</th><th>Signed up</th><th>Onboarded</th><th>Activated</th>
                <th>Stated volume</th><th className="num">Transactions</th><th>Monthly volume</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {referees.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.id}</td>
                  {SHOW_NAMES && <td className="name">{r.name || <span className="muted">not set</span>}</td>}
                  <td>{r.bt || <span className="muted">not set</span>}</td>
                  <td>{r.signup}</td>
                  <td>{r.onboarded || <span className="muted">not yet</span>}</td>
                  <td>{r.activated || <span className="muted">not yet</span>}</td>
                  <td>{r.band || <span className="muted">not stated</span>}</td>
                  <td className="num">{r.txCount || <span className="muted">0</span>}</td>
                  <td>{volCell(r)}</td>
                  <td><span className={"pill " + (r.state === "Activated" ? "" : "gray")}>{r.state}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>Volumes are settled payouts converted at {FX_RATE} rupees to the dollar. Monthly volume is total volume divided by months since the first payout. Stated volume is what the exporter said at onboarding.</p>
      </div>
    </div>
  );
}

const REF_COLS_ALL = [
  { key: "id", label: "Exporter ID", num: true },
  { key: "bt", label: "Business type" },
  { key: "onboarded", label: "Onboarded" },
  { key: "activated", label: "Activated" },
  { key: "signups", label: "Signups", num: true },
  { key: "obs", label: "Onboardings", num: true },
  { key: "acts", label: "Activations", num: true },
  { key: "gift", label: "Gift claimed" },
  { key: "cohort", label: "Cohort" },
];
const REF_COLS = SHOW_NAMES ? [REF_COLS_ALL[0], { key: "name", label: "Name" }, ...REF_COLS_ALL.slice(1)] : REF_COLS_ALL;

function ReferrerTable() {
  const [sortKey, setSortKey] = useState("acts");
  const [dir, setDir] = useState(-1);
  const [cohort, setCohort] = useState("all");
  const [bt, setBt] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const close = () => setOpen(null);
  const onSort = (key) => {
    if (key === sortKey) setDir(-dir);
    else { setSortKey(key); setDir(REF_COLS.find((c) => c.key === key).num ? -1 : 1); }
  };
  const rows = REFERRERS
    .filter((r) => cohort === "all" || r.cohort === cohort)
    .filter((r) => bt === "all" || r.bt === bt)
    .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || String(r.id).includes(q))
    .sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av === bv) return b.signups - a.signups || a.id - b.id;
      if (av === "" || av === null) return 1;
      if (bv === "" || bv === null) return -1;
      return (av < bv ? -1 : 1) * dir;
    });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <div className="filters">
        <input placeholder={SHOW_NAMES ? "Search name or id" : "Search exporter id"} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cohort} onChange={(e) => setCohort(e.target.value)}>
          <option value="all">All cohorts</option>
          {Object.values(COHORT).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={bt} onChange={(e) => setBt(e.target.value)}>
          <option value="all">All business types</option>
          {["Freelancer", "Sole prop", "Company", "LLP", "Partnership", "HUF"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span>{rows.length} referrers, {sum("signups")} signups, {sum("obs")} onboarded, {sum("acts")} activated. Click a header to sort, a row for referrer and referee details.</span>
      </div>
      <div className="tablewrap">
        <table className="sortable">
          <thead>
            <tr>
              {REF_COLS.map((c) => (
                <th key={c.key} className={c.num ? "num" : ""} onClick={() => onSort(c.key)}>
                  {c.label}<span className="arrow">{sortKey === c.key ? (dir === 1 ? "▲" : "▼") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(r.id); } }}>
                <td className="num">{r.id}</td>
                {SHOW_NAMES && <td className="name">{r.name}</td>}
                <td>{r.bt}</td>
                <td>{r.onboarded}</td>
                <td>{r.activated || <span className="muted">not yet</span>}</td>
                <td className="num">{r.signups}</td>
                <td className="num">{r.obs}</td>
                <td className="num">{r.acts}</td>
                <td>{r.gift}</td>
                <td>{r.cohort}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open !== null && <ReferrerModal id={open} onClose={close} />}
    </>
  );
}

// ============================================================================
// VIEWS
// ============================================================================

function Overview({ T, go }) {
  const last = TRENDS[TRENDS.length - 1] || {};
  const prev = TRENDS[TRENDS.length - 2] || {};
  const sameDaysLastMonth = PACE.months[PACE.months.length - 1];
  const obDelta = sameDaysLastMonth && sameDaysLastMonth.firstN ? (100 * (PACE.sepToDate - sameDaysLastMonth.firstN)) / sameDaysLastMonth.firstN : null;
  const rewards = CLAIMS.reduce((a, c) => a + (c.status === "Claimed" ? c.count : 0), 0);
  const spark = (k) => TRENDS.slice(-12).map((t) => t[k]);
  const trendRows = TRENDS.map((t) => ({ ...t, label: t.month + (t.partial ? " (to date)" : "") }));
  return (
    <>
      <div className="pagehead">
        <div>
          <h2 style={{ fontSize: 18 }}>Referrals at a glance</h2>
          <p className="sub">Program-wide numbers, every campaign included. {PACE.monthName} is {SNAPSHOT.fullDays} full day{SNAPSHOT.fullDays === 1 ? "" : "s"} in.</p>
        </div>
      </div>

      <section className="first">
        <div className="stats">
          <Stat T={T} label={`${PACE.monthName} referral onboardings`} value={fmt(monthToNow)} hero
            sub={`${PACE.target ? `target ${PACE.target}${projMid ? `, projecting about ${projMid}` : ""}` : projMid ? `projecting about ${projMid}` : "no target set"}${obDelta !== null ? `. Arrow: first ${SNAPSHOT.fullDays} full days, ${fmt(PACE.sepToDate)} vs ${fmt(sameDaysLastMonth.firstN)} in ${LBL.prev}` : ""}`}
            delta={obDelta} deltaGood spark={spark("refOnboardings")} />
          <Stat T={T} label="Referral signups this month" value={fmt(last.signups)} sub={`${fmt(last.referrers)} referrers, ${fmt(last.firstTimers)} first-timers`} spark={spark("signups")} />
          <Stat T={T} label="Referral activations this month" value={fmt(last.refActivations)} sub={`${prev.month || "last month"}: ${fmt(prev.refActivations)}`} spark={spark("refActivations")} />
          <Stat T={T} label="Share rate" value={last.shareRate != null ? `${last.shareRate}%` : "n/a"} sub={`of ${fmt(last.transactors)} transactors referred. ${prev.month || ""}: ${prev.shareRate}%`} spark={spark("shareRate")} />
          <Stat T={T} label="Referral share of all onboardings" value={last.refShare != null ? `${last.refShare}%` : "n/a"} sub={`${fmt(last.refOnboardings)} of ${fmt(last.allOnboardings)}. ${prev.month || ""}: ${prev.refShare}%`} spark={spark("refShare")} />
          <Stat T={T} label="Gifts claimed, live campaigns" value={fmt(rewards + (GOLD ? GOLD.funnel.claimed : 0))} sub={`${rewards} milestone rewards, ${GOLD ? GOLD.funnel.claimed : 0} gold coins`} />
        </div>
      </section>

      <section>
        <div className="sechead"><h2>What is running</h2></div>
        <div className="live">
          {MONTH && <button className="livecard" onClick={() => go("month")}>
            <div><b>{MONTH.monthName} projection</b><span>Day {MONTH.fullDays + 1} of {MONTH.daysInMonth}. Signups projecting about {fmt(MONTH.proj.signups.projected)}, onboardings {fmt(MONTH.proj.onboardings.projected)}, gold coins {fmt(MONTH.proj.coins.projected)}.</span></div>
            <span className="pill">projection</span>
          </button>}
          <button className="livecard" onClick={() => go("milestone")}>
            <div><b>Milestone ladder campaign</b><span>{SNAPSHOT.campaignEnded ? `Ended ${SNAPSHOT.campaignEnd}` : `Day ${SNAPSHOT.campaignDay} of ${SNAPSHOT.campaignDays || 61}, ${SNAPSHOT.daysLeft} days left`}. {fmt(HEADLINE.signups)} signups, {fmt(HEADLINE.activations)} activations, {rewards} rewards claimed.</span></div>
            <span className={`pill ${SNAPSHOT.campaignEnded ? "ended" : "live"}`}>{SNAPSHOT.campaignEnded ? "ended" : "live"}</span>
          </button>
          {GOLD && <button className="livecard" onClick={() => go("gold")}>
            <div><b>{GOLD.label}</b><span>Day {GOLD.dayN}, since {GOLD.startLabel}{GOLD.openToAllLabel ? `, open to everyone since ${GOLD.openToAllLabel}` : ""}. {GOLD.funnel.referrers} referrers, {fmt(GOLD.funnel.signups)} signups, {GOLD.funnel.achieved} activated, {GOLD.funnel.claimed} coins claimed.</span></div>
            <span className="pill live">live</span>
          </button>}
        </div>
      </section>

      <section>
        <div className="sechead">
          <h2>Thirteen months of referrals</h2>
          <span className="note">Signups and referrers exclude internal and flagged ids. Onboardings and activations count each referee once, on their first referrer. The current month is partial.</span>
        </div>
        <div className="chart" style={{ height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={trendRows} margin={{ top: 12, right: 16, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={T.grid} />
              <XAxis dataKey="month" {...axis(T)} />
              <YAxis {...axis(T)} tickFormatter={fmtc} />
              <Tooltip content={<Tip />} cursor={{ stroke: T.axis }} />
              <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12, color: T.ink2 }} />
              <Line isAnimationActive={false} dataKey="signups" name="Signups" stroke={T.s1} strokeWidth={2} dot={{ r: 3.5, fill: T.s1, stroke: T.surface, strokeWidth: 2 }} activeDot={{ r: 5 }} />
              <Line isAnimationActive={false} dataKey="refOnboardings" name="Onboardings" stroke={T.s3} strokeWidth={2} dot={{ r: 3.5, fill: T.s3, stroke: T.surface, strokeWidth: 2 }} activeDot={{ r: 5 }} />
              <Line isAnimationActive={false} dataKey="refActivations" name="Activations" stroke={T.s2} strokeWidth={2} dot={{ r: 3.5, fill: T.s2, stroke: T.surface, strokeWidth: 2 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="grid2" style={{ marginTop: 22 }}>
          <div>
            <h3>Share rate: transactors who referred that month</h3>
            <div className="chart" style={{ height: 180 }}>
              <ResponsiveContainer>
                <ComposedChart data={trendRows} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={T.grid} />
                  <XAxis dataKey="month" {...axis(T)} interval={2} />
                  <YAxis {...axis(T)} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<Tip fmtv={(v) => `${v}%`} />} cursor={{ stroke: T.axis }} />
                  <Line isAnimationActive={false} dataKey="shareRate" name="Share rate" stroke={T.s1} strokeWidth={2} dot={{ r: 3, fill: T.s1, stroke: T.surface, strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <h3>Referral share of all onboardings</h3>
            <div className="chart" style={{ height: 180 }}>
              <ResponsiveContainer>
                <ComposedChart data={trendRows} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={T.grid} />
                  <XAxis dataKey="month" {...axis(T)} interval={2} />
                  <YAxis {...axis(T)} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<Tip fmtv={(v) => `${v}%`} />} cursor={{ stroke: T.axis }} />
                  <Line isAnimationActive={false} dataKey="refShare" name="Referral share" stroke={T.s3} strokeWidth={2} dot={{ r: 3, fill: T.s3, stroke: T.surface, strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="tablewrap short" style={{ marginTop: 18 }}>
          <table>
            <thead><tr><th>Month</th><th className="num">Signups</th><th className="num">Referrers</th><th className="num">First-timers</th><th className="num">Onboardings</th><th className="num">Activations</th><th className="num">All onboardings</th><th className="num">Referral share</th><th className="num">Transactors</th><th className="num">Share rate</th></tr></thead>
            <tbody>
              {TRENDS.slice(-7).map((t) => (
                <tr key={t.ym} className={t.partial ? "hl" : ""}><td style={{ whiteSpace: "nowrap" }}>{t.month}{t.partial ? " (to date)" : ""}</td><td className="num">{fmt(t.signups)}</td><td className="num">{fmt(t.referrers)}</td><td className="num">{fmt(t.firstTimers)}</td><td className="num">{fmt(t.refOnboardings)}</td><td className="num">{fmt(t.refActivations)}</td><td className="num">{fmt(t.allOnboardings)}</td><td className="num">{t.refShare}%</td><td className="num">{fmt(t.transactors)}</td><td className="num">{t.shareRate}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notes items={N.overview} title="What the trend says" />
      </section>
    </>
  );
}

function Milestone({ T }) {
  const [tab, setTab] = useState("mix");
  const maxRef = Math.max(...LADDER.map((r) => r.referrers), 1);
  const weeklyRows = WEEKLY.map((w) => ({ ...w, pre: w.period === "pre" ? w.signups : null, camp: w.period === "campaign" ? w.signups : null }));
  return (
    <>
      <div className="pagehead">
        <div>
          <h2 style={{ fontSize: 18 }}>Milestone ladder campaign</h2>
          <p className="sub">1 Sep to 31 Oct 2026. Ladder: 1 Polaroid, 3 AirPods 4, 5 Ray-Ban Meta, 8 iPhone 17. Campaign 26 signups only, except the monthly target block.</p>
        </div>
        <div className="count">
          <b>{SNAPSHOT.campaignEnded ? "Campaign ended" : `Day ${SNAPSHOT.campaignDay} of ${SNAPSHOT.campaignDays || 61}`}</b>
          <span className="sub">{SNAPSHOT.campaignEnded ? `on ${SNAPSHOT.campaignEnd}` : `${SNAPSHOT.daysLeft} days left`}</span>
        </div>
      </div>

      <section className="first">
        <div className="sechead">
          <h2>{PACE.monthName} onboardings against target</h2>
          <span className="note">All referral onboardings, not just campaign signups, so it lines up with the {PACE.target || "monthly"} target. Projection uses full days only.</span>
        </div>
        <PaceTrack />
        <p className="note" style={{ marginTop: 22 }}>{N.pace}</p>
      </section>

      <section>
        <div className="sechead"><h2>Campaign totals</h2><span className="note">Signups on campaign 26 only.</span></div>
        <div className="stats">
          <Stat T={T} label="Signups" value={fmt(HEADLINE.signups)} />
          <Stat T={T} label="Referrers" value={fmt(HEADLINE.referrers)} sub={`${HEADLINE.signupsPerReferrer} signups each`} />
          <Stat T={T} label="Onboarded" value={fmt(HEADLINE.onboardings)} sub={`${HEADLINE.signupToOb}% of signups`} />
          <Stat T={T} label="Activated" value={fmt(HEADLINE.activations)} sub={`${HEADLINE.obToAct}% of onboarded`} />
          <Stat T={T} label="Onboardings per day" value={HEADLINE.onboardingsPerDay} />
          <Stat T={T} label="Rewards claimed" value={fmt(HEADLINE.rewardsClaimed)} sub={CLAIMS.map((c) => `${c.count} ${c.reward.replace(" Camera", "")}`).join(", ")} />
        </div>
        {N.excluded && <p className="callout warn" style={{ marginTop: 16 }}>{N.excluded}</p>}
      </section>

      <section>
        <div className="sechead">
          <h2>Daily signups, onboardings and activations</h2>
          <span className="note">{N.daily}</span>
        </div>
        <div className="chart" style={{ height: 270 }}>
          <ResponsiveContainer>
            <ComposedChart data={dailyWithAvg} margin={{ top: 10, right: 10, left: -18, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke={T.grid} />
              <XAxis dataKey="day" {...axis(T)} interval="preserveStartEnd" minTickGap={28} />
              <YAxis {...axis(T)} />
              <Tooltip content={<Tip />} cursor={{ fill: T.wash }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12, color: T.ink2 }} />
              <Bar isAnimationActive={false} dataKey="signups" name="Signups" fill={T.s1} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar isAnimationActive={false} dataKey="onboardings" name="Onboardings" fill={T.s3} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Line isAnimationActive={false} dataKey="avg7" name="Signups, 7-day average" stroke={T.ink} strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} dataKey="activations" name="Activations" stroke={T.s2} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <div className="grid2">
          <div>
            <div className="sechead"><h2>Where referrers sit on the ladder</h2></div>
            {LADDER.map((r) => (
              <div className="rung" key={r.rung}>
                <div className="name">{r.rung}<small>{r.range} activated</small></div>
                <div className="fill" title={`${r.referrers} referrers, ${r.waiting} onboarded referees waiting to activate`}>
                  <i style={{ width: `${(r.referrers / maxRef) * 100}%` }} />
                  {r.waiting > 0 && <em style={{ left: `${(r.referrers / maxRef) * 100}%`, width: `${Math.min(100 - (r.referrers / maxRef) * 100, (r.waiting / maxRef) * 100)}%` }} />}
                </div>
                <div className="n">{r.referrers}</div>
              </div>
            ))}
            <div className="legend"><span><i />referrers on this rung</span><span><i className="hatch" />onboarded referees still to activate</span></div>
            <p className="note" style={{ marginTop: 12 }}>{N.ladder}</p>
          </div>
          <div>
            <div className="sechead"><h2>Closest to the next rung</h2><span className="note">For Support and Sales to nudge.</span></div>
            <table>
              <thead><tr><th>Referrer</th><th className="num">Active</th><th className="num">Waiting</th><th style={{ paddingLeft: 16 }}>Next</th><th className="num">Needs</th></tr></thead>
              <tbody>
                {NUDGE.map((n) => (
                  <tr key={n.id}>
                    <td>{n.name ? <>{n.name} <span className="muted">{n.id}</span></> : <>Exporter {n.id}</>}{n.claimed && <> <span className="pill">claimed {n.claimed}</span></>}</td>
                    <td className="num">{n.achieved}</td>
                    <td className="num">{n.waiting || ""}</td>
                    <td style={{ paddingLeft: 16, whiteSpace: "nowrap" }}>{n.next}</td>
                    <td className="num">{n.needed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="sechead">
          <h2>Share rate by cohort, {LBL.now} to date vs the same days in {LBL.prev}</h2>
          <span className="note">Share rate = referrers in the window / users in the cohort. Payees excluded, so bases run a little lower than the leadership sheet.</span>
        </div>
        <div className="tablewrap short">
          <table>
            <thead>
              <tr>
                <th>Cohort</th><th className="num">Base</th>
                <th className="num">Referrers {LBL.now}</th><th className="num">Share {LBL.now}</th>
                <th className="num">Referrers {LBL.prev}</th><th className="num">Share {LBL.prev}</th>
                <th style={{ paddingLeft: 24 }}>Change</th>
              </tr>
            </thead>
            <tbody>
              {COHORTS.map((c) => (
                <tr key={c.id} className={c.indent ? "" : "parent"}>
                  <td className={c.indent ? "indent" : ""}>{c.id}&nbsp; {c.label}</td>
                  <td className="num">{fmt(c.base)}</td>
                  <td className="num">{c.refNow}</td>
                  <td className="num">{c.rateNow.toFixed(2)}%</td>
                  <td className="num">{c.refPrev}</td>
                  <td className="num">{c.ratePrev.toFixed(2)}%</td>
                  <td style={{ paddingLeft: 24, whiteSpace: "nowrap" }}>
                    <span className={`bar${(c.delta || 0) < 0 ? " neg" : ""}`} style={{ width: Math.min(90, Math.abs(c.delta || 0) * 1.1) }} />
                    <Delta v={c.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 12 }}>{N.cohorts}</p>
      </section>

      <section>
        <div className="grid2">
          <div>
            <div className="sechead"><h2>Weekly signups, before and during</h2><span className="note">Grey weeks are the eight before launch.</span></div>
            <div className="chart" style={{ height: 200 }}>
              <ResponsiveContainer>
                <ComposedChart data={weeklyRows} margin={{ top: 10, right: 0, left: -18, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke={T.grid} />
                  <XAxis dataKey="week" {...axis(T)} interval={1} />
                  <YAxis {...axis(T)} />
                  <Tooltip content={<Tip />} cursor={{ fill: T.wash }} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12, color: T.ink2 }} />
                  <Bar isAnimationActive={false} dataKey="pre" name="Before the campaign" fill={T.dim} radius={[4, 4, 0, 0]} maxBarSize={22} stackId="w" />
                  <Bar isAnimationActive={false} dataKey="camp" name="Campaign weeks" fill={T.s1} radius={[4, 4, 0, 0]} maxBarSize={22} stackId="w" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <h3 style={{ marginTop: 14 }}>Signups per referrer, by week</h3>
            <div className="chart" style={{ height: 120 }}>
              <ResponsiveContainer>
                <LineChart data={weeklyRows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={T.grid} />
                  <XAxis dataKey="week" {...axis(T)} interval={1} />
                  <YAxis {...axis(T)} domain={[1, "auto"]} tickFormatter={(v) => v.toFixed(1)} />
                  <Tooltip content={<Tip fmtv={(v) => v.toFixed(2)} />} cursor={{ stroke: T.axis }} />
                  <Line isAnimationActive={false} dataKey="perRef" name="Signups per referrer" stroke={T.ink} strokeWidth={2} dot={{ r: 3, fill: T.ink, stroke: T.surface, strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="tabs" role="tablist">
              <button className={tab === "mix" ? "on" : ""} onClick={() => setTab("mix")}>Who is referring</button>
              <button className={tab === "quality" ? "on" : ""} onClick={() => setTab("quality")}>Onboarding speed</button>
              <button className={tab === "claims" ? "on" : ""} onClick={() => setTab("claims")}>Claims</button>
            </div>
            {tab === "mix" && (<>
              <div className="tablewrap short"><table>
                <thead><tr><th>Referrer type</th><th className="num">Referrers</th><th className="num">Signups</th><th className="num">Each</th><th className="num">Onboarded</th><th className="num">OB %</th></tr></thead>
                <tbody>{NEW_VS_REPEAT.map((r) => (
                  <tr key={r.type}><td>{r.type}</td><td className="num">{r.referrers}</td><td className="num">{r.signups}</td><td className="num">{r.perRef.toFixed(2)}</td><td className="num">{r.onboarded}</td><td className="num">{r.obPct}%</td></tr>))}
                </tbody></table></div>
              <p className="note" style={{ marginTop: 10 }}>{N.mix}</p>
            </>)}
            {tab === "quality" && (<>
              <div className="tablewrap short"><table>
                <thead><tr><th>Signup week</th><th className="num">Signups</th><th className="num">OB in 1d</th><th className="num">OB in 7d</th><th className="num">OB so far</th><th className="num">Active of OB</th><th className="num">Median days OB to active</th></tr></thead>
                <tbody>{QUALITY.map((q) => (
                  <tr key={q.week}><td>{q.week}</td><td className="num">{q.signups}</td><td className="num">{q.ob1d}%</td><td className="num">{q.ob7d}%</td><td className="num">{q.obSoFar}%</td><td className="num">{q.actOfOb}%</td><td className="num">{q.medianDays}</td></tr>))}
                </tbody></table></div>
              <p className="note" style={{ marginTop: 10 }}>{N.weeklyQuality}</p>
            </>)}
            {tab === "claims" && (<>
              <div className="tablewrap short"><table>
                <thead><tr><th>Reward</th><th className="num">At</th><th>Status</th><th className="num">Count</th><th>First</th><th>Last</th><th className="num">Avg activations at claim</th></tr></thead>
                <tbody>{CLAIMS.map((c) => (
                  <tr key={c.reward + c.status}><td>{c.reward}</td><td className="num">{c.threshold}</td><td>{c.status}</td><td className="num">{c.count}</td><td>{c.first}</td><td>{c.last}</td><td className="num">{Number(c.avgAchieved).toFixed(1)}</td></tr>))}
                </tbody></table></div>
              <p className="note" style={{ marginTop: 10 }}>{N.claims}</p>
            </>)}
          </div>
        </div>
      </section>

      <section>
        <div className="sechead">
          <h2>Reward popup: what people choose</h2>
          <span className="note">{N.popupHeader}{POPUP.stale ? " Mixpanel did not answer on the last run, so these are the previous numbers." : ""}</span>
        </div>
        <div className="grid3">
          <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Stat T={T} label="Saw the campaign widget" value={fmtc(POPUP.widgetUniqueUsers)} sub={`unique users, ${POPUP.window}`} />
            <Stat T={T} label="Of them referred" value={pct(HEADLINE.referrers, POPUP.widgetUniqueUsers)} sub={`${HEADLINE.referrers} referrers`} />
          </div>
          <div>
            <div className="rung"><div className="name">Opened claim popup</div><div className="fill"><i style={{ width: "100%" }} /></div><div className="n">{POPUP.claimCta}</div></div>
            <div className="rung"><div className="name">Took the reward<small>exits to default $30 program</small></div><div className="fill"><i style={{ width: `${POPUP.claimCta ? (POPUP.claimConfirm / POPUP.claimCta) * 100 : 0}%` }} /></div><div className="n">{POPUP.claimConfirm}</div></div>
            <div className="rung"><div className="name">Chose to keep referring</div><div className="fill"><i style={{ width: `${POPUP.claimCta ? (POPUP.keepReferring / POPUP.claimCta) * 100 : 0}%` }} /></div><div className="n">{POPUP.keepReferring}</div></div>
          </div>
          <div>{(N.popup || []).map((t, i) => <p key={i} className="note" style={{ marginBottom: 10 }}>{t}</p>)}</div>
        </div>
      </section>
    </>
  );
}

function Gold({ T }) {
  if (!GOLD) return <section className="first"><p className="note">Gold coin data has not been collected yet. It appears after the next refresh.</p></section>;
  const f = GOLD.funnel, p = GOLD.pinned;
  const steps = [
    { lab: "Saw the campaign widget", sub: `unique users, ${GOLD.window}`, v: GOLD.widgetUsers },
    { lab: "Referred someone", sub: `${f.firstEverReferrers} for the first time ever`, v: f.referrers },
    { lab: "Referee signups", sub: `${(f.signups / Math.max(1, f.referrers)).toFixed(2)} per referrer`, v: f.signups, noShare: true },
    { lab: "Referees onboarded", sub: "completed onboarding", v: f.onboarded },
    { lab: "Referees activated", sub: "first settled payment", v: f.achieved },
    { lab: "Gold coins claimed", sub: "auto-claimed on activation", v: f.claimed },
  ];
  const ramp = T.ramp;
  const weeks = GOLD.weekly.map((w) => ({ ...w, label: w.week + (w.partial ? "*" : ""), rate: w.shareRate }));
  const pre = GOLD.weekly.filter((w) => !w.post), post = GOLD.weekly.filter((w) => w.post && !w.partial);
  const avg = (rows, k) => (rows.length ? rows.reduce((a, r) => a + (r[k] || 0), 0) / rows.length : null);
  const d2f = (() => {
    const buckets = [["0-1", 0, 1], ["2-3", 2, 3], ["4-5", 4, 5], ["6-7", 6, 7], ["8-10", 8, 10], ["11+", 11, 1e9]];
    return buckets.map(([lab, lo, hi]) => ({ bucket: lab, n: GOLD.daysToFirst.filter((x) => x.days >= lo && x.days <= hi).reduce((a, x) => a + x.n, 0) }));
  })();
  const daily = GOLD.daily.map((x) => ({ ...x, label: x.day + (x.partial ? "*" : "") }));
  return (
    <>
      <div className="pagehead">
        <div>
          <h2 style={{ fontSize: 18 }}>{GOLD.label}</h2>
          <p className="sub">{fmt(p.n)} activated users who had never referred were pinned to campaign {GOLD.campaignId} on {p.date} as a pilot.{GOLD.openToAllLabel ? ` Since ${GOLD.openToAllLabel} the coin is the offer for everyone (referrers still inside an Alexa window that month see the $30 default instead).` : ""} The first referee who completes a payment earns the referrer a {GOLD.reward}. One coin per referrer.</p>
        </div>
        <div className="count"><b>Day {GOLD.dayN}</b><span className="sub">since {GOLD.startLabel}</span></div>
      </div>

      <section className="first">
        <div className="stats">
          <Stat T={T} label="Pinned in the pilot" value={fmtc(p.n)} sub={`never-referrers, pinned ${p.date}${GOLD.openToAllLabel ? `; everyone since ${GOLD.openToAllLabel}` : ""}`} />
          <Stat T={T} label="Saw the gold coin widget" value={fmtc(GOLD.widgetUsers)} sub={GOLD.widgetUsers != null ? `unique users, ${GOLD.window}` : "Mixpanel unavailable"} />
          <Stat T={T} label="Referred under the coin" value={fmt(f.referrers)} hero sub={`${f.firstEverReferrers} had never referred before, ${f.signups} signups between them`} />
          <Stat T={T} label="Referees onboarded" value={fmt(f.onboarded)} sub={`${pct(f.onboarded, f.signups, 0)} of signups`} />
          <Stat T={T} label="Referees activated" value={fmt(f.achieved)} sub={`${pct(f.achieved, f.onboarded, 0)} of onboarded`} />
          <Stat T={T} label="Gold coins claimed" value={fmt(f.claimed)} sub="auto-claimed, no popup" />
        </div>
      </section>

      <section>
        <div className="grid32">
          <div>
            <div className="sechead"><h2>From offer to coin</h2><span className="note">Each bar is a share of the step above it.</span></div>
            <div className="funnel">
              {steps.map((s, i) => {
                const prev = i ? steps[i - 1].v : null;
                const share = s.v == null ? null : s.noShare ? 100 : prev ? Math.min(100, (100 * s.v) / prev) : 100;
                return (
                  <div className="step" key={s.lab}>
                    <div className="lab">{s.lab}<small>{s.sub}</small></div>
                    <div className="fill" title={share != null ? `${share.toFixed(1)}% of the step above` : ""}><i style={{ width: `${share == null ? 0 : Math.max(share, s.v ? 1.5 : 0)}%`, background: ramp[Math.min(i, ramp.length - 1)] }} /></div>
                    <div className="v">{s.v == null ? "n/a" : fmt(s.v)}<small>{i && share != null && !s.noShare ? `${share < 1 ? share.toFixed(2) : share.toFixed(1)}% of previous` : ""}</small></div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="sechead"><h2>Did the offer move the pinned never-referrers?</h2><span className="note">Weekly referrers from the pinned pilot group only, as a share of those who transacted that week. The line marks the pin.</span></div>
            <div className="chart" style={{ height: 190 }}>
              <ResponsiveContainer>
                <ComposedChart data={weeks} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={T.grid} />
                  <XAxis dataKey="label" {...axis(T)} interval={1} />
                  <YAxis {...axis(T)} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<Tip fmtv={(v, k) => (k === "rate" ? `${v}%` : fmt(v))} />} cursor={{ stroke: T.axis }} />
                  <ReferenceLine x={GOLD.startLabel} stroke={T.muted} label={{ value: "pinned", position: "insideTopLeft", fontSize: 11, fill: T.muted }} />
                  <Line isAnimationActive={false} dataKey="rate" name="Share rate" stroke={T.s1} strokeWidth={2} dot={{ r: 3.5, fill: T.s1, stroke: T.surface, strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
              <Stat T={T} label="Before the pin, weekly average" value={avg(pre, "shareRate") != null ? `${avg(pre, "shareRate").toFixed(2)}%` : "n/a"} sub={`${avg(pre, "referrers") != null ? avg(pre, "referrers").toFixed(1) : "n/a"} referrers a week over ${pre.length} weeks`} />
              <Stat T={T} label="Since the pin, full weeks" value={avg(post, "shareRate") != null ? `${avg(post, "shareRate").toFixed(2)}%` : "n/a"} sub={post.length ? `${avg(post, "referrers").toFixed(1)} referrers a week over ${post.length} week${post.length === 1 ? "" : "s"}` : "no full week yet"} delta={avg(pre, "shareRate") && avg(post, "shareRate") != null ? (100 * (avg(post, "shareRate") - avg(pre, "shareRate"))) / avg(pre, "shareRate") : undefined} />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="grid2">
          <div>
            <div className="sechead"><h2>Daily referee signups and onboardings</h2><span className="note">Every referral tagged to the coin. * today so far.</span></div>
            <div className="chart" style={{ height: 220 }}>
              <ResponsiveContainer>
                <ComposedChart data={daily} margin={{ top: 10, right: 8, left: -18, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke={T.grid} />
                  <XAxis dataKey="label" {...axis(T)} interval="preserveStartEnd" minTickGap={14} />
                  <YAxis {...axis(T)} allowDecimals={false} />
                  <Tooltip content={<Tip />} cursor={{ fill: T.wash }} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12, color: T.ink2 }} />
                  {GOLD.openToAllLabel && <ReferenceLine x={GOLD.openToAllLabel} stroke={T.muted} strokeDasharray="3 3" label={{ value: "everyone", position: "insideTopLeft", fontSize: 11, fill: T.muted }} />}
                  <Bar isAnimationActive={false} dataKey="signups" name="Signups" fill={T.s1} radius={[4, 4, 0, 0]} maxBarSize={22}>
                    {daily.map((x) => <Cell key={x.date} fill={T.s1} opacity={x.partial ? 0.45 : 1} />)}
                  </Bar>
                  <Bar isAnimationActive={false} dataKey="onboarded" name="Onboarded" fill={T.s3} radius={[4, 4, 0, 0]} maxBarSize={22}>
                    {daily.map((x) => <Cell key={x.date} fill={T.s3} opacity={x.partial ? 0.45 : 1} />)}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="sechead"><h2>Days from the pin to the first referral</h2><span className="note">Pinned pilot group: how quickly the offer turned into action.</span></div>
            <div className="chart" style={{ height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={d2f} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={T.grid} />
                  <XAxis dataKey="bucket" {...axis(T)} />
                  <YAxis {...axis(T)} allowDecimals={false} />
                  <Tooltip content={<Tip />} cursor={{ fill: T.wash }} />
                  <Bar isAnimationActive={false} dataKey="n" name="Referrers" fill={T.s1} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="grid2">
          <div>
            <div className="sechead"><h2>Coins claimed</h2></div>
            {GOLD.claims.length ? (
              <div className="tablewrap short"><table>
                <thead><tr><th>Date</th><th>Referrer</th><th>Status</th><th>How</th></tr></thead>
                <tbody>{GOLD.claims.map((c) => <tr key={c.id}><td>{c.date}</td><td>Exporter {c.id}</td><td>{c.status === "CLAIMED" ? "Claimed" : c.status}</td><td>{c.source === "AUTO" ? "Automatic on activation" : c.source}</td></tr>)}</tbody>
              </table></div>
            ) : <p className="note">No coins claimed yet.</p>}
          </div>
          <div>
            <div className="sechead"><h2>Week by week</h2><span className="note">* partial week.</span></div>
            <div className="tablewrap short"><table>
              <thead><tr><th>Week of</th><th className="num">Referrers</th><th className="num">Signups</th><th className="num">Onboarded</th><th className="num">Activated</th><th className="num">Transacted</th><th className="num">Share rate</th></tr></thead>
              <tbody>{weeks.map((w) => <tr key={w.ws} className={w.post ? "hl" : ""}><td>{w.label}</td><td className="num">{w.referrers}</td><td className="num">{w.signups}</td><td className="num">{w.onboarded}</td><td className="num">{w.achieved}</td><td className="num">{fmt(w.transactors)}</td><td className="num">{w.shareRate != null ? `${w.shareRate}%` : "n/a"}</td></tr>)}</tbody>
            </table></div>
          </div>
        </div>
        <Notes items={N.gold} title="Reading the gold coin numbers" />
      </section>
    </>
  );
}

function Referrers() {
  return (
    <section className="first">
      <div className="pagehead" style={{ marginTop: 0 }}>
        <div><h2 style={{ fontSize: 18 }}>Every milestone campaign referrer</h2><p className="sub">Campaign 26 only. Onboarded and activated dates are the referrer's own. Cohort is based on referral history before 1 Sep.</p></div>
      </div>
      <ReferrerTable />
      <Notes items={N.referrers} title="What the table says" />
    </section>
  );
}

function Quality() {
  const prev = LBL.prev, now = LBL.now;
  return (
    <section className="first">
      <div className="pagehead" style={{ marginTop: 0 }}>
        <div><h2 style={{ fontSize: 18 }}>Are campaign referees different from the referees we usually get?</h2><p className="sub">{N.qualityHeader}</p></div>
      </div>
      <h3>Funnel by source</h3>
      <div className="tablewrap short"><table style={{ marginBottom: 6 }}>
        <thead><tr><th>Referees from</th><th className="num">Signups</th><th className="num">Onboarded in 1 day</th><th className="num">In 7 days</th><th className="num">Onboarded 10+ days ago</th><th className="num">Active within 10 days</th><th className="num">Median first settlement</th></tr></thead>
        <tbody>{Q_FUNNEL.map((r) => (
          <tr key={r.src}><td>{r.src}</td><td className="num">{fmt(r.n)}</td><td className="num">{r.ob1d}%</td><td className="num">{r.ob7d}%</td><td className="num">{r.matureN}</td><td className="num">{r.act10 == null ? "n/a" : `${r.act10}%`}</td><td className="num">{r.medianFirstInr ? `$${fmt(Math.round(r.medianFirstInr / FX))}` : "n/a"}</td></tr>))}
        </tbody></table></div>
      <p className="note">{N.qualityWindow}</p>
      <div className="grid2" style={{ marginTop: 22 }}>
        <div>
          <h3>Business type of onboarded referees</h3>
          <div className="tablewrap short"><table>
            <thead><tr><th>Type</th><th className="num">{prev}</th><th className="num">Share</th><th className="num">{now}</th><th className="num">Share</th><th className="num">Active 10d, {prev}</th><th className="num">{now}</th></tr></thead>
            <tbody>{Q_BT.map((r) => (
              <tr key={r.bt}><td>{r.bt}</td><td className="num">{fmt(r.preN)}</td><td className="num">{r.preShare == null ? "n/a" : `${r.preShare}%`}</td><td className="num">{fmt(r.cN)}</td><td className="num">{r.cShare == null ? "n/a" : `${r.cShare}%`}</td><td className="num">{r.preAct == null ? "n/a" : `${r.preAct}%`}</td><td className="num">{r.cAct === null || r.cAct === undefined ? <span className="muted">n/a</span> : `${r.cAct}%`}</td></tr>))}
            </tbody></table></div>
        </div>
        <div>
          <h3>Stated monthly volume of onboarded referees</h3>
          <div className="tablewrap short"><table>
            <thead><tr><th>Stated at signup</th><th className="num">{prev}</th><th className="num">Share</th><th className="num">{now}</th><th className="num">Share</th><th className="num">Active 10d, {prev}</th><th className="num">{now}</th></tr></thead>
            <tbody>{Q_VOL.map((r) => (
              <tr key={r.vol}><td>{r.vol}</td><td className="num">{fmt(r.preN)}</td><td className="num">{r.preShare == null ? "n/a" : `${r.preShare}%`}</td><td className="num">{fmt(r.cN)}</td><td className="num">{r.cShare == null ? "n/a" : `${r.cShare}%`}</td><td className="num">{r.preAct == null ? "n/a" : `${r.preAct}%`}</td><td className="num">{r.cAct === null || r.cAct === undefined ? <span className="muted">n/a</span> : `${r.cAct}%`}</td></tr>))}
            </tbody></table></div>
        </div>
      </div>
      <Notes items={N.refereeQuality} title="Early read on quality" />
    </section>
  );
}

function Campaigns({ T }) {
  const rows = CAMPAIGNS.filter((c) => c.signups > 0 || c.live);
  const chartRows = rows.filter((c) => c.id !== 16).map((c) => ({ ...c, name: c.label.replace("Group A: ", "").replace(" (Moonshot)", "") }));
  return (
    <>
      <div className="pagehead">
        <div><h2 style={{ fontSize: 18 }}>Every gift campaign since 2025</h2><p className="sub">Signups tagged to each campaign at the referee's signup, internal and flagged ids excluded. Referees keep earning the gift of the campaign they were tagged under, so ended campaigns still gain activations. Group A campaigns were offered only to never-referrers.</p></div>
      </div>
      <section className="first">
        <div className="tablewrap short">
          <table>
            <thead><tr><th>Campaign</th><th>Gift</th><th>From</th><th>To</th><th className="num">Days</th><th className="num">Signups</th><th className="num">Per day</th><th className="num">Referrers</th><th className="num">Onboarded</th><th className="num">OB %</th><th className="num">Activated</th><th className="num">Act %</th><th className="num">Gifts claimed</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.live ? "hl" : ""}>
                  <td>{c.label} {c.live && <span className="pill live">live</span>}</td><td>{c.gift}</td><td>{c.startLabel}</td><td>{c.endLabel}</td>
                  <td className="num">{c.days}</td><td className="num">{fmt(c.signups)}</td><td className="num">{c.perDay.toFixed(1)}</td><td className="num">{fmt(c.referrers)}</td>
                  <td className="num">{fmt(c.onboarded)}</td><td className="num">{c.obRate == null ? "n/a" : `${c.obRate}%`}</td><td className="num">{fmt(c.achieved)}</td><td className="num">{c.actRate == null ? "n/a" : `${c.actRate}%`}</td>
                  <td className="num">{c.id === 16 ? "cash" : fmt(c.claimed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <div className="grid2">
          <div>
            <div className="sechead"><h2>Signups per day while live</h2><span className="note">Live campaigns in blue. The default program is left out: it runs all the time.</span></div>
            <div className="chart" style={{ height: 34 * chartRows.length + 30 }}>
              <ResponsiveContainer>
                <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 40, left: 10, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={T.grid} />
                  <XAxis type="number" {...axis(T)} />
                  <YAxis type="category" dataKey="name" {...axis(T)} width={150} />
                  <Tooltip content={<Tip fmtv={(v) => v.toFixed(1)} />} cursor={{ fill: T.wash }} />
                  <Bar isAnimationActive={false} dataKey="perDay" name="Signups per day" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fontSize: 11.5, fill: T.ink2, formatter: (v) => v.toFixed(1) }}>
                    {chartRows.map((c) => <Cell key={c.id} fill={c.live ? T.s1 : T.dim} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="sechead"><h2>Activation rate of onboarded referees</h2><span className="note">Older campaigns have had longer to mature.</span></div>
            <div className="chart" style={{ height: 34 * chartRows.length + 30 }}>
              <ResponsiveContainer>
                <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 40, left: 10, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={T.grid} />
                  <XAxis type="number" {...axis(T)} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" {...axis(T)} width={150} />
                  <Tooltip content={<Tip fmtv={(v) => `${v}%`} />} cursor={{ fill: T.wash }} />
                  <Bar isAnimationActive={false} dataKey="actRate" name="Activated of onboarded" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fontSize: 11.5, fill: T.ink2, formatter: (v) => `${v}%` }}>
                    {chartRows.map((c) => <Cell key={c.id} fill={c.live ? T.s3 : T.dim} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <Notes items={N.campaigns} title="How the campaigns compare" />
      </section>
    </>
  );
}

// ============================================================================
// MONTH PROJECTION
// ============================================================================


function MonthProjection({ T }) {
  if (!MONTH) return <section className="first"><p className="note">Month projection data has not been collected yet. It appears after the next refresh.</p></section>;
  const M = MONTH, P = M.proj, pipe = M.pipeline || {};
  const metrics = [["signups", "Signups"], ["onboardings", "Onboardings"], ["activations", "Activations"], ["coins", "Gold coins"], ["firstTimers", "First-timers"]];
  const [metric, setMetric] = useState("signups");
  const pm = P[metric];
  const prevNames = M.prev.map((m) => m.month);
  const dimColors = [T.dim, T.axis, T.muted];
  const chartRows = useMemo(() => {
    const rows = [];
    const lastFull = M.fullDays;
    const curCum = pm.cum;
    for (let dom = 1; dom <= M.daysInMonth; dom++) {
      const r = { dom };
      if (dom <= lastFull) r.cur = curCum[dom - 1];
      if (dom === M.daysInMonth && pm.projected != null && lastFull > 0) r.proj = pm.projected;
      if (dom === lastFull && lastFull > 0) r.proj = curCum[dom - 1];
      if (dom === lastFull + 1 && dom <= M.daysInMonth && M.daily[dom - 1]) r.today = (curCum[lastFull - 1] || 0) + M.daily[dom - 1][metric];
      M.prev.forEach((m) => { if (dom <= m.days) r[m.month] = m.cum[metric][dom - 1]; });
      rows.push(r);
    }
    return rows;
  }, [metric]);
  const rangeTxt = (p) => (p.dayShare ? `range ${fmt(p.dayShare.low)} to ${fmt(p.dayShare.high)}` : p.avg7 != null ? `last seven days at ${p.avg7} a day` : "no projection yet");
  const projTxt = (p) => (p.projected == null ? "no projection yet" : `projecting about ${fmt(p.projected)}, ${rangeTxt(p)}`);
  const prevTxt = (k) => M.prev.map((m) => `${m.month} ${fmt(m.full[k])}`).join(", ");
  const sameDays = (k) => M.prev[M.prev.length - 1] ? `${fmt(M.prev[M.prev.length - 1].firstN[k])} by the same day in ${M.prev[M.prev.length - 1].month}` : "";
  const delta = (k) => { const last = M.prev[M.prev.length - 1]; return last && last.firstN[k] ? (100 * (P[k].toDate - last.firstN[k])) / last.firstN[k] : null; };
  const daily = M.daily.map((x) => ({ ...x, label: x.day + (x.partial ? "*" : "") }));
  const cost = (n) => (M.unitCostInr && n != null ? ` (about ${fmtc(Math.round((n * M.unitCostInr) / 1000))}K rupees at ${fmt(M.unitCostInr)} a coin)` : "");
  const groups = M.groups || [], gTot = { referrers: sumBy(groups, "referrers"), signups: sumBy(groups, "signups"), onboarded: sumBy(groups, "onboarded"), achieved: sumBy(groups, "achieved"), coins: sumBy(groups, "coins") };
  const tags = M.tags || [], tTot = sumBy(tags, "signups");
  const tagNote = (t) => (t.id === 29 ? "The live offer" : t.id === 16 ? "Referrers still inside an Alexa window this month see the $30 default instead" : t.id === 26 ? "Leftover tags from the ladder" : "");
  return (
    <>
      <div className="pagehead">
        <div>
          <h2 style={{ fontSize: 18 }}>{M.monthName}: where the month lands</h2>
          <p className="sub">{M.openToAllLabel ? `The gold coin has been the offer for everyone since ${M.openToAllLabel}. ` : ""}{M.fullDays} full day{M.fullDays === 1 ? "" : "s"} in, {M.daysLeft} to go including today. Projections scale the days so far by how much of each of the last three months had landed by the same day; where those months have nothing to compare with, the last seven days are run forward instead. Early in the month every number here is a guess.</p>
        </div>
        <div className="count"><b>Day {M.fullDays + 1}</b><span className="sub">of {M.daysInMonth}</span></div>
      </div>

      <section className="first">
        <div className="stats">
          <Stat T={T} label={`${M.monthShort} referral signups so far`} value={fmt(P.signups.toDate + P.signups.todaySoFar)} hero sub={`${projTxt(P.signups)}. ${sameDays("signups")}`} delta={delta("signups")} />
          <Stat T={T} label="Referral onboardings" value={fmt(P.onboardings.toDate + P.onboardings.todaySoFar)} sub={`${projTxt(P.onboardings)}${M.target ? `, target ${fmt(M.target)}` : ""}. ${sameDays("onboardings")}`} delta={delta("onboardings")} />
          <Stat T={T} label="Referral activations" value={fmt(P.activations.toDate + P.activations.todaySoFar)} sub={`${projTxt(P.activations)}. ${sameDays("activations")}`} delta={delta("activations")} />
          <Stat T={T} label={`Gold coins claimed in ${M.monthShort}`} value={fmt(P.coins.toDate + P.coins.todaySoFar)} sub={`${projTxt(P.coins)}${cost(P.coins.projected)}. ${fmt(pipe.coinsTotal)} since the campaign began`} />
          <Stat T={T} label="First-time referrers" value={fmt(P.firstTimers.toDate + P.firstTimers.todaySoFar)} sub={`${projTxt(P.firstTimers)}. ${sameDays("firstTimers")}`} delta={delta("firstTimers")} />
          <Stat T={T} label="Coins the pipeline could still pay" value={fmt(pipe.eventualCoins)} sub={pipe.eventualCoins != null ? `eventual total if ${Math.round(100 * pipe.baseline)}% of referees go on to pay, as past cohorts did${cost(pipe.eventualCoins)}` : "n/a"} />
        </div>
      </section>

      <section>
        <div className="sechead">
          <h2>Running total against the last three months</h2>
          <span className="note">Solid line: this month. Dashed: the straight path to the projection. Grey: {prevNames.join(", ")} on the same day of their month.</span>
        </div>
        <div className="tabs" role="tablist" style={{ marginTop: 4 }}>
          {metrics.map(([k, l]) => <button key={k} role="tab" aria-selected={metric === k} className={metric === k ? "on" : ""} onClick={() => setMetric(k)}>{l}</button>)}
        </div>
        <div className="chart" style={{ height: 280 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartRows} margin={{ top: 12, right: 16, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={T.grid} />
              <XAxis dataKey="dom" {...axis(T)} interval={1} tickFormatter={(v) => (v % 5 === 0 || v === 1 ? `${v} ${M.monthShort}` : "")} />
              <YAxis {...axis(T)} tickFormatter={fmtc} allowDecimals={false} />
              <Tooltip content={<Tip />} cursor={{ stroke: T.axis }} labelFormatter={(v) => `Day ${v}`} />
              <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12, color: T.ink2 }} />
              {M.prev.map((m, i) => <Line key={m.month} isAnimationActive={false} dataKey={m.month} name={m.month} stroke={dimColors[i]} strokeWidth={1.5} dot={false} connectNulls />)}
              <Line isAnimationActive={false} dataKey="proj" name={`Projected ${M.monthShort}`} stroke={T.s1} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3.5, fill: T.surface, stroke: T.s1, strokeWidth: 2 }} connectNulls />
              <Line isAnimationActive={false} dataKey="cur" name={`${M.monthShort} so far`} stroke={T.s1} strokeWidth={2.5} dot={{ r: 3, fill: T.s1, stroke: T.surface, strokeWidth: 2 }} activeDot={{ r: 5 }} />
              <Line isAnimationActive={false} dataKey="today" name="Today so far" stroke={T.s1} strokeWidth={0} dot={{ r: 3.5, fill: T.surface, stroke: T.s1, strokeWidth: 1.5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="tablewrap short" style={{ marginTop: 14 }}>
          <table style={{ minWidth: 980 }} className="projtable">
            <thead><tr><th>Metric</th><th className="num">To date</th><th className="num">Today</th><th className="num">Per day, last 7</th><th className="num">Straight line</th><th className="num">By day-share (range)</th><th className="num">Projected</th>{M.prev.map((m) => <th key={m.month} className="num">{m.month} by day {M.fullDays}</th>)}{M.prev.map((m) => <th key={m.month + "f"} className="num">{m.month} full</th>)}</tr></thead>
            <tbody>
              {metrics.map(([k]) => { const p = P[k]; return (
                <tr key={k} className={k === metric ? "hl" : ""}>
                  <td>{p.label}</td><td className="num">{fmt(p.toDate)}</td><td className="num">{fmt(p.todaySoFar)}</td><td className="num">{p.avg7 == null ? "n/a" : p.avg7.toFixed(1)}</td>
                  <td className="num">{fmt(p.straight)}</td><td className="num">{p.dayShare ? `${fmt(p.dayShare.mid)} (${fmt(p.dayShare.low)} to ${fmt(p.dayShare.high)})` : "n/a"}</td>
                  <td className="num"><b>{fmt(p.projected)}</b></td>
                  {M.prev.map((m) => <td key={m.month} className="num">{fmt(m.firstN[k])}</td>)}
                  {M.prev.map((m) => <td key={m.month + "f"} className="num">{fmt(m.full[k])}</td>)}
                </tr>); })}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 8 }}>Straight line: the average full day so far, times {M.daysInMonth} days. By day-share: {M.monthShort} to date divided by the share of each previous month that had landed by day {M.fullDays}; the range is the most and least front-loaded of those months. Projected uses day-share when the previous months have the metric, else the last seven days run forward. Onboardings and activations count each referee once, on their first referrer; gold coins are claims, one per referrer.</p>
      </section>

      <section>
        <div className="grid2">
          <div>
            <div className="sechead"><h2>Who is referring this month</h2><span className="note">Pinned: the never-referrers offered the coin in the October pilot. Everyone else sees the coin since {M.openToAllLabel || "the campaign opened"}.</span></div>
            <div className="tablewrap short"><table>
              <thead><tr><th>Group</th><th className="num">Referrers</th><th className="num">Signups</th><th className="num">Onboarded</th><th className="num">Activated</th><th className="num">Coins</th></tr></thead>
              <tbody>
                {groups.map((g) => <tr key={g.key}><td>{g.label}</td><td className="num">{fmt(g.referrers)}</td><td className="num">{fmt(g.signups)}</td><td className="num">{fmt(g.onboarded)}</td><td className="num">{fmt(g.achieved)}</td><td className="num">{fmt(g.coins)}</td></tr>)}
                <tr className="hl"><td><b>All referrers this month</b></td><td className="num"><b>{fmt(gTot.referrers)}</b></td><td className="num"><b>{fmt(gTot.signups)}</b></td><td className="num"><b>{fmt(gTot.onboarded)}</b></td><td className="num"><b>{fmt(gTot.achieved)}</b></td><td className="num"><b>{fmt(gTot.coins)}</b></td></tr>
              </tbody>
            </table></div>
          </div>
          <div>
            <div className="sechead"><h2>Which offer tagged the signups</h2><span className="note">The campaign stamped on each referral at signup decides the referrer's reward.</span></div>
            <div className="tablewrap short"><table>
              <thead><tr><th>Campaign</th><th className="num">Signups</th><th className="num">Share</th><th className="num">Referrers</th></tr></thead>
              <tbody>{tags.map((t) => <tr key={t.id}><td>{t.label}<small style={{ display: "block", color: "var(--muted)", fontSize: 11.5 }}>{tagNote(t)}</small></td><td className="num">{fmt(t.signups)}</td><td className="num">{pct(t.signups, tTot, 0)}</td><td className="num">{fmt(t.referrers)}</td></tr>)}</tbody>
            </table></div>
          </div>
        </div>
      </section>

      <section>
        <div className="grid2">
          <div>
            <div className="sechead"><h2>Day by day this month</h2><span className="note">* today so far. Activations and coins can come from referrals made in earlier months.</span></div>
            <div className="chart" style={{ height: 230 }}>
              <ResponsiveContainer>
                <ComposedChart data={daily} margin={{ top: 10, right: 8, left: -18, bottom: 0 }} barGap={1}>
                  <CartesianGrid vertical={false} stroke={T.grid} />
                  <XAxis dataKey="label" {...axis(T)} interval="preserveStartEnd" minTickGap={14} />
                  <YAxis {...axis(T)} allowDecimals={false} />
                  <Tooltip content={<Tip />} cursor={{ fill: T.wash }} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12, color: T.ink2 }} />
                  <Bar isAnimationActive={false} dataKey="signups" name="Signups" fill={T.s1} radius={[3, 3, 0, 0]} maxBarSize={16}>{daily.map((x) => <Cell key={x.date} fill={T.s1} opacity={x.partial ? 0.45 : 1} />)}</Bar>
                  <Bar isAnimationActive={false} dataKey="onboardings" name="Onboardings" fill={T.s3} radius={[3, 3, 0, 0]} maxBarSize={16}>{daily.map((x) => <Cell key={x.date} fill={T.s3} opacity={x.partial ? 0.45 : 1} />)}</Bar>
                  <Bar isAnimationActive={false} dataKey="activations" name="Activations" fill={T.s2} radius={[3, 3, 0, 0]} maxBarSize={16}>{daily.map((x) => <Cell key={x.date} fill={T.s2} opacity={x.partial ? 0.45 : 1} />)}</Bar>
                  <Bar isAnimationActive={false} dataKey="coins" name="Gold coins" fill={T.s4} radius={[3, 3, 0, 0]} maxBarSize={16}>{daily.map((x) => <Cell key={x.date} fill={T.s4} opacity={x.partial ? 0.45 : 1} />)}</Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="sechead"><h2>The coin pipeline</h2><span className="note">Every gold coin referrer so far, whichever month they referred in.</span></div>
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Stat T={T} label="Coins claimed so far" value={fmt(pipe.coinsTotal)} sub={`${fmt(P.coins.toDate + P.coins.todaySoFar)} of them in ${M.monthShort}${cost(pipe.coinsTotal)}`} />
              <Stat T={T} label="Referrers with a referee waiting to pay" value={fmt(pipe.referrersWaiting)} sub={`${fmt(pipe.refereesWaiting)} onboarded referees not yet paid; each referrer here is one payment from a coin`} />
              <Stat T={T} label="Referrers with nobody onboarded yet" value={fmt(pipe.referrersNoOnboard)} sub={`${fmt(pipe.signupsNoOnboard)} signups still to finish onboarding`} />
              <Stat T={T} label="Eventual coins, estimate" value={fmt(pipe.eventualCoins)} sub={pipe.eventualCoins != null ? `${fmt(pipe.referrersNoCoin)} referrers without a coin, ${fmt(pipe.signupsNoCoin)} signups between them, at a ${Math.round(100 * pipe.baseline)}% chance each signup pays${cost(pipe.eventualCoins)}` : "n/a"} />
            </div>
          </div>
        </div>
        <Notes items={N.month} title={`Reading ${M.monthName}`} />
      </section>
    </>
  );
}

// ============================================================================
// APP
// ============================================================================

const TABS = [["overview", "Overview"], ["month", `${(D.MONTH || PACE).monthShort} projection`], ["gold", "Gold coin"], ["milestone", "Milestone campaign"], ["referrers", "Referrers"], ["quality", "Referee quality"], ["campaigns", "Campaigns"]];
const readHash = () => { const h = (window.location.hash || "").replace("#", ""); return TABS.some((t) => t[0] === h) ? h : "overview"; };

function Freshness() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);
  const ms = SNAPSHOT.asOfIso ? Date.parse(SNAPSHOT.asOfIso) : NaN;
  const age = isFinite(ms) ? (now - ms) / 60000 : null;
  const txt = age === null ? "" : age < 2 ? "just now" : age < 60 ? `${Math.round(age)} min ago` : age < 48 * 60 ? `${Math.round(age / 60)} h ago` : `${Math.round(age / 1440)} days ago`;
  const cls = age === null ? "" : age > 24 * 60 ? " old" : age > 3 * 60 ? " stale" : "";
  return <span className={`fresh${cls}`} title={`Data as of ${SNAPSHOT.asOf}`}><i />Updated {SNAPSHOT.asOf.replace(/^\d+ \w+ \d+, /, "")}{txt ? `, ${txt}` : ""}</span>;
}

export default function MilestoneDashboard() {
  const T = useTheme();
  const [pref, setPrefState] = useState(readPref);
  const [view, setView] = useState(readHash);
  useEffect(() => { const fn = () => setView(readHash()); window.addEventListener("hashchange", fn); return () => window.removeEventListener("hashchange", fn); }, []);
  const go = (v) => { setView(v); try { history.replaceState(null, "", "#" + v); } catch (e) { window.location.hash = v; } window.scrollTo({ top: 0, behavior: "smooth" }); };
  const cycle = () => { const next = pref === "auto" ? "dark" : pref === "dark" ? "light" : "auto"; setPref(next); setPrefState(next); };
  const counts = { month: MONTH ? `day ${MONTH.fullDays + 1}` : "", milestone: SNAPSHOT.campaignEnded ? "ended" : `day ${SNAPSHOT.campaignDay}`, gold: GOLD ? `day ${GOLD.dayN}` : "", referrers: fmt(REFERRERS.length), campaigns: fmt(CAMPAIGNS.length) };

  return (
    <div className="app">
      <style>{css}</style>
      <header className="top">
        <div className="topin">
          <div className="brand">
            <div className="l"><div className="logo" aria-hidden="true">Sk</div><div><h1>Skydo referrals</h1></div></div>
            <div className="r">
              <Freshness />
              <button className="btn" onClick={cycle} title="Switch between automatic, dark and light">{pref === "auto" ? "Theme: auto" : pref === "dark" ? "Theme: dark" : "Theme: light"}</button>
            </div>
          </div>
          <nav role="tablist" aria-label="Sections">
            {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => go(k)}>{label}{counts[k] ? <b>{counts[k]}</b> : null}</button>)}
          </nav>
        </div>
      </header>

      <div className="wrap">
        {view === "overview" && <Overview T={T} go={go} />}
        {view === "month" && <MonthProjection T={T} />}
        {view === "milestone" && <Milestone T={T} />}
        {view === "gold" && <Gold T={T} />}
        {view === "referrers" && <Referrers />}
        {view === "quality" && <Quality />}
        {view === "campaigns" && <Campaigns T={T} />}

        <footer>
          Refreshed every hour from Metabase and Mixpanel; the last refresh was {SNAPSHOT.asOf}. A referral counts as activated on the referee's first settled payment. Internal ids 2, 3, 4, 14, the affiliate referrer 38679 and any flagged referrers are excluded from campaign numbers. Monthly onboarding counts against target include every referral onboarding, flagged referrers included. Share rate is the share of exporters with a settled payment in the period who also referred in it.
        </footer>
      </div>
    </div>
  );
}
