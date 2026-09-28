/* TCG Refurb Shop — frontend.
   The vendored Preact + HTM runtime keeps the app self-contained with no build step.
   Shared state is persisted by /api/data; full-state snapshots power session undo/redo. */
import { html, render, useState, useEffect, useMemo, useRef } from "./vendor-preact-htm.js";
import { STRINGS, LANGS } from "./i18n.js?v=20260928";
import { compareUnits, updateQueueUnit } from "./starter-records.js?v=20260928";

/* ---------------- constants ---------------- */
const GENS = [3, 4, 5, 6];
const STATUS_KEYS = ["stDraft", "stReceived", "stAssessment", "stAwaiting", "stRefurb", "stQC", "stTesting", "stReady", "stShipped"];
const STATUS_EN = {
  stDraft: "Starter / to confirm",
  stReceived: "Shipping received",
  stAssessment: "Inspect & scope",
  stAwaiting: "Waiting on parts / prints",
  stRefurb: "Tear down / clean / upgrade",
  stQC: "Refurb pre-test",
  stTesting: "Regular testing",
  stReady: "Final shipping",
  stShipped: "Shipped",
};
const DEMAND_KEYS = ["stReceived", "stAssessment", "stAwaiting", "stRefurb"];
const STATUS_STYLE = {
  stDraft: ["#E8EBEF", "#4F5C6B"],
  stReceived: ["#EFE7D2", "#7A621B"],
  stAssessment: ["#DEE4EA", "#44515F"],
  stAwaiting: ["#FDE3D1", "#B04A0D"],
  stRefurb: ["#D9E6F2", "#2F5B84"],
  stQC: ["#E4DEF0", "#5A4B8A"],
  stTesting: ["#DCE8F4", "#234E74"],
  stReady: ["#DCEEDD", "#2F6B3A"],
  stShipped: ["#E8E8E8", "#6B6B6B"],
};
const GRADES = [
  { code: "NM", key: "gNM", bg: "#DCEEDD", tx: "#2F6B3A" },
  { code: "LP", key: "gLP", bg: "#E4EED2", tx: "#5A6B1F" },
  { code: "MP", key: "gMP", bg: "#F3E8C8", tx: "#8A6D1F" },
  { code: "HP", key: "gHP", bg: "#FBDCC6", tx: "#A34A10" },
  { code: "DMG", key: "gDMG", bg: "#F6D4D4", tx: "#96312F" },
];
const GRADE_EN = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged" };
const UNIT_TYPES = [
  { value: "full", key: "unitFull" },
  { value: "scanner", key: "unitScanner" },
  { value: "conveyor", key: "unitConveyor" },
  { value: "chassis", key: "unitChassis" },
];
const MODULE_TYPES = ["whole", "scanner", "conveyor", "chassis"];
const PART_CATEGORIES = [
  { value: "3DP", key: "cat3dp" },
  { value: "Hardware", key: "catHardware" },
  { value: "Assembly", key: "catAssembly" },
  { value: "Other", key: "catOther" },
];
const PRINT_STATUSES = ["submitted", "confirmed", "printing", "ready", "cancelled"];
const PRINT_STATUS_STYLE = {
  submitted: ["#FDE3D1", "#A64A13"],
  confirmed: ["#E4DEF0", "#5A4B8A"],
  printing: ["#D9E6F2", "#2F5B84"],
  ready: ["#DCEEDD", "#2F6B3A"],
  cancelled: ["#E8E8E8", "#6B6B6B"],
};
const WORKFLOW_STEPS = [
  { key: "refurbReceived", label: "wfReceived", status: "stAssessment" },
  { key: "modulesSeparated", label: "wfSeparated", status: "stAssessment", fullOnly: true },
  { key: "inspectionComplete", label: "wfInspected", status: "stAssessment" },
  { key: "scopeComplete", label: "wfScope", status: "stAwaiting" },
  { key: "partsReady", label: "wfPartsReady", status: "stRefurb" },
  { key: "teardownComplete", label: "wfTeardown", status: "stRefurb" },
  { key: "cleaningComplete", label: "wfClean", status: "stRefurb" },
  { key: "upgradesComplete", label: "wfUpgraded", status: "stQC" },
  { key: "pretestPassed", label: "wfPretest", status: "stTesting" },
  { key: "testingHandoff", label: "wfHandoff", status: "stTesting" },
];

const gradeOf = (code) => GRADES.find((grade) => grade.code === code) || { code: "", key: "notSet", bg: "#E8EBEF", tx: "#4F5C6B" };
const generationLabel = (gen, fallback = "") => GENS.includes(Number(gen)) ? `PR${gen}` : fallback;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const asQty = (value, fallback = 1) => Math.max(1, Math.round(Number(value) || fallback));
const moduleTypesFor = (unitType) => unitType === "full" ? ["scanner", "conveyor", "chassis"] : [unitType];
const unitKey = (unitType) => UNIT_TYPES.find((unit) => unit.value === unitType)?.key || "unitFull";
const moduleKey = (module) => ({ whole: "moduleWhole", scanner: "moduleScanner", conveyor: "moduleConveyor", chassis: "moduleChassis" }[module] || "moduleWhole");
const categoryKey = (category) => PART_CATEGORIES.find((item) => item.value === category)?.key || "catOther";
const printStatusKey = (status) => ({ submitted: "prSubmitted", confirmed: "prConfirmed", printing: "prPrinting", ready: "prReady", cancelled: "prCancelled" }[status] || "prSubmitted");

/* ---------------- tiny CSV in/out (RFC-4180) ---------------- */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) => Object.fromEntries(header.map((name, index) => [name, (values[index] ?? "").trim()])));
}
const csvCell = (value) => {
  const string = String(value ?? "");
  return /[",\n\r]/.test(string) ? '"' + string.replace(/"/g, '""') + '"' : string;
};
const toCSV = (rows) => rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
function downloadCSV(filename, rows) {
  const blob = new Blob(["\uFEFF" + toCSV(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ---------------- helpers ---------------- */
function inferGens(text) {
  const source = text || "";
  const range = source.match(/PR\s*(\d)\s*(?:[-–—]|to)\s*(?:PR\s*)?(\d)/i);
  if (range) {
    let a = +range[1], b = +range[2];
    if (a > b) [a, b] = [b, a];
    return GENS.filter((generation) => generation >= a && generation <= b);
  }
  const singles = [...source.matchAll(/PR\s*(\d)/gi)].map((match) => +match[1]);
  return GENS.filter((generation) => singles.includes(generation));
}

function makeModules(unitType) {
  return moduleTypesFor(unitType).map((type) => ({
    id: `module-${type}`,
    type,
    serial: "",
    inspected: false,
    condition: "pending",
    notes: "",
  }));
}

function currentPrintLines(mo) {
  return (mo.parts || [])
    .filter((line) => (line.source || "print") === "print")
    .map((line) => ({ pn: line.pn, qty: asQty(line.qty), module: line.module || "whole" }))
    .sort((a, b) => a.pn.localeCompare(b.pn) || a.module.localeCompare(b.module));
}

function lineSignature(lines) {
  return (lines || [])
    .map((line) => `${line.pn}|${asQty(line.qty)}|${line.module || "whole"}`)
    .sort()
    .join(";;");
}

function requestIsStale(mo) {
  return Boolean(mo.printRequest) && lineSignature(mo.printRequest.lines) !== lineSignature(currentPrintLines(mo));
}

function reservedForPart(state, pn) {
  return state.mos
    .filter((mo) => !mo.closed)
    .flatMap((mo) => mo.parts || [])
    .filter((line) => line.pn === pn && line.source === "stock")
    .reduce((sum, line) => sum + Math.max(0, asQty(line.qty) - Math.max(0, Number(line.issuedQty) || 0)), 0);
}

function availableForPart(state, part) {
  return (Number(part?.onHand) || 0) - reservedForPart(state, part?.pn);
}

function isLowStock(state, part) {
  const available = availableForPart(state, part);
  const minimum = Math.max(0, Number(part?.minStock) || 0);
  return available < 0 || (minimum > 0 && available <= minimum);
}

function requestTotals(request, state) {
  const lines = request?.lines || [];
  return lines.reduce((totals, line) => {
    const part = state.parts.find((item) => item.pn === line.pn);
    const quantity = asQty(line.qty);
    totals.pieces += quantity;
    if (part?.wt !== null && part?.wt !== undefined && Number.isFinite(Number(part.wt))) totals.grams += Number(part.wt) * quantity;
    else totals.missingWeight++;
    return totals;
  }, { pieces: 0, grams: 0, missingWeight: 0 });
}

function printRequestRows(mo, state) {
  const request = mo.printRequest;
  const rows = [["Print Request", "Revision", "MO", "Serial / ID", "Generation", "Unit Type", "Status", "Part No.", "Description", "Module", "Quantity", "Weight Each g", "Total g"]];
  if (!request) return rows;
  request.lines.forEach((line, index) => {
    const part = state.parts.find((item) => item.pn === line.pn);
    const each = part?.wt ?? "";
    const total = each === "" ? "" : Math.round(Number(each) * asQty(line.qty) * 100) / 100;
    rows.push([
      index === 0 ? request.number : "",
      index === 0 ? request.revision : "",
      index === 0 ? mo.number : "",
      index === 0 ? mo.serial : "",
      index === 0 ? generationLabel(mo.gen) : "",
      index === 0 ? mo.unitType : "",
      index === 0 ? request.status : "",
      line.pn,
      part?.desc || "",
      line.module || "whole",
      asQty(line.qty),
      each,
      total,
    ]);
  });
  if (!request.lines.length) rows.push([request.number, request.revision, mo.number, mo.serial, generationLabel(mo.gen), mo.unitType, request.status, "", "", "", "", "", ""]);
  return rows;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function openPrintRequest(mo, state, t) {
  if (!mo.printRequest) return false;
  const request = mo.printRequest;
  const totals = requestTotals(request, state);
  const logo = new URL("logo.png", window.location.href).href;
  const lines = request.lines.map((line) => {
    const part = state.parts.find((item) => item.pn === line.pn);
    const total = part?.wt == null ? "—" : `${Math.round(Number(part.wt) * asQty(line.qty))} g`;
    return `<tr><td class="mono">${escapeHtml(line.pn)}</td><td>${escapeHtml(part?.desc || "")}</td><td>${escapeHtml(t(moduleKey(line.module)))}</td><td class="num">${asQty(line.qty)}</td><td class="num">${total}</td></tr>`;
  }).join("");
  const popup = window.open("", "_blank");
  if (!popup) return false;
  try { popup.opener = null; } catch { /* older browsers */ }
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(request.number)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#1c2127;margin:28px;font-size:12px}.head{display:flex;align-items:center;border-bottom:4px solid #e8590c;padding-bottom:14px;margin-bottom:18px}.head img{width:82px;height:82px;object-fit:contain;margin-right:16px}.head h1{margin:0;font-size:28px;text-transform:uppercase}.tag{color:#5a6472;margin-top:4px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}.box{border:1px solid #c9cdd2;border-radius:6px;padding:8px}.label{font-size:9px;text-transform:uppercase;color:#5a6472;font-weight:bold;letter-spacing:.06em}.value{font-size:13px;font-weight:bold;margin-top:3px}.mono{font-family:monospace}table{width:100%;border-collapse:collapse}th{background:#1c2127;color:white;text-align:left;padding:8px;text-transform:uppercase;font-size:10px}td{border-bottom:1px solid #dfe1e4;padding:8px}.num{text-align:right}.summary{display:flex;justify-content:flex-end;gap:24px;font-weight:bold;margin-top:12px}.notes{border:1px solid #c9cdd2;border-radius:6px;padding:10px;min-height:58px;margin-top:18px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-top:42px}.line{border-top:1px solid #1c2127;padding-top:5px;color:#5a6472}@media print{body{margin:12mm}.no-print{display:none}}
  </style></head><body>
    <div class="head"><img src="${escapeHtml(logo)}"><div><h1>${escapeHtml(t("printRequestTitle"))}</h1><div class="tag">TCG Machines · Refurb Shop</div></div></div>
    <div class="meta"><div class="box"><div class="label">${escapeHtml(t("requestNo"))}</div><div class="value mono">${escapeHtml(request.number)} · R${request.revision}</div></div><div class="box"><div class="label">MO</div><div class="value mono">${escapeHtml(mo.number)}</div></div><div class="box"><div class="label">${escapeHtml(t("serial"))}</div><div class="value mono">${escapeHtml(mo.serial)}</div></div><div class="box"><div class="label">${escapeHtml(t("generation"))}</div><div class="value">${generationLabel(mo.gen, "PR ?")} · ${escapeHtml(t(unitKey(mo.unitType)))}</div></div></div>
    <table><thead><tr><th>${escapeHtml(t("partNo"))}</th><th>${escapeHtml(t("descLbl"))}</th><th>${escapeHtml(t("module"))}</th><th style="text-align:right">${escapeHtml(t("moQty"))}</th><th style="text-align:right">${escapeHtml(t("colFilament"))}</th></tr></thead><tbody>${lines || `<tr><td colspan="5">${escapeHtml(t("requestNoLines"))}</td></tr>`}</tbody></table>
    <div class="summary"><span>${escapeHtml(t("totalPieces"))}: ${totals.pieces}</span><span>${escapeHtml(t("totalFilament"))}: ${Math.round(totals.grams)} g${totals.missingWeight ? "+" : ""}</span></div>
    <div class="notes"><div class="label">${escapeHtml(t("printingNotes"))}</div>${escapeHtml(request.notes || "")}</div>
    <div class="signatures"><div class="line">${escapeHtml(t("printingConfirmation"))} / ${escapeHtml(t("dateLbl"))}</div><div class="line">${escapeHtml(t("refurbReceipt"))} / ${escapeHtml(t("dateLbl"))}</div></div>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script>
  </body></html>`);
  popup.document.close();
  return true;
}

/* Odoo repair-order import rows (always English). */
function odooRows(mos, state) {
  const header = ["Repair Reference", "Product to Repair", "Lot/Serial Number", "Customer", "Internal Notes", "Parts/Product", "Parts/Description", "Parts/Quantity"];
  const rows = [header];
  for (const mo of mos) {
    const machine = state.machines.find((item) => item.id === mo.machineId) || { serial: mo.serial, gen: mo.gen, source: "", notes: "", grade: "", status: "" };
    const product = mo.unitType === "full" ? `PhyzBatch 9000 ${generationLabel(mo.gen, "PR ?")}` : `PhyzBatch 9000 ${mo.unitType} module ${generationLabel(mo.gen, "PR ?")}`;
    const notes = [
      `Unit: ${mo.unitType || "full"}`,
      machine.grade ? `Grade: ${machine.grade} (${GRADE_EN[machine.grade] || machine.grade})` : "",
      machine.status ? `Status: ${STATUS_EN[machine.status] || machine.status}` : "",
      machine.notes ? `Intake: ${machine.notes}` : "",
      mo.notes ? `MO: ${mo.notes}` : "",
    ].filter(Boolean).join(" | ");
    const base = [mo.number, product, mo.serial, machine.source || "", notes];
    if (!(mo.parts || []).length) rows.push([...base, "", "", ""]);
    else mo.parts.forEach((line, index) => {
      const part = state.parts.find((item) => item.pn === line.pn);
      rows.push(index === 0
        ? [...base, line.pn, part?.desc || "", line.qty]
        : ["", "", "", "", "", line.pn, part?.desc || "", line.qty]);
    });
  }
  return rows;
}

/* ---------------- shared UI ---------------- */
const GenBadge = ({ g, dim, small, onClick }) => html`
  <span class="genb g${g} ${dim ? "dim" : ""} ${small ? "sm" : ""} ${onClick ? "click" : ""}" onClick=${onClick}>${generationLabel(g, "PR ?")}</span>`;

const Panel = ({ title, open, setOpen, children, badge }) => html`
  <div class="panel">
    <button class="panel-head" onClick=${() => setOpen(!open)}><span>${title}${badge ? html`<span class="head-badge">${badge}</span>` : ""}</span><span class="panel-caret">${open ? "▴" : "▾"}</span></button>
    ${open && html`<div class="panel-body">${children}</div>`}
  </div>`;

const UnitBadge = ({ type, t }) => html`<span class="unit-badge unit-${type}">${t(unitKey(type))}</span>`;

function PasscodeScreen({ t, onUnlocked, lang, setLang }) {
  const [passcode, setPasscode] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (event) => {
    event?.preventDefault();
    if (passcode.length !== 6 || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode, remember }),
      });
      if (!response.ok) throw new Error("bad passcode");
      setPasscode("");
      onUnlocked();
    } catch {
      setError(t("passcodeWrong"));
      setPasscode("");
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally { setBusy(false); }
  };

  return html`<div class="login-page">
    <div class="login-lang langs">
      ${LANGS.map((item) => html`<button class="lang ${lang === item.code ? "on" : ""}" onClick=${() => setLang(item.code)}>${item.label}</button>`)}
    </div>
    <form class="login-card" onSubmit=${submit}>
      <img class="login-logo" src="logo.png" alt="TCG Machines Refurb Shop" />
      <div class="login-title">TCG Refurb Shop</div>
      <div class="login-tag">${t("authorizedAccess")}</div>
      <label class="login-label" for="passcode">${t("passcodeLabel")}</label>
      <input ref=${inputRef} id="passcode" class="passcode-input mono" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" value=${passcode} onInput=${(event) => setPasscode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" />
      <div class="passcode-dots" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((index) => html`<span class=${passcode.length > index ? "filled" : ""}></span>`)}</div>
      ${error && html`<div class="login-error">${error}</div>`}
      <label class="checkline login-remember"><input type="checkbox" checked=${remember} onChange=${(event) => setRemember(event.target.checked)} /> ${t("rememberDevice")}</label>
      <button class="btn primary login-button" type="submit" disabled=${passcode.length !== 6 || busy}>${busy ? t("unlocking") : t("unlockShop")}</button>
    </form>
  </div>`;
}

/* ==================================================== APP */
function App() {
  const [auth, setAuth] = useState("checking");
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("queue");
  const [lang, setLang] = useState(localStorage.getItem("tcg-lang") || "en");
  const [syncErr, setSyncErr] = useState("");
  const [notice, setNotice] = useState("");
  const [moPrefill, setMoPrefill] = useState("");
  const hist = useRef({ undo: [], redo: [] });
  const saveChain = useRef(Promise.resolve());
  const saveVersion = useRef(0);
  const [, bump] = useState(0);

  const strings = STRINGS[lang] || STRINGS.en;
  const t = (key, vars) => {
    let value = strings[key] ?? STRINGS.en[key] ?? key;
    if (vars) for (const [name, replacement] of Object.entries(vars)) value = value.split("{" + name + "}").join(replacement);
    return value;
  };

  useEffect(() => {
    document.documentElement.dataset.lang = lang;
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : lang === "yue" ? "zh-Hant-HK" : "en";
    localStorage.setItem("tcg-lang", lang);
  }, [lang]);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { authenticated: false })
      .then((result) => setAuth(result.authenticated ? true : false))
      .catch(() => setAuth(false));
  }, []);

  const load = async () => {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (response.status === 401) { setAuth(false); setState(null); return; }
      if (!response.ok) throw new Error("load failed");
      setState(await response.json());
      setSyncErr("");
    } catch { setSyncErr(t("syncErr")); }
  };

  useEffect(() => {
    if (auth === true) load();
    if (auth === false) setState(null);
  }, [auth]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5200);
    return () => clearTimeout(timer);
  }, [notice]);

  const push = (next) => {
    const version = ++saveVersion.current;
    setState(next);
    saveChain.current = saveChain.current.catch(() => {}).then(async () => {
      try {
        const response = await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
        if (response.status === 401) { setAuth(false); setState(null); return; }
        if (!response.ok) throw new Error("save failed");
        const normalized = await response.json();
        if (version === saveVersion.current) setState(normalized);
        setSyncErr("");
      } catch { setSyncErr(t("syncErr")); }
    });
  };

  const commit = (next) => {
    if (!state) return;
    hist.current.undo.push(structuredClone(state));
    if (hist.current.undo.length > 60) hist.current.undo.shift();
    hist.current.redo = [];
    bump((number) => number + 1);
    push(next);
  };

  const undo = () => {
    if (!hist.current.undo.length || !state) return;
    hist.current.redo.push(structuredClone(state));
    push(hist.current.undo.pop());
    bump((number) => number + 1);
  };

  const redo = () => {
    if (!hist.current.redo.length || !state) return;
    hist.current.undo.push(structuredClone(state));
    push(hist.current.redo.pop());
    bump((number) => number + 1);
  };

  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const logout = async () => {
    try { await fetch("/api/logout", { method: "POST" }); } catch { /* lock locally regardless */ }
    hist.current = { undo: [], redo: [] };
    setState(null);
    setAuth(false);
  };

  if (auth === "checking") return html`<div class="boot">${t("checkingAccess")}</div>`;
  if (auth === false) return html`<${PasscodeScreen} t=${t} onUnlocked=${() => setAuth(true)} lang=${lang} setLang=${setLang} />`;
  if (!state) return html`<div class="boot">${t("loading")}${syncErr && html`<div class="banner err boot-error">${syncErr}</div>`}</div>`;

  const inShop = state.machines.filter((machine) => machine.serial && !["stDraft", "stShipped"].includes(machine.status)).length;
  const starters = state.machines.filter(machine => machine.serial && machine.status === "stDraft").length;
  const unnumbered = state.machines.filter(machine => !machine.serial).length;
  const openMos = state.mos.filter((mo) => !mo.closed).length;
  const openPrints = state.mos.filter((mo) => mo.printRequest && !["ready", "cancelled"].includes(mo.printRequest.status)).length;
  const lowStock = state.parts.filter((part) => isLowStock(state, part)).length;

  const tabs = [["queue", "tabQueue"], ["mos", "tabMos"], ["plan", "tabPlan"], ["parts", "tabParts"]];

  return html`
    <div class="brandbar"><div class="brandbar-in">
      <img class="logo" src="logo.png" alt="TCG Machines Refurb Shop" />
      <div class="brand-copy">
        <div class="brand-title">TCG Refurb Shop</div>
        <div class="brand-tag">${t("tagline")}</div>
      </div>
      <div class="brand-right">
        <div class="langs">
          ${LANGS.map((item) => html`<button class="lang ${lang === item.code ? "on" : ""}" onClick=${() => setLang(item.code)}>${item.label}</button>`)}
        </div>
        <div class="hist">
          <button title=${t("undo")} disabled=${!hist.current.undo.length} onClick=${undo}>↶</button>
          <button title=${t("redo")} disabled=${!hist.current.redo.length} onClick=${redo}>↷</button>
          <button title=${t("refresh")} onClick=${load}>↻</button>
          <button title=${t("lockShop")} onClick=${logout}>⌁</button>
        </div>
      </div>
    </div></div>

    <div class="tabs"><div class="tabs-in">
      ${tabs.map(([key, label]) => html`<button class="tab ${tab === key ? "on" : ""}" onClick=${() => setTab(key)}>${t(label)}</button>`)}
    </div></div>

    <div class="wrap">
      <div class="stats">
        ${starters > 0 && html`<span><b>${starters}</b> ${t("starterUnits")}</span>`}
        ${unnumbered > 0 && html`<span><b>${unnumbered}</b> ${t("unnumberedNotes")}</span>`}
        <span><b>${inShop}</b> ${t("inShop")}</span>
        <span><b>${openMos}</b> ${t("openMos")}</span>
        <span><b>${openPrints}</b> ${t("openPrintRequests")}</span>
        <span class=${lowStock ? "stat-alert" : ""}><b>${lowStock}</b> ${t("lowStock")}</span>
      </div>
      ${syncErr && html`<div class="banner err">${syncErr}</div>`}
      ${notice && html`<div class="banner ok">${notice}</div>`}

      ${tab === "queue" && html`<${QueueTab} state=${state} commit=${commit} t=${t} setNotice=${setNotice} goMo=${(serial) => { setMoPrefill(serial); setTab("mos"); }} />`}
      ${tab === "mos" && html`<${MosTab} state=${state} commit=${commit} t=${t} setNotice=${setNotice} prefill=${moPrefill} clearPrefill=${() => setMoPrefill("")} />`}
      ${tab === "plan" && html`<${PlanTab} state=${state} commit=${commit} t=${t} setNotice=${setNotice} />`}
      ${tab === "parts" && html`<${PartsTab} state=${state} commit=${commit} t=${t} setNotice=${setNotice} />`}

      <div class="foot">${t("sharedNote")}</div>
    </div>`;
}

/* ==================================================== QUEUE / INTAKE */
const QUEUE_GROUPS = [
  { type: 'scanner', label: 'SBX' }, { type: 'conveyor', label: 'CNV' },
  { type: 'chassis', label: 'CHS' }, { type: 'full', label: 'Full machines' },
];
const blankUnitForm = () => ({ serial: '', unitType: 'scanner', gen: '', grade: '', received: '', source: '', notes: '', status: 'stDraft', placeholderLabel: '', needsReview: false });
const formForUnit = unit => ({ ...blankUnitForm(), ...unit, gen: unit.gen ?? '' });

function QueueUnitFields({ form, setForm, prefix, t, linked = false }) {
  const change = (name, value) => setForm({ ...form, [name]: value });
  const id = name => `${prefix}-${name}`;
  return html`
    <div class="grid2a">
      <div class="field"><label for=${id('serial')}>${t('serial')}</label><input id=${id('serial')} class="in mono" value=${form.serial} onInput=${e => change('serial', e.target.value)} placeholder="SBX-002 / CNV-009 / CHS-029" /></div>
      <div class="field"><label for=${id('gen')}>${t('generation')}</label><select id=${id('gen')} class="in" value=${form.gen} onChange=${e => change('gen', e.target.value)}><option value="">${t('notSet')}</option>${GENS.map(g => html`<option value=${g}>PR${g}</option>`)}</select></div>
    </div>
    <div class="grid2">
      <div class="field"><label for=${id('type')}>${t('unitType')}</label><select id=${id('type')} class="in" value=${form.unitType} disabled=${linked} onChange=${e => change('unitType', e.target.value)}>${UNIT_TYPES.map(unit => html`<option value=${unit.value}>${t(unit.key)}</option>`)}</select></div>
      <div class="field"><label for=${id('grade')}>${t('grade')}</label><select id=${id('grade')} class="in" value=${form.grade} onChange=${e => change('grade', e.target.value)}><option value="">${t('notSet')}</option>${GRADES.map(grade => html`<option value=${grade.code}>${grade.code} · ${t(grade.key)}</option>`)}</select></div>
    </div>
    ${linked && html`<div class="hint">${t('linkedTypeLocked')}</div>`}
    <div class="grid2">
      <div class="field"><label for=${id('status')}>${t('statusLbl')}</label><select id=${id('status')} class="in" value=${form.status} onChange=${e => change('status', e.target.value)}>${STATUS_KEYS.map(key => html`<option value=${key}>${t(key)}</option>`)}</select></div>
      <div class="field"><label for=${id('received')}>${t('receivedDateOptional')}</label><input id=${id('received')} class="in" type="date" value=${form.received} onInput=${e => change('received', e.target.value)} /></div>
    </div>
    ${!form.serial.trim() && html`<div class="field"><label for=${id('label')}>${t('unnumberedLabel')}</label><input id=${id('label')} class="in" value=${form.placeholderLabel} onInput=${e => change('placeholderLabel', e.target.value)} placeholder=${t('unnumberedLabelHint')} /></div>`}
    <div class="field"><label for=${id('source')}>${t('from')}</label><input id=${id('source')} class="in" value=${form.source} onInput=${e => change('source', e.target.value)} placeholder=${t('fromPh')} /></div>
    <div class="field"><label for=${id('notes')}>${t('notesLbl')}</label><textarea id=${id('notes')} class="in" value=${form.notes} onInput=${e => change('notes', e.target.value)} placeholder=${t('notesPh')}></textarea></div>
    <label class="checkline"><input type="checkbox" checked=${form.needsReview} onChange=${e => change('needsReview', e.target.checked)} /> ${t('needsVerification')}</label>
  `;
}

function QueueUnitCard({ machine, state, commit, t, setNotice, goMo, confirmId, setConfirmId }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(formForUnit(machine));
  const grade = gradeOf(machine.grade);
  const [background, color] = STATUS_STYLE[machine.status] || STATUS_STYLE.stDraft;
  const last = STATUS_KEYS.indexOf(machine.status) === STATUS_KEYS.length - 1;
  const linked = state.mos.some(mo => mo.machineId === machine.id);
  const job = state.mos.find(mo => mo.machineId === machine.id && !mo.closed) || state.mos.find(mo => mo.machineId === machine.id);
  const progress = Math.max(0, STATUS_KEYS.indexOf(machine.status) - 1) / Math.max(1, STATUS_KEYS.length - 2) * 100;
  const apply = (values, close = false) => {
    try {
      commit(updateQueueUnit(state, machine.id, values));
      if (close) { setEditing(false); setNotice(t('unitSaved', { serial: values.serial || values.placeholderLabel })); }
    } catch (error) { setNotice(t(error.code || 'unitSaveFailed', { serial: values.serial })); }
  };
  return html`<div class="card mch ${editing ? 'editing-unit' : ''}" data-unit-id=${machine.id} data-serial=${machine.serial} data-unit-type=${machine.unitType} style="border-left-color:${{ scanner: '#F06511', conveyor: '#5A7A99', chassis: '#4D865C', full: '#1C2127' }[machine.unitType]}">
    <div class="mch-top">
      <div class="min-zero"><div class="mch-serial">${machine.serial || machine.placeholderLabel || t('noSerial')}</div><div class="mch-sub">${machine.source ? machine.source + ' · ' : ''}${machine.received ? t('inDate', { date: machine.received }) : t('receivedNotSet')}</div></div>
      <div class="badge-row"><span class="pill" title=${machine.grade ? t(grade.key) : t('notSet')} style="background:${grade.bg};color:${grade.tx}">${machine.grade || '?'}</span><${UnitBadge} type=${machine.unitType} t=${t} /><${GenBadge} g=${machine.gen} /></div>
    </div>
    <div class="progress-track" title=${t(machine.status)}><span style="width:${progress}%"></span></div>
    ${machine.needsReview && html`<div class="verification-flag">${t('needsVerification')}</div>`}
    ${!machine.serial && html`<div class="hint unnumbered-hint">${t('unnumberedNoteHint')}</div>`}
    ${editing ? html`<div class="unit-edit-fields">
      <${QueueUnitFields} form=${form} setForm=${setForm} prefix=${'edit-' + machine.id} t=${t} linked=${linked} />
      <div class="unit-edit-actions"><button class="btn primary" onClick=${() => apply(form, true)}>${t('saveChanges')}</button><button class="btn ghost" onClick=${() => setEditing(false)}>${t('cancelEdit')}</button></div>
    </div>` : html`
      ${machine.notes && html`<div class="mch-notes">${machine.notes}</div>`}
      <div class="mch-row">
        <select class="statussel" aria-label=${t('statusForUnit', { serial: machine.serial || machine.placeholderLabel })} style="background:${background};color:${color}" value=${machine.status} onChange=${e => apply({ ...machine, status: e.target.value })}>${STATUS_KEYS.map(key => html`<option value=${key}>${t(key)}</option>`)}</select>
        <button class="btn ghost sm edit-unit" onClick=${() => { setForm(formForUnit(machine)); setEditing(true); setConfirmId(null); }}>${t('editUnit')}</button>
        ${!last && machine.serial && html`<button class="btn ghost sm" onClick=${() => apply({ ...machine, status: STATUS_KEYS[STATUS_KEYS.indexOf(machine.status) + 1] })}>${t('advance')}</button>`}
        ${machine.serial && html`<button class="btn ink sm mono" onClick=${() => goMo(machine.serial)}>${job ? job.number : t('createMo') + ' +'}</button>`}
        <div class="spacer"></div>
        ${confirmId === machine.id
          ? html`<button class="btn danger sm" onClick=${() => {
              if (linked) { setNotice(t('removeJobFirst')); setConfirmId(null); return; }
              commit({ ...state, machines: state.machines.filter(item => item.id !== machine.id) }); setConfirmId(null);
            }}>${t('tapAgain')}</button>`
          : html`<button class="x" title=${t('remove')} aria-label=${t('removeUnitNamed', { serial: machine.serial || machine.placeholderLabel })} onClick=${() => setConfirmId(machine.id)}>✕</button>`}
      </div>
    `}
  </div>`;
}

function QueueTab({ state, commit, t, setNotice, goMo }) {
  const { machines } = state;
  const [open, setOpen] = useState(machines.length === 0);
  const [form, setForm] = useState(blankUnitForm());
  const [filter, setFilter] = useState('shop');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const add = () => {
    const id = uid();
    const base = { id, serial: '', unitType: form.unitType, status: 'stDraft' };
    try {
      const next = updateQueueUnit({ ...state, machines: [...machines, base] }, id, form);
      commit(next); setForm(blankUnitForm()); setOpen(false);
      setNotice(t('unitSaved', { serial: form.serial || form.placeholderLabel }));
    } catch (error) { setNotice(t(error.code || 'unitSaveFailed', { serial: form.serial })); }
  };
  const needle = query.trim().toLowerCase();
  const visible = machines
    .filter(machine => filter === 'shop' ? machine.status !== 'stShipped' : filter === 'done' ? machine.status === 'stShipped' : filter === 'draft' ? machine.status === 'stDraft' : true)
    .filter(machine => !needle || [machine.serial, machine.placeholderLabel, machine.source, machine.notes, t(unitKey(machine.unitType))].some(value => String(value || '').toLowerCase().includes(needle)))
    .sort(compareUnits);
  const shown = visible.filter(machine => moduleFilter === 'all' || machine.unitType === moduleFilter);
  const countLabel = units => {
    const numbered = units.filter(unit => unit.serial).length;
    const notes = units.length - numbered;
    return `${numbered}${notes ? ' + ' + t('noteCount', { n: notes }) : ''}`;
  };
  return html`
    ${machines.some(unit => unit.starterBatch) && html`<div class="starter-notice"><strong>${t('starterListTitle')}</strong><span>${t('starterListHint')}</span></div>`}
    <${Panel} title=${t('checkIn')} open=${open} setOpen=${setOpen}>
      <${QueueUnitFields} form=${form} setForm=${setForm} prefix="new-unit" t=${t} />
      <button class="btn primary" disabled=${!form.serial.trim() && !form.placeholderLabel.trim()} onClick=${add}>${t('addToQueue')}</button>
    <//>
    <div class="queue-tools">
      <input class="in search-in" aria-label=${t('searchUnits')} value=${query} onInput=${e => setQuery(e.target.value)} placeholder=${t('searchUnits')} />
      <div class="chips queue-chips">
        ${[['shop', 'fltShop'], ['draft', 'fltDraft'], ['done', 'fltShipped'], ['all', 'fltAll']].map(([key, label]) => html`<button class="chip ${filter === key ? 'on' : ''}" onClick=${() => setFilter(key)}>${t(label)}</button>`)}
        <div class="spacer"></div>
        ${machines.length > 0 && html`<button class="linky" onClick=${() => downloadCSV('refurb-intake-queue.csv', [
          ['Serial / ID', 'Generation', 'Unit Type', 'Grade', 'Status', 'From', 'Received', 'Notes', 'Unnumbered note', 'Needs verification'],
          ...[...machines].sort(compareUnits).map(machine => [machine.serial, generationLabel(machine.gen), machine.unitType, machine.grade ? `${machine.grade} ${GRADE_EN[machine.grade] || ''}`.trim() : '', STATUS_EN[machine.status] || machine.status, machine.source, machine.received, machine.notes, machine.serial ? '' : machine.placeholderLabel || '', machine.needsReview ? 'Yes' : 'No']),
        ])}>${t('exportCsv')}</button>`}
      </div>
      <div class="chips module-filter-chips">
        <button class="chip ${moduleFilter === 'all' ? 'on' : ''}" onClick=${() => setModuleFilter('all')}>${t('allModules')} · ${countLabel(visible)}</button>
        ${QUEUE_GROUPS.filter(group => group.type !== 'full' || visible.some(unit => unit.unitType === 'full')).map(group => html`<button class="chip ${moduleFilter === group.type ? 'on' : ''}" data-module-filter=${group.type} onClick=${() => setModuleFilter(group.type)}>${group.type === 'full' ? t('unitFull') : group.label} · ${countLabel(visible.filter(unit => unit.unitType === group.type))}</button>`)}
      </div>
    </div>
    ${shown.length === 0 ? html`<div class="empty">${machines.length === 0 ? t('emptyQueue') : t('emptyFilter')}</div>` : QUEUE_GROUPS.map(group => {
      const units = shown.filter(unit => unit.unitType === group.type);
      if (!units.length) return null;
      return html`<section class="queue-module-section" data-module-group=${group.type}>
        <h2 class="queue-group-title">${group.type === 'full' ? t('unitFull') : group.label}<span>${t(unitKey(group.type))} · ${countLabel(units)}</span></h2>
        <div class="cards">${units.map(machine => html`<${QueueUnitCard} key=${machine.id} machine=${machine} state=${state} commit=${commit} t=${t} setNotice=${setNotice} goMo=${goMo} confirmId=${confirmId} setConfirmId=${setConfirmId} />`)}</div>
      </section>`;
    })}
  `;
}

/* ==================================================== PARTS & INVENTORY */
function PartsTab({ state, commit, t, setNotice }) {
  const { parts } = state;
  const [query, setQuery] = useState("");
  const [genFilter, setGenFilter] = useState(0);
  const [stockFilter, setStockFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [newPart, setNewPart] = useState({ pn: "", desc: "", gens: [], wt: "", qty: "1", status: "Active", category: "3DP", onHand: "0", minStock: "0", location: "" });
  const [only3dp, setOnly3dp] = useState(true);
  const [confirmPn, setConfirmPn] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return parts
      .filter((part) => genFilter ? part.gens.includes(genFilter) : true)
      .filter((part) => {
        const available = (Number(part.onHand) || 0) - reservedForPart(state, part.pn);
        if (stockFilter === "low") return isLowStock(state, part);
        if (stockFilter === "stock") return available > 0;
        return true;
      })
      .filter((part) => !needle || [part.pn, part.desc, part.location, part.category].some((value) => String(value || "").toLowerCase().includes(needle)))
      .sort((a, b) => a.pn.localeCompare(b.pn));
  }, [parts, query, genFilter, stockFilter, state.mos]);

  const patchPart = (pn, changes) => commit({ ...state, parts: parts.map((part) => part.pn === pn ? { ...part, ...changes } : part) });

  const adjustStock = (pn, delta, reason = "Manual stock adjustment") => {
    if (!delta) return;
    const part = parts.find((item) => item.pn === pn);
    if (!part) return;
    const current = Number(part.onHand) || 0;
    const nextValue = Math.max(0, current + delta);
    const actual = nextValue - current;
    if (!actual) return;
    const log = { id: uid(), pn, delta: actual, reason, mo: "", at: nowIso() };
    commit({ ...state, parts: parts.map((item) => item.pn === pn ? { ...item, onHand: nextValue } : item), inventoryLog: [log, ...(state.inventoryLog || [])].slice(0, 2000) });
  };

  const setStock = (pn, value) => {
    const part = parts.find((item) => item.pn === pn);
    if (!part) return;
    const current = Number(part.onHand) || 0;
    const nextValue = Math.max(0, Number(value) || 0);
    const delta = nextValue - current;
    if (!delta) return;
    const log = { id: uid(), pn, delta, reason: "Inventory count set", mo: "", at: nowIso() };
    commit({ ...state, parts: parts.map((item) => item.pn === pn ? { ...item, onHand: nextValue } : item), inventoryLog: [log, ...(state.inventoryLog || [])].slice(0, 2000) });
  };

  const toggleGen = (pn, generation) => patchPart(pn, {
    gens: parts.find((part) => part.pn === pn).gens.includes(generation)
      ? parts.find((part) => part.pn === pn).gens.filter((item) => item !== generation)
      : [...parts.find((part) => part.pn === pn).gens, generation].sort(),
  });

  const add = () => {
    const pn = newPart.pn.trim();
    if (!pn) return;
    if (parts.some((part) => part.pn.toLowerCase() === pn.toLowerCase())) { setNotice(t("dupPart", { pn })); return; }
    const gens = newPart.gens.length ? newPart.gens : inferGens(pn + " " + newPart.desc);
    const part = {
      pn,
      desc: newPart.desc.trim(),
      gens,
      wt: newPart.wt === "" ? null : Math.max(0, parseFloat(newPart.wt) || 0),
      qty: asQty(newPart.qty),
      status: newPart.status,
      category: newPart.category,
      onHand: Math.max(0, Number(newPart.onHand) || 0),
      minStock: Math.max(0, Number(newPart.minStock) || 0),
      location: newPart.location.trim(),
    };
    commit({ ...state, parts: [...parts, part] });
    setNewPart({ pn: "", desc: "", gens: [], wt: "", qty: "1", status: "Active", category: "3DP", onHand: "0", minStock: "0", location: "" });
    setOpen(false);
    setNotice(t("addedPart", { pn }));
  };

  const importFile = (file) => {
    const reader = new FileReader();
    reader.onerror = () => setNotice(t("importFail"));
    reader.onload = () => {
      try {
        const data = parseCSV(reader.result);
        let added = 0, dupes = 0, skipped = 0;
        const next = [...parts];
        for (const row of data) {
          const pn = (row["Part No."] || row["Part No"] || row.pn || "").trim();
          if (!pn) continue;
          const group = (row["Group number"] || row["Group name"] || "").trim();
          if (only3dp && group && group !== "3DP" && group !== "3D Print") { skipped++; continue; }
          if (next.some((part) => part.pn.toLowerCase() === pn.toLowerCase())) { dupes++; continue; }
          const desc = (row["Part description"] || row.Description || row.desc || "").trim();
          const weight = parseFloat(row["3DP Weight"] || row["Weight g"] || row.wt);
          const quantity = parseInt(row["QTY Per Machine"] || row["Qty per machine"] || row.qty);
          const onHand = parseFloat(row["On Hand"] || row["On hand"] || row.onHand);
          const minStock = parseFloat(row["Min Stock"] || row["Minimum Stock"] || row.minStock);
          const category = row.Category || row.category || (group === "3DP" || group === "3D Print" ? "3DP" : "Other");
          next.push({
            pn, desc, gens: inferGens(pn + " " + desc), wt: Number.isFinite(weight) ? weight : null,
            qty: !quantity || quantity < 1 ? 1 : quantity, status: /-OBS/i.test(pn) ? "OBS" : "Active",
            category: ["3DP", "Hardware", "Assembly", "Other"].includes(category) ? category : "Other",
            onHand: Number.isFinite(onHand) ? Math.max(0, onHand) : 0,
            minStock: Number.isFinite(minStock) ? Math.max(0, minStock) : 0,
            location: (row.Location || row.location || "").trim(),
          });
          added++;
        }
        commit({ ...state, parts: next });
        setNotice(only3dp ? t("importDone", { added, dupes, skipped }) : t("importDoneNoSkip", { added, dupes }));
      } catch { setNotice(t("importFail")); }
    };
    reader.readAsText(file);
  };

  return html`
    <div class="inventory-summary card">
      <div><span class="summary-number">${parts.reduce((sum, part) => sum + (Number(part.onHand) || 0), 0)}</span><span>${t("piecesOnHand")}</span></div>
      <div><span class="summary-number">${parts.reduce((sum, part) => sum + reservedForPart(state, part.pn), 0)}</span><span>${t("piecesReserved")}</span></div>
      <div><span class="summary-number warn">${parts.filter((part) => isLowStock(state, part)).length}</span><span>${t("lowStockItems")}</span></div>
    </div>

    <div class="inventory-tools">
      <input class="in" value=${query} onInput=${(event) => setQuery(event.target.value)} placeholder=${t("searchPh")} />
      <div class="chips inventory-filters">
        <button class="chip ${stockFilter === "all" ? "on" : ""}" onClick=${() => setStockFilter("all")}>${t("fltAllShort")}</button>
        <button class="chip ${stockFilter === "stock" ? "on" : ""}" onClick=${() => setStockFilter("stock")}>${t("inStock")}</button>
        <button class="chip ${stockFilter === "low" ? "on warning" : ""}" onClick=${() => setStockFilter("low")}>${t("lowStock")}</button>
        <span class="chip-divider"></span>
        ${GENS.map((generation) => html`<button class="chip mono g${generation} ${genFilter === generation ? "on" : ""}" onClick=${() => setGenFilter(genFilter === generation ? 0 : generation)}>PR${generation}</button>`)}
        <div class="spacer"></div>
        <button class="linky" onClick=${() => downloadCSV("refurb-parts-inventory.csv", [
          ["Part No.", "Description", "Category", "Fits", "Weight g", "Qty per machine", "Status", "On Hand", "Reserved", "Available", "Min Stock", "Location"],
          ...parts.map((part) => {
            const reserved = reservedForPart(state, part.pn);
            return [part.pn, part.desc, part.category, part.gens.map((generation) => "PR" + generation).join(" "), part.wt ?? "", part.qty, part.status, part.onHand || 0, reserved, (part.onHand || 0) - reserved, part.minStock || 0, part.location || ""];
          }),
        ])}>${t("exportCsv")}</button>
      </div>
    </div>

    <${Panel} title=${t("addOrImport")} open=${open} setOpen=${setOpen}>
      <div class="grid2">
        <div class="field"><label>${t("partNo")}</label><input class="in mono" value=${newPart.pn} onInput=${(event) => setNewPart({ ...newPart, pn: event.target.value })} placeholder="MFG0499" /></div>
        <div class="field"><label>${t("category")}</label><select class="in" value=${newPart.category} onChange=${(event) => setNewPart({ ...newPart, category: event.target.value })}>${PART_CATEGORIES.map((category) => html`<option value=${category.value}>${t(category.key)}</option>`)}</select></div>
      </div>
      <div class="field"><label>${t("descLbl")}</label><input class="in" value=${newPart.desc} onInput=${(event) => setNewPart({ ...newPart, desc: event.target.value })} placeholder=${t("descPh")} /></div>
      <div class="field"><label>${t("fits")}</label><div class="badge-row">${GENS.map((generation) => html`<${GenBadge} g=${generation} dim=${!newPart.gens.includes(generation)} onClick=${() => setNewPart({ ...newPart, gens: newPart.gens.includes(generation) ? newPart.gens.filter((item) => item !== generation) : [...newPart.gens, generation].sort() })} />`)}</div></div>
      <div class="grid3">
        <div class="field"><label>${t("weightG")}</label><input class="in" inputmode="decimal" value=${newPart.wt} onInput=${(event) => setNewPart({ ...newPart, wt: event.target.value })} placeholder=${t("optionalPh")} /></div>
        <div class="field"><label>${t("qtyPerMach")}</label><input class="in" inputmode="numeric" value=${newPart.qty} onInput=${(event) => setNewPart({ ...newPart, qty: event.target.value })} /></div>
        <div class="field"><label>${t("statusLbl")}</label><select class="in" value=${newPart.status} onChange=${(event) => setNewPart({ ...newPart, status: event.target.value })}><option value="Active">${t("stActive")}</option><option value="OBS">${t("stOBS")}</option></select></div>
      </div>
      <div class="grid3">
        <div class="field"><label>${t("onHand")}</label><input class="in" inputmode="numeric" value=${newPart.onHand} onInput=${(event) => setNewPart({ ...newPart, onHand: event.target.value })} /></div>
        <div class="field"><label>${t("minimumStock")}</label><input class="in" inputmode="numeric" value=${newPart.minStock} onInput=${(event) => setNewPart({ ...newPart, minStock: event.target.value })} /></div>
        <div class="field"><label>${t("location")}</label><input class="in" value=${newPart.location} onInput=${(event) => setNewPart({ ...newPart, location: event.target.value })} placeholder=${t("locationPh")} /></div>
      </div>
      <button class="btn primary" disabled=${!newPart.pn.trim()} onClick=${add}>${t("addPart")}</button>
      <div class="divider">
        <div class="subhead">${t("importTitle")}</div>
        <label class="checkline"><input type="checkbox" checked=${only3dp} onChange=${(event) => setOnly3dp(event.target.checked)} /> ${t("only3dp")}</label>
        <input type="file" accept=".csv,text/csv" onChange=${(event) => { const file = event.target.files?.[0]; if (file) { importFile(file); event.target.value = ""; } }} />
        <div class="hint">${t("importHintInventory")}</div>
      </div>
    <//>

    <div class="cards parts-cards">
      ${shown.map((part) => html`<${InventoryPartCard} key=${part.pn} part=${part} state=${state} t=${t} patchPart=${patchPart} adjustStock=${adjustStock} setStock=${setStock} toggleGen=${toggleGen} confirmPn=${confirmPn} setConfirmPn=${setConfirmPn} remove=${() => { commit({ ...state, parts: parts.filter((item) => item.pn !== part.pn) }); setConfirmPn(null); }} />`)}
      ${shown.length === 0 && html`<div class="empty">${t("emptyParts")}</div>`}
    </div>

    ${(state.inventoryLog || []).length > 0 && html`<details class="history-panel"><summary>${t("recentInventoryActivity")}</summary><div class="history-list">
      ${(state.inventoryLog || []).slice(0, 12).map((entry) => html`<div class="history-row"><span class="mono">${entry.pn}</span><span class=${entry.delta >= 0 ? "delta-plus" : "delta-minus"}>${entry.delta >= 0 ? "+" : ""}${entry.delta}</span><span>${entry.reason}${entry.mo ? " · " + entry.mo : ""}</span><time>${new Date(entry.at).toLocaleString()}</time></div>`)}
    </div></details>`}

    <div class="center">
      ${confirmReset ? html`<button class="btn danger" onClick=${async () => {
        try {
          const seed = await (await fetch("seed-parts.json")).json();
          const normalized = seed.map((part) => ({ ...part, category: "3DP", onHand: 0, minStock: 0, location: "" }));
          commit({ ...state, parts: normalized }); setNotice(t("resetDone"));
        } catch { setNotice(t("importFail")); }
        setConfirmReset(false);
      }}>${t("resetConfirm")}</button>` : html`<button class="linky muted-link" onClick=${() => setConfirmReset(true)}>${t("resetLib")}</button>`}
    </div>
  `;
}

function InventoryPartCard({ part, state, t, patchPart, adjustStock, setStock, toggleGen, confirmPn, setConfirmPn, remove }) {
  const [count, setCount] = useState(String(part.onHand || 0));
  const [minStock, setMinStock] = useState(String(part.minStock || 0));
  const [location, setLocation] = useState(part.location || "");
  useEffect(() => setCount(String(part.onHand || 0)), [part.onHand]);
  useEffect(() => setMinStock(String(part.minStock || 0)), [part.minStock]);
  useEffect(() => setLocation(part.location || ""), [part.location]);

  const reserved = reservedForPart(state, part.pn);
  const available = (Number(part.onHand) || 0) - reserved;
  const low = isLowStock(state, part);

  return html`<div class="card inventory-card ${low ? "low" : ""}">
    <div class="prt-top">
      <div class="min-zero"><div><span class="prt-pn">${part.pn}</span>${part.status === "OBS" && html`<span class="obsb">OBS</span>`}<span class="category-badge">${t(categoryKey(part.category))}</span></div><div class="prt-desc">${part.desc}</div></div>
      ${confirmPn === part.pn ? html`<button class="btn danger xs" onClick=${remove}>${t("tapAgain")}</button>` : html`<button class="x" onClick=${() => setConfirmPn(part.pn)}>✕</button>`}
    </div>
    <div class="inventory-stock-row">
      <div class="stock-control"><button onClick=${() => adjustStock(part.pn, -1)}>−</button><input class="mono" inputmode="numeric" value=${count} onInput=${(event) => setCount(event.target.value.replace(/[^0-9.]/g, ""))} onBlur=${() => setStock(part.pn, count)} onKeyDown=${(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><button onClick=${() => adjustStock(part.pn, 1)}>+</button></div>
      <div class="stock-metrics"><div><b>${part.onHand || 0}</b><span>${t("onHand")}</span></div><div><b>${reserved}</b><span>${t("reserved")}</span></div><div class=${available < 0 ? "negative" : ""}><b>${available}</b><span>${t("available")}</span></div></div>
      ${low && html`<span class="low-badge">${t("lowStock")}</span>`}
    </div>
    <div class="prt-row">${GENS.map((generation) => html`<${GenBadge} g=${generation} small dim=${!part.gens.includes(generation)} onClick=${() => toggleGen(part.pn, generation)} />`)}<div class="spacer"></div><span class="prt-meta">${part.wt ? part.wt + " g" : t("wtNone")}${part.qty > 1 ? " · " + t("perMach", { n: part.qty }) : ""}</span></div>
    <details class="part-details"><summary>${t("inventoryDetails")}</summary><div class="part-details-grid">
      <div class="field"><label>${t("minimumStock")}</label><input class="in" inputmode="numeric" value=${minStock} onInput=${(event) => setMinStock(event.target.value.replace(/[^0-9.]/g, ""))} onBlur=${() => patchPart(part.pn, { minStock: Math.max(0, Number(minStock) || 0) })} /></div>
      <div class="field"><label>${t("location")}</label><input class="in" value=${location} onInput=${(event) => setLocation(event.target.value)} onBlur=${() => patchPart(part.pn, { location: location.trim() })} placeholder=${t("locationPh")} /></div>
      <div class="field"><label>${t("category")}</label><select class="in" value=${part.category} onChange=${(event) => patchPart(part.pn, { category: event.target.value })}>${PART_CATEGORIES.map((category) => html`<option value=${category.value}>${t(category.key)}</option>`)}</select></div>
      <div class="field"><label>${t("statusLbl")}</label><select class="in" value=${part.status} onChange=${(event) => patchPart(part.pn, { status: event.target.value })}><option value="Active">${t("stActive")}</option><option value="OBS">${t("stOBS")}</option></select></div>
    </div></details>
  </div>`;
}

/* ==================================================== PRINT REQUESTS / PLAN */
function PlanTab({ state, commit, t, setNotice }) {
  const [filter, setFilter] = useState("open");
  const [legacyOpen, setLegacyOpen] = useState(false);
  const requests = state.mos.filter((mo) => mo.printRequest);
  const shown = requests.filter((mo) => {
    const status = mo.printRequest.status;
    if (filter === "open") return !["ready", "cancelled"].includes(status);
    if (filter === "ready") return status === "ready";
    if (filter === "cancelled") return status === "cancelled";
    return true;
  });

  const activeRequests = requests.filter((mo) => !["ready", "cancelled"].includes(mo.printRequest.status));
  const aggregateMap = new Map();
  for (const mo of activeRequests) {
    for (const line of mo.printRequest.lines || []) {
      const key = line.pn;
      const current = aggregateMap.get(key) || { pn: key, qty: 0, requests: [], modules: new Set() };
      current.qty += asQty(line.qty);
      current.requests.push(`${mo.printRequest.number} / ${mo.number}`);
      current.modules.add(line.module || "whole");
      aggregateMap.set(key, current);
    }
  }
  const aggregate = [...aggregateMap.values()].sort((a, b) => b.qty - a.qty || a.pn.localeCompare(b.pn));

  const updateStatus = (mo, status) => {
    const timestamp = nowIso();
    const request = {
      ...mo.printRequest,
      status,
      confirmedAt: status === "confirmed" ? timestamp : mo.printRequest.confirmedAt,
      startedAt: status === "printing" ? timestamp : mo.printRequest.startedAt,
      readyAt: status === "ready" ? timestamp : status === "cancelled" ? "" : mo.printRequest.readyAt,
    };
    const updatedMo = {
      ...mo,
      printRequest: request,
      workflow: { ...mo.workflow, partsReady: status === "ready" },
      parts: (mo.parts || []).map((line) => line.source === "print" ? { ...line, fulfilled: status === "ready" } : line),
    };
    const machineStatus = status === "ready" ? "stRefurb" : ["submitted", "confirmed", "printing"].includes(status) ? "stAwaiting" : null;
    commit({
      ...state,
      mos: state.mos.map((item) => item.id === mo.id ? updatedMo : item),
      machines: machineStatus ? state.machines.map((machine) => machine.id === mo.machineId && !["stReady", "stShipped"].includes(machine.status) ? { ...machine, status: machineStatus } : machine) : state.machines,
    });
    setNotice(t("requestStatusChanged", { request: request.number, status: t(printStatusKey(status)) }));
  };

  const saveRequestNotes = (mo, notes) => commit({ ...state, mos: state.mos.map((item) => item.id === mo.id ? { ...item, printRequest: { ...item.printRequest, notes } } : item) });

  const statusCounts = PRINT_STATUSES.reduce((counts, status) => ({ ...counts, [status]: requests.filter((mo) => mo.printRequest.status === status).length }), {});

  return html`
    <div class="request-overview">
      ${["submitted", "confirmed", "printing", "ready"].map((status) => { const [background, color] = PRINT_STATUS_STYLE[status]; return html`<div class="request-stat" style="--stat-bg:${background};--stat-color:${color}"><b>${statusCounts[status] || 0}</b><span>${t(printStatusKey(status))}</span></div>`; })}
    </div>

    <div class="card aggregate-card">
      <div class="section-title-row"><div><div class="section-title">${t("combinedPrintDemand")}</div><div class="hint">${t("combinedPrintHint")}</div></div>${aggregate.length > 0 && html`<button class="btn ink sm" onClick=${() => downloadCSV("refurb-open-print-demand.csv", [
        ["Part No.", "Description", "Total Qty", "Filament g", "Requests", "Modules"],
        ...aggregate.map((row) => { const part = state.parts.find((item) => item.pn === row.pn); return [row.pn, part?.desc || "", row.qty, part?.wt == null ? "" : Math.round(Number(part.wt) * row.qty), row.requests.join(" | "), [...row.modules].join(" | ")]; }),
      ])}>${t("exportCombined")}</button>`}</div>
      ${aggregate.length === 0 ? html`<div class="compact-empty">${t("noOpenPrintDemand")}</div>` : html`<div class="aggregate-list">
        ${aggregate.map((row) => { const part = state.parts.find((item) => item.pn === row.pn); return html`<div class="aggregate-row"><div class="min-zero"><span class="prt-pn">${row.pn}</span><div class="tdesc">${part?.desc || ""}</div><div class="request-refs">${row.requests.join(" · ")}</div></div><span class="aggregate-qty">×${row.qty}</span><span class="tg">${part?.wt == null ? "—" : Math.round(Number(part.wt) * row.qty) + " g"}</span></div>`; })}
      </div>`}
    </div>

    <div class="chips request-filters">
      ${[["open", "prOpen"], ["ready", "prReady"], ["cancelled", "prCancelled"], ["all", "fltAll"]].map(([key, label]) => html`<button class="chip ${filter === key ? "on" : ""}" onClick=${() => setFilter(key)}>${t(label)}</button>`)}
    </div>

    ${shown.length === 0 ? html`<div class="empty">${requests.length === 0 ? t("noPrintRequests") : t("emptyFilter")}</div>` : html`<div class="cards request-cards">
      ${shown.map((mo) => html`<${PrintRequestCard} key=${mo.id} mo=${mo} state=${state} t=${t} updateStatus=${updateStatus} saveNotes=${saveRequestNotes} setNotice=${setNotice} />`)}
    </div>`}

    <${Panel} title=${t("legacyEstimateTitle")} open=${legacyOpen} setOpen=${setLegacyOpen}>
      <${LegacyDemandPlan} state=${state} t=${t} />
    <//>
  `;
}

function PrintRequestCard({ mo, state, t, updateStatus, saveNotes, setNotice }) {
  const request = mo.printRequest;
  const [notes, setNotes] = useState(request.notes || "");
  useEffect(() => setNotes(request.notes || ""), [request.notes]);
  const totals = requestTotals(request, state);
  const [background, color] = PRINT_STATUS_STYLE[request.status] || PRINT_STATUS_STYLE.submitted;
  const stale = requestIsStale(mo);
  const next = request.status === "submitted" ? "confirmed" : request.status === "confirmed" ? "printing" : request.status === "printing" ? "ready" : null;
  const nextLabel = next === "confirmed" ? "confirmRequest" : next === "printing" ? "startPrinting" : next === "ready" ? "markPrintsReady" : "";

  return html`<div class="card request-card">
    <div class="request-head">
      <div><div><span class="mo-no">${request.number}</span><span class="revision">R${request.revision}</span></div><div class="mch-sub"><span class="mono">${mo.number}</span> · ${mo.serial} · ${generationLabel(mo.gen, "PR ?")} · ${t(unitKey(mo.unitType))}</div></div>
      <div class="badge-row"><span class="request-status" style="background:${background};color:${color}">${t(printStatusKey(request.status))}</span>${stale && html`<span class="stale-badge">${t("outOfDate")}</span>`}</div>
    </div>
    <div class="request-lines">
      ${(request.lines || []).map((line) => { const part = state.parts.find((item) => item.pn === line.pn); return html`<div class="request-line"><div class="min-zero"><span class="prt-pn">${line.pn}</span><div class="tdesc">${part?.desc || ""} · ${t(moduleKey(line.module))}</div></div><span class="line-qty">×${line.qty}</span><span class="tg">${part?.wt == null ? "—" : Math.round(Number(part.wt) * line.qty) + " g"}</span></div>`; })}
      ${!(request.lines || []).length && html`<div class="hint">${t("requestNoLines")}</div>`}
    </div>
    <div class="request-total"><span>${t("totalPieces")}: <b>${totals.pieces}</b></span><span>${t("totalFilament")}: <b>${Math.round(totals.grams)} g${totals.missingWeight ? "+" : ""}</b></span></div>
    <div class="field request-note"><label>${t("printingNotes")}</label><textarea class="in" value=${notes} onInput=${(event) => setNotes(event.target.value)} placeholder=${t("printingNotesPh")}></textarea></div>
    <div class="request-actions">
      ${notes !== request.notes && html`<button class="btn ghost sm" onClick=${() => { saveNotes(mo, notes); setNotice(t("notesSaved")); }}>${t("saveNotes")}</button>`}
      <button class="btn ghost sm" onClick=${() => { if (!openPrintRequest(mo, state, t)) setNotice(t("popupBlocked")); }}>${t("printView")}</button>
      <button class="btn ghost sm" onClick=${() => downloadCSV(`${request.number.toLowerCase()}-r${request.revision}.csv`, printRequestRows(mo, state))}>CSV</button>
      <div class="spacer"></div>
      ${next && html`<button class="btn primary sm" onClick=${() => updateStatus(mo, next)}>${t(nextLabel)}</button>`}
      <select class="in compact-select" value=${request.status} onChange=${(event) => updateStatus(mo, event.target.value)} aria-label=${t("requestStatus")}>${PRINT_STATUSES.map((status) => html`<option value=${status}>${t(printStatusKey(status))}</option>`)}</select>
    </div>
  </div>`;
}

function LegacyDemandPlan({ state, t }) {
  const demand = state.machines.filter((machine) => DEMAND_KEYS.includes(machine.status));
  const counts = GENS.reduce((result, generation) => ({ ...result, [generation]: demand.filter((machine) => machine.gen === generation).length }), {});
  const rows = state.parts
    .filter((part) => part.category === "3DP")
    .map((part) => {
      const hits = part.gens.reduce((sum, generation) => sum + (counts[generation] || 0), 0);
      const need = hits * (part.qty || 1);
      return { ...part, need, grams: part.wt ? part.wt * need : null };
    })
    .filter((row) => row.need > 0)
    .sort((a, b) => b.need - a.need || a.pn.localeCompare(b.pn));
  const totalPrints = rows.reduce((sum, row) => sum + row.need, 0);
  const totalGrams = rows.reduce((sum, row) => sum + (row.grams || 0), 0);
  const missing = rows.filter((row) => row.grams === null).length;

  return html`<div class="legacy-plan">
    <div class="legacy-counts">${GENS.map((generation) => html`<div><${GenBadge} g=${generation} small /><span class="mono">×${counts[generation]}</span></div>`)}</div>
    <div class="hint">${t("demandHint")}</div>
    ${rows.length === 0 ? html`<div class="compact-empty">${t("emptyPlan")}</div>` : html`<div class="tbl legacy-table">
      <div class="trow head"><span>${t("colPart")}</span><span>${t("colNeed")}</span><span>${t("colFilament")}</span></div>
      ${rows.map((row) => html`<div class="trow"><div class="min-zero"><span class="prt-pn">${row.pn}</span><div class="tdesc">${row.desc}</div></div><span class="tneed">${row.need}</span><span class="tg">${row.grams === null ? "—" : Math.round(row.grams) + " g"}</span></div>`)}
      <div class="trow total"><span>${t("printTotal")}</span><span class="tneed">${totalPrints}</span><span>${Math.round(totalGrams)} g${missing ? "+" : ""}</span></div>
    </div>`}
    ${rows.length > 0 && html`<div class="right"><button class="btn ink sm" onClick=${() => downloadCSV("generation-demand-estimate.csv", [["Part", "Description", "Need", "Filament g", "Status"], ...rows.map((row) => [row.pn, row.desc, row.need, row.grams === null ? "" : Math.round(row.grams), row.status])])}>${t("exportPlan")}</button></div>`}
  </div>`;
}

/* ==================================================== REFURB JOBS / MOs */
function MosTab({ state, commit, t, setNotice, prefill, clearPrefill }) {
  const { mos, machines } = state;
  const [serial, setSerial] = useState(prefill || "");
  const [filter, setFilter] = useState("open");
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => { if (prefill) { setSerial(prefill); clearPrefill(); } }, [prefill]);

  const create = () => {
    const value = serial.trim();
    if (!value) return;
    const machine = machines.find((item) => item.serial.toLowerCase() === value.toLowerCase());
    if (!machine) { setNotice(t("moNoMachine", { serial: value })); return; }
    const existing = mos.find((mo) => mo.machineId === machine.id && !mo.closed);
    if (existing) { setNotice(t("moAlreadyExists", { no: existing.number, serial: machine.serial })); setSerial(""); return; }
    if (!GENS.includes(Number(machine.gen))) { setNotice(t("chooseGenerationFirst")); return; }
    const number = (state.moCounter || 0) + 1;
    const mo = {
      id: uid(),
      number: "MO-" + String(number).padStart(4, "0"),
      machineId: machine.id,
      serial: machine.serial,
      gen: machine.gen,
      unitType: machine.unitType || "full",
      created: today(),
      closed: false,
      parts: [],
      notes: "",
      modules: makeModules(machine.unitType || "full").map(module => ({ ...module, serial: machine.unitType !== "full" ? machine.serial : "" })),
      upgrades: [],
      workflow: {
        refurbReceived: true,
        modulesSeparated: (machine.unitType || "full") !== "full",
        inspectionComplete: false,
        scopeComplete: false,
        partsReady: false,
        teardownComplete: false,
        cleaningComplete: false,
        upgradesComplete: false,
        pretestPassed: false,
        testingHandoff: false,
      },
      printRequest: null,
      pretest: { tester: "", date: "", notes: "" },
    };
    commit({
      ...state,
      mos: [mo, ...mos],
      moCounter: number,
      machines: machines.map((item) => item.id === machine.id && ["stDraft", "stReceived"].includes(item.status) ? { ...item, status: "stAssessment" } : item),
    });
    setSerial("");
    setNotice(t("moCreated", { no: mo.number, serial: machine.serial }));
  };

  const patch = (id, transform, machineStatus = null) => {
    const target = mos.find((mo) => mo.id === id);
    if (!target) return;
    const updated = transform(target);
    commit({
      ...state,
      mos: mos.map((mo) => mo.id === id ? updated : mo),
      machines: machineStatus ? machines.map((machine) => machine.id === target.machineId && !["stReady", "stShipped"].includes(machine.status) ? { ...machine, status: machineStatus } : machine) : machines,
    });
  };

  const shown = mos.filter((mo) => filter === "open" ? !mo.closed : filter === "closed" ? mo.closed : true);

  return html`
    <div class="panel"><div class="panel-body mo-create-panel">
      <div class="field"><label>${t("moSerialLbl")}</label><input class="in mono" list="serials" value=${serial} onInput=${(event) => setSerial(event.target.value)} placeholder=${t("moSerialPh")} /><datalist id="serials">${machines.filter(machine => machine.serial).map((machine) => html`<option value=${machine.serial}>${generationLabel(machine.gen, "PR ?")} · ${t(unitKey(machine.unitType))} · ${t(machine.status)}</option>`)}</datalist></div>
      <button class="btn primary" disabled=${!serial.trim()} onClick=${create}>${t("moGenerate")}</button>
      <div class="hint">${t("moCreateHint")}</div>
    </div></div>

    <div class="chips">
      ${[["open", "moOpen"], ["closed", "moClosed"], ["all", "fltAll"]].map(([key, label]) => html`<button class="chip ${filter === key ? "on" : ""}" onClick=${() => setFilter(key)}>${t(label)}</button>`)}
      <div class="spacer"></div>
      ${mos.some((mo) => !mo.closed) && html`<button class="linky" onClick=${() => downloadCSV("odoo-refurb-repair-orders.csv", odooRows(mos.filter((mo) => !mo.closed), state))}>${t("moExportAllOdoo")}</button>`}
    </div>

    ${shown.length === 0 ? html`<div class="empty">${mos.length === 0 ? t("moEmpty") : t("emptyFilter")}</div>` : html`<div class="cards mo-cards">
      ${shown.map((mo) => html`<${MoCard} key=${mo.id} mo=${mo} state=${state} patch=${patch} commit=${commit} t=${t} setNotice=${setNotice} confirmId=${confirmId} setConfirmId=${setConfirmId} />`)}
    </div>`}
  `;
}

function MoCard({ mo, state, patch, commit, t, setNotice, confirmId, setConfirmId }) {
  const [onlyGen, setOnlyGen] = useState(true);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState(1);
  const [partModule, setPartModule] = useState(mo.unitType === "full" ? "whole" : mo.unitType);
  const [upgrade, setUpgrade] = useState({ module: mo.unitType === "full" ? "whole" : mo.unitType, description: "" });
  const [notes, setNotes] = useState(mo.notes || "");
  const [pretest, setPretest] = useState({ ...mo.pretest });
  const [moduleDrafts, setModuleDrafts] = useState((mo.modules || []).map((module) => ({ ...module })));

  useEffect(() => setNotes(mo.notes || ""), [mo.notes]);
  useEffect(() => setPretest({ ...mo.pretest }), [mo.pretest?.tester, mo.pretest?.date, mo.pretest?.notes]);
  useEffect(() => setModuleDrafts((mo.modules || []).map((module) => ({ ...module }))), [mo.modules]);

  const pool = state.parts
    .filter((part) => !onlyGen || part.gens.includes(mo.gen))
    .filter((part) => !(mo.parts || []).some((line) => line.pn === part.pn))
    .sort((a, b) => a.pn.localeCompare(b.pn));

  const workflowSteps = WORKFLOW_STEPS.filter((step) => !step.fullOnly || mo.unitType === "full");
  const completeSteps = workflowSteps.filter((step) => mo.workflow?.[step.key]).length;
  const progress = Math.round(completeSteps / workflowSteps.length * 100);
  const nextStatusIfForward = (status) => {
    const machine = state.machines.find((item) => item.id === mo.machineId);
    return machine && STATUS_KEYS.indexOf(status) > STATUS_KEYS.indexOf(machine.status) ? status : null;
  };

  const toggleWorkflow = (step) => {
    const nextValue = !mo.workflow?.[step.key];
    patch(mo.id, (current) => ({
      ...current,
      workflow: { ...current.workflow, [step.key]: nextValue },
      pretest: step.key === "pretestPassed" && nextValue ? { ...current.pretest, date: current.pretest.date || today() } : current.pretest,
    }), nextValue ? nextStatusIfForward(step.status) : null);
  };

  const saveInspection = () => {
    const allInspected = moduleDrafts.length > 0 && moduleDrafts.every((module) => module.inspected);
    patch(mo.id, (current) => ({
      ...current,
      modules: moduleDrafts.map((module) => ({ ...module })),
      workflow: {
        ...current.workflow,
        // A full machine cannot have all three modules inspected until it has been separated.
        // Record both milestones together so the workflow matches what happened at the bench.
        modulesSeparated: current.unitType !== "full" || allInspected || current.workflow.modulesSeparated,
        inspectionComplete: allInspected || current.workflow.inspectionComplete,
      },
    }), allInspected ? nextStatusIfForward("stAssessment") : null);
    setNotice(t("inspectionSaved"));
  };

  const addUpgrade = () => {
    if (!upgrade.description.trim()) return;
    patch(mo.id, (current) => ({ ...current, upgrades: [...(current.upgrades || []), { id: uid(), module: upgrade.module, description: upgrade.description.trim(), complete: false }] }));
    setUpgrade({ ...upgrade, description: "" });
  };

  const addLine = () => {
    if (!pick) return;
    const part = state.parts.find((item) => item.pn === pick);
    if (!part) return;
    const quantity = asQty(qty);
    const available = (Number(part.onHand) || 0) - reservedForPart(state, part.pn);
    const source = available >= quantity ? "stock" : part.category === "3DP" ? "print" : "external";
    patch(mo.id, (current) => ({ ...current, parts: [...(current.parts || []), { pn: pick, qty: quantity, module: partModule, source, issuedQty: 0, fulfilled: false }] }));
    setPick(""); setQty(1);
  };

  const inventoryCommit = (nextMo, nextParts, log) => commit({
    ...state,
    mos: state.mos.map((item) => item.id === mo.id ? nextMo : item),
    parts: nextParts,
    inventoryLog: log ? [log, ...(state.inventoryLog || [])].slice(0, 2000) : state.inventoryLog,
  });

  const issueStock = (line) => {
    const part = state.parts.find((item) => item.pn === line.pn);
    if (!part) return;
    const remaining = Math.max(0, asQty(line.qty) - (Number(line.issuedQty) || 0));
    const issue = Math.min(remaining, Number(part.onHand) || 0);
    if (!issue) { setNotice(t("notEnoughStock", { pn: line.pn })); return; }
    const issuedQty = (Number(line.issuedQty) || 0) + issue;
    const nextMo = { ...mo, parts: mo.parts.map((item) => item.pn === line.pn ? { ...item, issuedQty, fulfilled: issuedQty >= asQty(item.qty) } : item) };
    const nextParts = state.parts.map((item) => item.pn === line.pn ? { ...item, onHand: Math.max(0, (Number(item.onHand) || 0) - issue) } : item);
    inventoryCommit(nextMo, nextParts, { id: uid(), pn: line.pn, delta: -issue, reason: t("issuedToJob"), mo: mo.number, at: nowIso() });
    if (issue < remaining) setNotice(t("partialIssue", { qty: issue, pn: line.pn }));
  };

  const returnStock = (line) => {
    const amount = Number(line.issuedQty) || 0;
    if (!amount) return;
    const nextMo = { ...mo, parts: mo.parts.map((item) => item.pn === line.pn ? { ...item, issuedQty: 0, fulfilled: false } : item) };
    const nextParts = state.parts.map((item) => item.pn === line.pn ? { ...item, onHand: (Number(item.onHand) || 0) + amount } : item);
    inventoryCommit(nextMo, nextParts, { id: uid(), pn: line.pn, delta: amount, reason: t("returnedFromJob"), mo: mo.number, at: nowIso() });
  };

  const changeSource = (line, source) => {
    if (line.source === "stock" && (Number(line.issuedQty) || 0) > 0 && source !== "stock") {
      const amount = Number(line.issuedQty) || 0;
      const nextMo = { ...mo, parts: mo.parts.map((item) => item.pn === line.pn ? { ...item, source, issuedQty: 0, fulfilled: false } : item) };
      const nextParts = state.parts.map((item) => item.pn === line.pn ? { ...item, onHand: (Number(item.onHand) || 0) + amount } : item);
      inventoryCommit(nextMo, nextParts, { id: uid(), pn: line.pn, delta: amount, reason: t("returnedSourceChange"), mo: mo.number, at: nowIso() });
      return;
    }
    patch(mo.id, (current) => ({ ...current, parts: current.parts.map((item) => item.pn === line.pn ? { ...item, source, issuedQty: source === "stock" ? item.issuedQty : 0, fulfilled: false } : item) }));
  };

  const removeLine = (line) => {
    const issued = line.source === "stock" ? Number(line.issuedQty) || 0 : 0;
    const nextMo = { ...mo, parts: mo.parts.filter((item) => item.pn !== line.pn) };
    if (issued > 0) {
      const nextParts = state.parts.map((item) => item.pn === line.pn ? { ...item, onHand: (Number(item.onHand) || 0) + issued } : item);
      inventoryCommit(nextMo, nextParts, { id: uid(), pn: line.pn, delta: issued, reason: t("returnedRemovedLine"), mo: mo.number, at: nowIso() });
    } else patch(mo.id, () => nextMo);
  };

  const generateRequest = () => {
    const lines = currentPrintLines(mo);
    if (!lines.length) { setNotice(t("noPrintLines")); return; }
    const revision = (mo.printRequest?.revision || 0) + 1;
    const request = {
      number: mo.printRequest?.number || `RPR-${mo.number.replace(/^MO-/, "")}`,
      revision,
      status: "submitted",
      generatedAt: nowIso(),
      confirmedAt: "",
      startedAt: "",
      readyAt: "",
      notes: mo.printRequest?.notes || "",
      lines,
    };
    patch(mo.id, (current) => ({
      ...current,
      printRequest: request,
      workflow: { ...current.workflow, partsReady: false },
      parts: current.parts.map((line) => line.source === "print" ? { ...line, fulfilled: false } : line),
    }), "stAwaiting");
    setNotice(t("requestGenerated", { request: request.number, revision }));
  };

  const deleteJob = () => {
    const returns = (mo.parts || [])
      .filter((line) => line.source === "stock" && (Number(line.issuedQty) || 0) > 0)
      .map((line) => ({ pn: line.pn, qty: Number(line.issuedQty) || 0 }));
    const returnByPart = returns.reduce((totals, line) => ({ ...totals, [line.pn]: (totals[line.pn] || 0) + line.qty }), {});
    const returnedAt = nowIso();
    commit({
      ...state,
      mos: state.mos.filter((item) => item.id !== mo.id),
      parts: state.parts.map((part) => returnByPart[part.pn] ? { ...part, onHand: (Number(part.onHand) || 0) + returnByPart[part.pn] } : part),
      inventoryLog: [
        ...Object.entries(returnByPart).map(([pn, qty]) => ({ id: uid(), pn, delta: qty, reason: t("returnedDeletedJob"), mo: mo.number, at: returnedAt })),
        ...(state.inventoryLog || []),
      ].slice(0, 2000),
    });
    setConfirmId(null);
  };

  const saveNotes = () => {
    patch(mo.id, (current) => ({ ...current, notes, pretest: { tester: pretest.tester || "", date: pretest.date || "", notes: pretest.notes || "" } }));
    setNotice(t("notesSaved"));
  };

  const allRequiredAvailable = (mo.parts || []).length > 0 && mo.parts.every((line) => {
    if (line.source === "stock") return (Number(line.issuedQty) || 0) >= asQty(line.qty);
    if (line.source === "external") return Boolean(line.fulfilled);
    return Boolean(line.fulfilled) || mo.printRequest?.status === "ready";
  });

  return html`<div class="card mo-card ${mo.closed ? "closed" : ""}">
    <div class="mo-head">
      <div><div><span class="mo-no">${mo.number}</span><span class="mono mo-serial"> · ${mo.serial}</span></div><div class="mch-sub">${t("moCreatedOn", { date: mo.created })}</div></div>
      <div class="badge-row"><button class="mo-badge ${mo.closed ? "mo-closed" : "mo-open"}" onClick=${() => patch(mo.id, (current) => ({ ...current, closed: !current.closed }))}>${mo.closed ? t("moClosed") : t("moOpen")}</button><${UnitBadge} type=${mo.unitType} t=${t} /><${GenBadge} g=${mo.gen} /></div>
    </div>

    <div class="job-progress-head"><div><span>${t("jobProgress")}</span><b>${completeSteps}/${workflowSteps.length}</b></div><strong>${progress}%</strong></div>
    <div class="job-progress"><span style="width:${progress}%"></span></div>
    <div class="workflow-grid">
      ${workflowSteps.map((step, index) => html`<button class="workflow-step ${mo.workflow?.[step.key] ? "done" : ""}" onClick=${() => toggleWorkflow(step)}><span>${mo.workflow?.[step.key] ? "✓" : index + 1}</span><em>${t(step.label)}</em></button>`)}
    </div>
    ${allRequiredAvailable && !mo.workflow.partsReady && html`<button class="availability-prompt" onClick=${() => patch(mo.id, (current) => ({ ...current, workflow: { ...current.workflow, partsReady: true } }), nextStatusIfForward("stRefurb"))}>✓ ${t("allPartsAvailablePrompt")}</button>`}

    <details class="job-section" open>
      <summary><span>${t("inspectionAndModules")}</span><small>${(mo.modules || []).filter((module) => module.inspected).length}/${(mo.modules || []).length}</small></summary>
      <div class="job-section-body">
        <div class="hint section-hint">${mo.unitType === "full" ? t("fullMachineInspectionHint") : t("moduleInspectionHint")}</div>
        <div class="module-list">
          ${moduleDrafts.map((module, index) => html`<div class="module-row">
            <label class="module-check"><input type="checkbox" checked=${module.inspected} onChange=${(event) => setModuleDrafts(moduleDrafts.map((item, itemIndex) => itemIndex === index ? { ...item, inspected: event.target.checked } : item))} /><span>${t(moduleKey(module.type))}</span></label>
            <select class="in" value=${module.condition} onChange=${(event) => setModuleDrafts(moduleDrafts.map((item, itemIndex) => itemIndex === index ? { ...item, condition: event.target.value } : item))}><option value="pending">${t("conditionPending")}</option><option value="good">${t("conditionGood")}</option><option value="repair">${t("conditionRepair")}</option><option value="replace">${t("conditionReplace")}</option><option value="na">${t("conditionNA")}</option></select>
            <input class="in mono" value=${module.serial} onInput=${(event) => setModuleDrafts(moduleDrafts.map((item, itemIndex) => itemIndex === index ? { ...item, serial: event.target.value } : item))} placeholder=${t("moduleSerialPh")} />
            <input class="in" value=${module.notes} onInput=${(event) => setModuleDrafts(moduleDrafts.map((item, itemIndex) => itemIndex === index ? { ...item, notes: event.target.value } : item))} placeholder=${t("inspectionNotesPh")} />
          </div>`)}
        </div>
        <div class="right"><button class="btn ghost sm" onClick=${saveInspection}>${t("saveInspection")}</button></div>
      </div>
    </details>

    <details class="job-section" open>
      <summary><span>${t("upgradeScope")}</span><small>${(mo.upgrades || []).filter((item) => item.complete).length}/${(mo.upgrades || []).length}</small></summary>
      <div class="job-section-body">
        ${(mo.upgrades || []).length === 0 && html`<div class="hint">${t("noUpgrades")}</div>`}
        <div class="upgrade-list">${(mo.upgrades || []).map((item) => html`<div class="upgrade-row ${item.complete ? "done" : ""}"><button class="task-check" onClick=${() => patch(mo.id, (current) => ({ ...current, upgrades: current.upgrades.map((upgradeItem) => upgradeItem.id === item.id ? { ...upgradeItem, complete: !upgradeItem.complete } : upgradeItem) }))}>${item.complete ? "✓" : ""}</button><span class="module-mini">${t(moduleKey(item.module))}</span><span>${item.description}</span><button class="x" onClick=${() => patch(mo.id, (current) => ({ ...current, upgrades: current.upgrades.filter((upgradeItem) => upgradeItem.id !== item.id) }))}>✕</button></div>`)}</div>
        <div class="upgrade-add"><select class="in" value=${upgrade.module} onChange=${(event) => setUpgrade({ ...upgrade, module: event.target.value })}>${MODULE_TYPES.filter((module) => mo.unitType === "full" || module === mo.unitType).map((module) => html`<option value=${module}>${t(moduleKey(module))}</option>`)}</select><input class="in" value=${upgrade.description} onInput=${(event) => setUpgrade({ ...upgrade, description: event.target.value })} onKeyDown=${(event) => { if (event.key === "Enter") addUpgrade(); }} placeholder=${t("upgradeDescriptionPh")} /><button class="btn ghost sm" disabled=${!upgrade.description.trim()} onClick=${addUpgrade}>${t("addUpgrade")}</button></div>
      </div>
    </details>

    <details class="job-section" open>
      <summary><span>${t("requiredParts")}</span><small>${(mo.parts || []).length}</small></summary>
      <div class="job-section-body">
        ${(mo.parts || []).length === 0 && html`<div class="hint">${t("moNoParts")}</div>`}
        <div class="mo-parts-list">
          ${(mo.parts || []).map((line) => {
            const part = state.parts.find((item) => item.pn === line.pn);
            const available = (Number(part?.onHand) || 0) - reservedForPart(state, line.pn);
            const sourceOptions = ["stock", ...(part?.category === "3DP" ? ["print"] : []), "external"];
            const ready = line.source === "stock" ? (Number(line.issuedQty) || 0) >= asQty(line.qty) : line.source === "print" ? Boolean(line.fulfilled) || mo.printRequest?.status === "ready" : Boolean(line.fulfilled);
            return html`<div class="mo-part-line ${ready ? "ready" : ""}">
              <div class="part-ident min-zero"><span class="prt-pn">${line.pn}</span><div class="tdesc">${part?.desc || ""}</div><div class="part-availability">${t("stockAvailable", { n: available })}${part?.location ? " · " + part.location : ""}</div></div>
              <select class="in part-module" value=${line.module || "whole"} onChange=${(event) => patch(mo.id, (current) => ({ ...current, parts: current.parts.map((item) => item.pn === line.pn ? { ...item, module: event.target.value } : item) }))}>${MODULE_TYPES.filter((module) => mo.unitType === "full" || module === mo.unitType).map((module) => html`<option value=${module}>${t(moduleKey(module))}</option>`)}</select>
              <select class="in source-select" value=${line.source || "print"} onChange=${(event) => changeSource(line, event.target.value)}>${sourceOptions.map((source) => html`<option value=${source}>${t({ stock: "sourceStock", print: "sourcePrint", external: "sourceExternal" }[source])}</option>`)}</select>
              <input class="in qty-in" inputmode="numeric" disabled=${line.source === "stock" && (Number(line.issuedQty) || 0) > 0} value=${line.qty} onInput=${(event) => patch(mo.id, (current) => ({ ...current, parts: current.parts.map((item) => item.pn === line.pn ? { ...item, qty: asQty(event.target.value), fulfilled: item.source === "stock" ? (Number(item.issuedQty) || 0) >= asQty(event.target.value) : false } : item) }))} />
              <div class="part-action">
                ${line.source === "stock" && ((Number(line.issuedQty) || 0) > 0 ? html`<button class="btn ghost xs" onClick=${() => returnStock(line)}>${t("returnStock")} (${line.issuedQty})</button>` : html`<button class="btn ghost xs" onClick=${() => issueStock(line)}>${t("issueStock")}</button>`)}
                ${line.source === "print" && html`<span class="availability-badge ${ready ? "ready" : ""}">${ready ? t("printsReady") : t("needsPrint")}</span>`}
                ${line.source === "external" && html`<label class="tiny-check"><input type="checkbox" checked=${Boolean(line.fulfilled)} onChange=${(event) => patch(mo.id, (current) => ({ ...current, parts: current.parts.map((item) => item.pn === line.pn ? { ...item, fulfilled: event.target.checked } : item) }))} /> ${t("available")}</label>`}
              </div>
              <button class="x" onClick=${() => removeLine(line)}>✕</button>
            </div>`;
          })}
        </div>
        <div class="mo-add expanded"><select class="in" value=${pick} onChange=${(event) => { setPick(event.target.value); const part = state.parts.find((item) => item.pn === event.target.value); if (part) setQty(part.qty || 1); }}><option value="">${t("moSelectPart")}</option>${pool.map((part) => html`<option value=${part.pn}>${part.pn} — ${part.desc} (${t(categoryKey(part.category))})</option>`)}</select><select class="in" value=${partModule} onChange=${(event) => setPartModule(event.target.value)}>${MODULE_TYPES.filter((module) => mo.unitType === "full" || module === mo.unitType).map((module) => html`<option value=${module}>${t(moduleKey(module))}</option>`)}</select><input class="in qty-in" inputmode="numeric" value=${qty} onInput=${(event) => setQty(event.target.value)} aria-label=${t("moQty")} /><button class="btn ghost sm" disabled=${!pick} onClick=${addLine}>${t("moAddLine")}</button></div>
        <label class="checkline"><input type="checkbox" checked=${onlyGen} onChange=${(event) => setOnlyGen(event.target.checked)} />${onlyGen ? t("moOnlyGen", { gen: mo.gen }) : t("moShowAll")}</label>

        <div class="print-request-box ${requestIsStale(mo) ? "stale" : ""}">
          <div class="print-request-copy"><div class="subhead">${t("printRequestTitle")}</div>${!mo.printRequest ? html`<div class="hint">${t("printRequestHint")}</div>` : html`<div class="request-summary"><span class="mono">${mo.printRequest.number} · R${mo.printRequest.revision}</span><span class="request-status" style="background:${PRINT_STATUS_STYLE[mo.printRequest.status][0]};color:${PRINT_STATUS_STYLE[mo.printRequest.status][1]}">${t(printStatusKey(mo.printRequest.status))}</span>${requestIsStale(mo) && html`<span class="stale-badge">${t("outOfDate")}</span>`}</div>`}</div>
          <div class="print-request-actions"><button class="btn primary sm" disabled=${currentPrintLines(mo).length === 0} onClick=${generateRequest}>${mo.printRequest ? t("refreshPrintRequest") : t("generatePrintRequest")}</button>${mo.printRequest && html`<button class="btn ghost sm" onClick=${() => { if (!openPrintRequest(mo, state, t)) setNotice(t("popupBlocked")); }}>${t("printView")}</button>`}${mo.printRequest && html`<button class="btn ghost sm" onClick=${() => downloadCSV(`${mo.printRequest.number.toLowerCase()}-r${mo.printRequest.revision}.csv`, printRequestRows(mo, state))}>CSV</button>`}</div>
        </div>
      </div>
    </details>

    <details class="job-section">
      <summary><span>${t("jobNotesAndPretest")}</span><small>${mo.workflow.pretestPassed ? "✓" : ""}</small></summary>
      <div class="job-section-body">
        <div class="field"><label>${t("moNotes")}</label><textarea class="in" value=${notes} onInput=${(event) => setNotes(event.target.value)} placeholder=${t("moNotesPh")}></textarea></div>
        <div class="grid2"><div class="field"><label>${t("pretestTester")}</label><input class="in" value=${pretest.tester || ""} onInput=${(event) => setPretest({ ...pretest, tester: event.target.value })} placeholder=${t("namePh")} /></div><div class="field"><label>${t("pretestDate")}</label><input class="in" type="date" value=${pretest.date || ""} onInput=${(event) => setPretest({ ...pretest, date: event.target.value })} /></div></div>
        <div class="field"><label>${t("pretestNotes")}</label><textarea class="in" value=${pretest.notes || ""} onInput=${(event) => setPretest({ ...pretest, notes: event.target.value })} placeholder=${t("pretestNotesPh")}></textarea></div>
        <div class="job-footer-actions"><button class="btn ghost sm" onClick=${saveNotes}>${t("saveNotes")}</button><button class="btn ink sm" onClick=${() => downloadCSV(mo.number.toLowerCase() + "-odoo.csv", odooRows([mo], state))}>${t("moExportOdoo")}</button><div class="spacer"></div>${confirmId === mo.id ? html`<button class="btn danger sm" onClick=${deleteJob}>${t("tapAgain")}</button>` : html`<button class="x" onClick=${() => setConfirmId(mo.id)}>✕</button>`}</div>
      </div>
    </details>
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
