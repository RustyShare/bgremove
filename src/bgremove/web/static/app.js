"use strict";

// --- i18n -----------------------------------------------------------------
// Flat key -> string maps. Strings may contain {name} placeholders filled by t().
const TRANSLATIONS = {
  en: {
    page_title: "bgremove — background removal",
    tagline: "Drop a picture — keep only the main subject.",
    dropzone_main: "<strong>Drag &amp; drop</strong> one or more images here",
    dropzone_sub: "or click to choose files",
    label_model: "Model",
    label_background: "Background",
    label_alpha: "Alpha matting (refine hair/fur edges, slower)",
    model_u2net: "u2net (general)",
    model_isnet: "isnet (sharper edges)",
    model_human: "u2net (people)",
    model_u2netp: "u2netp (fast/light)",
    model_silueta: "silueta (small)",
    bg_transparent: "Transparent",
    bg_white: "White",
    bg_black: "Black",
    rerun: "Re-run with selected model",
    download: "Download",
    download_all: "Download all",
    download_all_count: "Download all ({n})",
    hint:
      "The first request for a given model downloads it (~170 MB for the " +
      "large ones), so it can take a while. The page stays usable meanwhile.",
    choose_images: "Please choose one or more image files.",
    busy: "Still working on the previous batch — please wait.",
    processing: "Processing {done}/{total}…",
    removing: "Removing background…",
    done: "Done.",
    failed_single: "Failed — see the card below.",
    done_ok: "Done: {ok} succeeded.",
    done_mixed: "Done: {ok} succeeded, {failed} failed.",
    settings_changed: "Settings changed — click “Re-run” to apply.",
    card_failed: "Failed: {msg}",
    drop_paths_only:
      "This drag passed only file paths, not the files — Firefox can't read " +
      "files dragged from GNOME Files (Nautilus). Click the box to choose the " +
      "images instead (or use a Chromium-based browser to drag them).",
    drop_no_file:
      "Couldn't read any file from the drop (drag types: {types}). Click the " +
      "box to choose files instead.",
    script_error: "Script error: {msg}",
    error_generic: "Error: {msg}",
  },
  fr: {
    page_title: "bgremove — suppression d'arrière-plan",
    tagline: "Déposez une image — ne gardez que le sujet principal.",
    dropzone_main:
      "<strong>Glissez-déposez</strong> une ou plusieurs images ici",
    dropzone_sub: "ou cliquez pour choisir des fichiers",
    label_model: "Modèle",
    label_background: "Arrière-plan",
    label_alpha: "Détourage alpha (affine les contours cheveux/poils, plus lent)",
    model_u2net: "u2net (général)",
    model_isnet: "isnet (contours plus nets)",
    model_human: "u2net (personnes)",
    model_u2netp: "u2netp (rapide/léger)",
    model_silueta: "silueta (petit)",
    bg_transparent: "Transparent",
    bg_white: "Blanc",
    bg_black: "Noir",
    rerun: "Relancer avec le modèle choisi",
    download: "Télécharger",
    download_all: "Tout télécharger",
    download_all_count: "Tout télécharger ({n})",
    hint:
      "La première requête pour un modèle donné le télécharge (~170 Mo pour " +
      "les plus gros), cela peut donc prendre un moment. La page reste " +
      "utilisable pendant ce temps.",
    choose_images: "Veuillez choisir une ou plusieurs images.",
    busy: "Traitement du lot précédent en cours — veuillez patienter.",
    processing: "Traitement {done}/{total}…",
    removing: "Suppression de l'arrière-plan…",
    done: "Terminé.",
    failed_single: "Échec — voir la carte ci-dessous.",
    done_ok: "Terminé : {ok} réussi(s).",
    done_mixed: "Terminé : {ok} réussi(s), {failed} échoué(s).",
    settings_changed: "Réglages modifiés — cliquez sur « Relancer » pour appliquer.",
    card_failed: "Échec : {msg}",
    drop_paths_only:
      "Ce glisser-déposer n'a transmis que des chemins de fichiers — Firefox " +
      "ne peut pas lire les fichiers glissés depuis GNOME Fichiers (Nautilus). " +
      "Cliquez sur la zone pour choisir les images (ou utilisez un navigateur " +
      "basé sur Chromium pour les glisser).",
    drop_no_file:
      "Impossible de lire un fichier depuis le dépôt (types : {types}). " +
      "Cliquez sur la zone pour choisir des fichiers.",
    script_error: "Erreur de script : {msg}",
    error_generic: "Erreur : {msg}",
  },
};

const LANG_KEY = "bgremove-lang";

function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && TRANSLATIONS[saved]) return saved;
  } catch (_) {
    /* localStorage may be unavailable; fall through */
  }
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return TRANSLATIONS[nav] ? nav : "en";
}

let lang = detectLang();

function t(key, params) {
  let s =
    (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) ||
    TRANSLATIONS.en[key] ||
    key;
  if (params) {
    for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}

function applyI18n() {
  document.documentElement.lang = lang;
  document.title = t("page_title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
}

function setLang(l) {
  lang = TRANSLATIONS[l] ? l : "en";
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch (_) {
    /* ignore persistence failures */
  }
  applyI18n();
}

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const modelSelect = document.getElementById("model");
const backgroundSelect = document.getElementById("background");
const alphaMatting = document.getElementById("alpha-matting");
const statusEl = document.getElementById("status");
const rerunBtn = document.getElementById("rerun");
const gallery = document.getElementById("gallery");
const cardTemplate = document.getElementById("card-template");
const batchActions = document.getElementById("batch-actions");
const downloadAllBtn = document.getElementById("download-all");
const langSelect = document.getElementById("lang");

// Apply the detected/saved language on load, and let the selector change it.
langSelect.value = lang;
applyI18n();
langSelect.addEventListener("change", () => setLang(langSelect.value));

let busy = false;
// The most recently selected images, kept so the model/options can be changed
// and re-applied to the same set without re-uploading.
let lastFiles = [];
// Object URLs created for results, tracked so they can be revoked on a new run.
let resultUrls = [];
// Successful results of the current batch: { filename, blob }, used to build the
// "Download all" zip.
let batchResults = [];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

// Set a card's status line, mirroring the text into the title attribute so the
// full message shows in a tooltip when it's clipped to one line.
function setCardStatus(el, message, isError = false) {
  el.textContent = message;
  el.title = message;
  el.classList.toggle("error", isError);
}

function revokeResults() {
  resultUrls.forEach((url) => URL.revokeObjectURL(url));
  resultUrls = [];
}

// Process a single image into its card. Resolves true on success.
async function processOne(file, card) {
  const img = card.querySelector(".card-result");
  const spinner = card.querySelector(".spinner");
  const cardStatus = card.querySelector(".card-status");
  const download = card.querySelector(".card-download");

  spinner.hidden = false;
  img.hidden = true;
  download.hidden = true;
  setCardStatus(cardStatus, t("removing"));

  const form = new FormData();
  form.append("file", file);
  form.append("model", modelSelect.value);
  form.append("background", backgroundSelect.value);
  form.append("alpha_matting", alphaMatting.checked ? "true" : "false");

  try {
    const resp = await fetch("/api/remove", { method: "POST", body: form });
    if (!resp.ok) {
      let detail = `${resp.status} ${resp.statusText}`;
      try {
        const body = await resp.json();
        if (body && body.detail) detail = body.detail;
      } catch (_) {
        /* non-JSON error body; keep the status text */
      }
      throw new Error(detail);
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    resultUrls.push(url);
    img.src = url;
    img.hidden = false;
    const base = file.name.replace(/\.[^.]+$/, "") || "cutout";
    const filename = `${base}-nobg.png`;
    download.href = url;
    download.setAttribute("download", filename);
    download.hidden = false;
    setCardStatus(cardStatus, t("done"));
    batchResults.push({ filename, blob });
    return true;
  } catch (err) {
    setCardStatus(cardStatus, t("card_failed", { msg: err.message }), true);
    return false;
  } finally {
    spinner.hidden = true;
  }
}

// Build a fresh gallery card for a file and return the card element.
function makeCard(file) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  const name = card.querySelector(".card-name");
  name.textContent = file.name;
  name.title = file.name;
  gallery.appendChild(card);
  return card;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) =>
    f.type.startsWith("image/")
  );
  if (files.length === 0) {
    setStatus(t("choose_images"), true);
    return;
  }
  if (busy) {
    setStatus(t("busy"), true);
    return;
  }

  lastFiles = files;
  if (rerunBtn) {
    rerunBtn.disabled = false;
    rerunBtn.classList.remove("attention");
  }

  // Reset the gallery for this run.
  revokeResults();
  batchResults = [];
  gallery.innerHTML = "";
  gallery.hidden = false;
  batchActions.hidden = true;
  downloadAllBtn.disabled = true;

  const cards = files.map((file) => ({ file, card: makeCard(file) }));

  busy = true;
  let done = 0;
  let ok = 0;
  const single = files.length === 1;
  setStatus(
    single ? t("removing") : t("processing", { done: 0, total: files.length })
  );
  try {
    // Sequential, like the CLI's batch command — predictable progress and it
    // doesn't pile work onto the single-worker server.
    for (const { file, card } of cards) {
      const success = await processOne(file, card);
      done += 1;
      if (success) ok += 1;
      if (!single) setStatus(t("processing", { done, total: files.length }));
    }
    const failed = done - ok;
    setStatus(
      single
        ? ok
          ? t("done")
          : t("failed_single")
        : failed
        ? t("done_mixed", { ok, failed })
        : t("done_ok", { ok }),
      single && !ok
    );
    if (ok > 0) {
      downloadAllBtn.disabled = false;
      downloadAllBtn.textContent =
        ok === 1 ? t("download") : t("download_all_count", { n: ok });
      batchActions.hidden = false;
    }
  } finally {
    busy = false;
  }
}

// Save a blob to disk via a temporary anchor.
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Download every successful cutout as a single zip (one PNG downloads directly).
async function downloadAll() {
  if (batchResults.length === 0) return;
  if (batchResults.length === 1) {
    saveBlob(batchResults[0].blob, batchResults[0].filename);
    return;
  }
  const used = new Map();
  const entries = await Promise.all(
    batchResults.map(async (r) => {
      // Disambiguate duplicate names so no entry is overwritten in the zip.
      let name = r.filename;
      const n = (used.get(name) || 0) + 1;
      used.set(name, n);
      if (n > 1) name = name.replace(/(\.[^.]+)?$/, `-${n}$1`);
      return { name, data: new Uint8Array(await r.blob.arrayBuffer()) };
    })
  );
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  saveBlob(buildZip(entries), `bgremoved-${date}.zip`);
}

// --- Minimal store-only ZIP writer (no dependency) ------------------------
// PNGs are already compressed, so entries are stored uncompressed (method 0).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const enc = new TextEncoder();
  const files = entries.map((e) => ({
    name: enc.encode(e.name),
    data: e.data,
    crc: crc32(e.data),
  }));

  let total = 22; // end-of-central-directory record
  for (const f of files) total += 30 + f.name.length + f.data.length; // local
  for (const f of files) total += 46 + f.name.length; // central directory

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  let off = 0;
  const offsets = [];

  for (const f of files) {
    offsets.push(off);
    view.setUint32(off, 0x04034b50, true); // local file header signature
    view.setUint16(off + 4, 20, true); // version needed
    view.setUint16(off + 6, 0, true); // flags
    view.setUint16(off + 8, 0, true); // method: store
    view.setUint16(off + 10, 0, true); // mod time
    view.setUint16(off + 12, 0, true); // mod date
    view.setUint32(off + 14, f.crc, true);
    view.setUint32(off + 18, f.data.length, true); // compressed size
    view.setUint32(off + 22, f.data.length, true); // uncompressed size
    view.setUint16(off + 26, f.name.length, true);
    view.setUint16(off + 28, 0, true); // extra length
    off += 30;
    out.set(f.name, off);
    off += f.name.length;
    out.set(f.data, off);
    off += f.data.length;
  }

  const cdStart = off;
  files.forEach((f, i) => {
    view.setUint32(off, 0x02014b50, true); // central directory header signature
    view.setUint16(off + 4, 20, true); // version made by
    view.setUint16(off + 6, 20, true); // version needed
    view.setUint16(off + 8, 0, true); // flags
    view.setUint16(off + 10, 0, true); // method
    view.setUint16(off + 12, 0, true); // mod time
    view.setUint16(off + 14, 0, true); // mod date
    view.setUint32(off + 16, f.crc, true);
    view.setUint32(off + 20, f.data.length, true);
    view.setUint32(off + 24, f.data.length, true);
    view.setUint16(off + 28, f.name.length, true);
    view.setUint16(off + 30, 0, true); // extra length
    view.setUint16(off + 32, 0, true); // comment length
    view.setUint16(off + 34, 0, true); // disk number start
    view.setUint16(off + 36, 0, true); // internal attrs
    view.setUint32(off + 38, 0, true); // external attrs
    view.setUint32(off + 42, offsets[i], true); // local header offset
    off += 46;
    out.set(f.name, off);
    off += f.name.length;
  });

  const cdSize = off - cdStart;
  view.setUint32(off, 0x06054b50, true); // EOCD signature
  view.setUint16(off + 4, 0, true); // disk number
  view.setUint16(off + 6, 0, true); // central dir start disk
  view.setUint16(off + 8, files.length, true); // entries on this disk
  view.setUint16(off + 10, files.length, true); // total entries
  view.setUint32(off + 12, cdSize, true);
  view.setUint32(off + 16, cdStart, true);
  view.setUint16(off + 20, 0, true); // comment length

  return new Blob([buf], { type: "application/zip" });
}

// Safety net: surface any uncaught error/rejection on the page instead of
// failing silently with only a console message.
window.addEventListener("error", (e) => {
  busy = false;
  setStatus(t("script_error", { msg: e.message }), true);
});
window.addEventListener("unhandledrejection", (e) => {
  busy = false;
  const reason = e.reason && e.reason.message ? e.reason.message : e.reason;
  setStatus(t("error_generic", { msg: reason }), true);
});

// --- Wire up the dropzone -------------------------------------------------

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => handleFiles(fileInput.files));

downloadAllBtn.addEventListener("click", downloadAll);

// Re-run the same images with the currently selected model/options.
rerunBtn.addEventListener("click", () => {
  if (lastFiles.length && !busy) handleFiles(lastFiles);
});

// When the model or options change after results exist, they are stale —
// highlight the re-run button and hint that it can be re-applied.
function markStale() {
  if (lastFiles.length && !busy) {
    rerunBtn.classList.add("attention");
    setStatus(t("settings_changed"));
  }
}
modelSelect.addEventListener("change", markStale);
backgroundSelect.addEventListener("change", markStale);
alphaMatting.addEventListener("change", markStale);

// Drag-and-drop is handled at the window level so that (a) the browser never
// hijacks the tab by opening a file dropped outside the small dropzone, and
// (b) a drop anywhere on the page is accepted. A depth counter avoids highlight
// flicker as the cursor crosses child elements during a drag.
let dragDepth = 0;

function setDragging(on) {
  dropzone.classList.toggle("dragover", on);
}

window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth += 1;
  setDragging(true);
});

window.addEventListener("dragover", (e) => {
  // Required for the drop event to fire (and to suppress the browser default).
  e.preventDefault();
});

window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragging(false);
});

// Extract File objects from a drop. Must run synchronously inside the event:
// dataTransfer (and items.getAsFile) are only valid during dispatch. Some
// platforms/browsers populate dataTransfer.items but not dataTransfer.files
// (or vice versa), so try both.
function filesFromDataTransfer(dt) {
  if (!dt) return [];
  if (dt.files && dt.files.length) return Array.from(dt.files);
  if (dt.items && dt.items.length) {
    const out = [];
    for (const item of dt.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
    return out;
  }
  return [];
}

window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  setDragging(false);
  const dt = e.dataTransfer;
  const files = filesFromDataTransfer(dt);
  if (files.length) {
    handleFiles(files);
    return;
  }

  // No File bytes in the drop. The common cause on Linux is dragging from a
  // file manager (e.g. GNOME Files / Nautilus) into Firefox: it transfers only
  // file paths ("text/uri-list"), and the browser won't read file:// contents
  // for security. There is no client-side way to recover the bytes — the file
  // picker is the reliable path. Report precisely so it isn't a silent mystery.
  const types = dt && dt.types ? Array.from(dt.types) : [];
  const pathOnlyDrag =
    types.includes("text/uri-list") ||
    types.includes("x-special/gnome-copied-files");
  if (pathOnlyDrag) {
    setStatus(t("drop_paths_only"), true);
  } else {
    setStatus(t("drop_no_file", { types: types.join(", ") || "none" }), true);
  }
});

// Allow pasting one or more images from the clipboard.
window.addEventListener("paste", (e) => {
  const imgs = [...(e.clipboardData?.items || [])]
    .filter((i) => i.type.startsWith("image/"))
    .map((i) => i.getAsFile())
    .filter(Boolean);
  if (imgs.length) handleFiles(imgs);
});
