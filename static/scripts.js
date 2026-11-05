// QR Studio: generator (server-rendered images) + in-browser scanner (jsQR).
const $ = (id) => document.getElementById(id);

/* ---------------- Theme ---------------- */
$("theme-btn").addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("qr-theme", next);
});

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

/* ---------------- Tabs ---------------- */
const tabs = { generate: $("tab-generate"), scan: $("tab-scan") };
function showTab(name) {
  Object.entries(tabs).forEach(([key, btn]) => {
    const active = key === name;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active);
    $("panel-" + key).hidden = !active;
  });
  if (name !== "scan") stopCamera();
}
tabs.generate.addEventListener("click", () => showTab("generate"));
tabs.scan.addEventListener("click", () => showTab("scan"));

/* ---------------- Generator ---------------- */
const FIELDS = {
  url: [{ id: "url", label: "Website URL", type: "url", placeholder: "https://example.com" }],
  wifi: [
    { id: "ssid", label: "Network name (SSID)", placeholder: "My Home Wi-Fi" },
    { id: "password", label: "Password", type: "password", placeholder: "Wi-Fi password" },
    { id: "encryption", label: "Security", select: [["WPA", "WPA / WPA2 / WPA3"], ["WEP", "WEP"], ["nopass", "None (open network)"]] },
    { id: "hidden", label: "Hidden network", checkbox: true },
  ],
  email: [
    { id: "email", label: "Email address", type: "email", placeholder: "name@example.com" },
    { id: "subject", label: "Subject", placeholder: "Hello!" },
    { id: "body", label: "Message", textarea: true, placeholder: "Your message" },
  ],
  phone: [{ id: "phone", label: "Phone number", type: "tel", placeholder: "+91 98765 43210" }],
  sms: [
    { id: "number", label: "Phone number", type: "tel", placeholder: "+91 98765 43210" },
    { id: "message", label: "Message", textarea: true, placeholder: "Your message" },
  ],
  text: [{ id: "text", label: "Text", textarea: true, placeholder: "Type anything…" }],
};

let currentType = "url";

function renderFields(type) {
  const wrap = $("dynamic-fields");
  wrap.replaceChildren();
  FIELDS[type].forEach((f) => {
    let control;
    if (f.checkbox) {
      const lbl = document.createElement("label");
      lbl.className = "check";
      control = document.createElement("input");
      control.type = "checkbox";
      control.id = "f-" + f.id;
      lbl.append(control, document.createTextNode(f.label));
      wrap.append(lbl);
      return;
    }
    const lbl = document.createElement("label");
    lbl.className = "field";
    const span = document.createElement("span");
    span.className = "label";
    span.textContent = f.label;
    if (f.select) {
      control = document.createElement("select");
      f.select.forEach(([v, t]) => control.add(new Option(t, v)));
    } else if (f.textarea) {
      control = document.createElement("textarea");
    } else {
      control = document.createElement("input");
      control.type = f.type || "text";
    }
    control.id = "f-" + f.id;
    if (f.placeholder) control.placeholder = f.placeholder;
    lbl.append(span, control);
    wrap.append(lbl);
  });
  const first = wrap.querySelector("input, textarea");
  if (first && matchMedia("(pointer: fine)").matches) first.focus();
}

const val = (id) => ($("f-" + id) ? $("f-" + id).value.trim() : "");
// Escape special characters in Wi-Fi QR payloads (\ ; , : ")
const wifiEscape = (s) => s.replace(/([\\;,:"])/g, "\\$1");

function buildPayload() {
  switch (currentType) {
    case "url": {
      const u = val("url");
      if (!u) return "";
      return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : "https://" + u;
    }
    case "wifi": {
      const ssid = val("ssid");
      if (!ssid) return "";
      const enc = val("encryption");
      const hidden = $("f-hidden") && $("f-hidden").checked ? "H:true;" : "";
      const pass = enc === "nopass" ? "" : `P:${wifiEscape(val("password"))};`;
      return `WIFI:T:${enc};S:${wifiEscape(ssid)};${pass}${hidden};`;
    }
    case "email": {
      const email = val("email");
      if (!email) return "";
      const params = new URLSearchParams();
      if (val("subject")) params.set("subject", val("subject"));
      if (val("body")) params.set("body", val("body"));
      const q = params.toString().replace(/\+/g, "%20");
      return `mailto:${email}${q ? "?" + q : ""}`;
    }
    case "phone":
      return val("phone") ? `tel:${val("phone").replace(/\s+/g, "")}` : "";
    case "sms":
      return val("number") ? `SMSTO:${val("number").replace(/\s+/g, "")}:${val("message")}` : "";
    default:
      return val("text");
  }
}

function options() {
  return {
    fg: $("fg").value,
    bg: $("bg").value,
    size: $("size").value,
    ecc: $("ecc").value,
  };
}

function qrUrl(data, format = "png") {
  const p = new URLSearchParams({ data, format, ...options() });
  return "/generate_qr?" + p.toString();
}

// Relative luminance contrast (WCAG) to warn about hard-to-scan colour combos
function contrast(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

let debounce, lastBlobUrl, requestId = 0;
const img = $("qr-preview");

async function generate() {
  const data = buildPayload();
  const { fg, bg } = options();
  $("contrast-hint").hidden = contrast(fg, bg) >= 3;

  if (!data) {
    img.hidden = true;
    $("placeholder").hidden = false;
    $("payload").hidden = true;
    $("download-png").disabled = $("download-svg").disabled = true;
    return;
  }
  const id = ++requestId;
  $("spinner").hidden = false;
  try {
    const res = await fetch(qrUrl(data));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not generate QR code");
    const blob = await res.blob();
    if (id !== requestId) return; // a newer request superseded this one
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(blob);
    img.src = lastBlobUrl;
    img.hidden = false;
    $("placeholder").hidden = true;
    $("payload").textContent = data;
    $("payload").hidden = false;
    $("download-png").disabled = $("download-svg").disabled = false;
  } catch (e) {
    if (id === requestId) toast(e.message);
  } finally {
    if (id === requestId) $("spinner").hidden = true;
  }
}

function scheduleGenerate() {
  clearTimeout(debounce);
  debounce = setTimeout(generate, 250);
}

$("qr-type").addEventListener("click", (e) => {
  const btn = e.target.closest(".type");
  if (!btn) return;
  document.querySelectorAll(".type").forEach((b) => b.classList.toggle("active", b === btn));
  currentType = btn.dataset.type;
  renderFields(currentType);
  scheduleGenerate();
});

$("qr-form").addEventListener("input", (e) => {
  if (e.target.id === "fg") $("fg-val").textContent = e.target.value;
  if (e.target.id === "bg") $("bg-val").textContent = e.target.value;
  if (e.target.id === "size") $("size-val").textContent = e.target.value;
  scheduleGenerate();
});
$("qr-form").addEventListener("change", scheduleGenerate);

async function download(format) {
  const data = buildPayload();
  if (!data) return;
  try {
    const res = await fetch(qrUrl(data, format));
    if (!res.ok) throw new Error("Download failed");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${currentType}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Downloaded ${format.toUpperCase()}`);
  } catch (e) {
    toast(e.message);
  }
}
$("download-png").addEventListener("click", () => download("png"));
$("download-svg").addEventListener("click", () => download("svg"));

renderFields(currentType);

/* ---------------- Scanner ---------------- */
const video = $("video");
const canvas = $("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
let stream = null, rafId = null;

function describe(text) {
  if (/^https?:\/\//i.test(text)) return { type: "Link", open: text, label: "Open link" };
  if (/^WIFI:/i.test(text)) {
    const ssid = (text.match(/S:((?:\\.|[^;])*)/i) || [])[1] || "";
    const pass = (text.match(/P:((?:\\.|[^;])*)/i) || [])[1] || "";
    const un = (s) => s.replace(/\\(.)/g, "$1");
    return { type: "Wi-Fi", pretty: `Network: ${un(ssid)}\nPassword: ${un(pass) || "(none)"}`, copy: un(pass) || un(ssid) };
  }
  if (/^mailto:/i.test(text)) return { type: "Email", open: text, label: "Write email" };
  if (/^tel:/i.test(text)) return { type: "Phone", open: text, label: "Call" };
  if (/^SMSTO:/i.test(text)) {
    const [, num = "", msg = ""] = text.match(/^SMSTO:([^:]*):?(.*)$/i) || [];
    return { type: "SMS", pretty: `To: ${num}\nMessage: ${msg}`, open: `sms:${num}?body=${encodeURIComponent(msg)}`, label: "Send SMS" };
  }
  return { type: "Text" };
}

function showResult(text) {
  const info = describe(text);
  $("scan-error").hidden = true;
  $("result-empty").hidden = true;
  $("result").hidden = false;
  $("result-type").textContent = info.type;
  $("result-text").textContent = info.pretty || text;
  const open = $("result-open");
  if (info.open) {
    open.href = info.open;
    open.textContent = info.label;
    open.hidden = false;
  } else {
    open.hidden = true;
  }
  $("result-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(info.copy || text);
      toast("Copied to clipboard");
    } catch {
      toast("Copy failed. Select the text manually.");
    }
  };
  if (navigator.vibrate) navigator.vibrate(60);
}

function showError(msg) {
  $("scan-error").textContent = msg;
  $("scan-error").hidden = false;
}

function decode(source, w, h) {
  if (typeof jsQR !== "function") {
    showError("Scanner is still loading. Try again in a moment.");
    return null;
  }
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(source, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return jsQR(data.data, w, h, { inversionAttempts: "attemptBoth" });
}

function tick() {
  if (!stream) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    const scale = Math.min(1, 720 / video.videoWidth);
    const code = decode(video, Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale));
    if (code && code.data) {
      showResult(code.data);
      stopCamera();
      toast("QR code detected");
      return;
    }
  }
  rafId = requestAnimationFrame(tick);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("Camera access isn't supported in this browser. Upload an image instead.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    await video.play();
    video.hidden = false;
    $("scan-frame").hidden = false;
    $("dropzone").hidden = true;
    $("scan-error").hidden = true;
    $("camera-btn").querySelector("span").textContent = "Stop camera";
    rafId = requestAnimationFrame(tick);
  } catch (e) {
    stream = null;
    showError(e.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access or upload an image."
      : "Couldn't start the camera. Upload an image instead.");
  }
}

function stopCamera() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.hidden = true;
  $("scan-frame").hidden = true;
  $("dropzone").hidden = false;
  $("camera-btn").querySelector("span").textContent = "Start camera";
}

$("camera-btn").addEventListener("click", () => (stream ? stopCamera() : startCamera()));

function scanFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showError("Please choose an image file.");
    return;
  }
  stopCamera();
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    const code = decode(image, Math.round(image.width * scale), Math.round(image.height * scale));
    URL.revokeObjectURL(url);
    if (code && code.data) {
      showResult(code.data);
      toast("QR code detected");
    } else {
      showError("No QR code found in this image. Try a clearer or closer photo.");
    }
  };
  image.onerror = () => showError("Couldn't read that image.");
  image.src = url;
}

$("file-input").addEventListener("change", (e) => {
  scanFile(e.target.files[0]);
  e.target.value = "";
});

const scanner = $("scanner");
["dragenter", "dragover"].forEach((ev) =>
  scanner.addEventListener(ev, (e) => { e.preventDefault(); scanner.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) =>
  scanner.addEventListener(ev, (e) => { e.preventDefault(); scanner.classList.remove("drag"); }));
scanner.addEventListener("drop", (e) => scanFile(e.dataTransfer.files[0]));

document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) {
    showTab("scan");
    scanFile(item.getAsFile());
  }
});
