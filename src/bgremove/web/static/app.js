"use strict";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const modelSelect = document.getElementById("model");
const alphaMatting = document.getElementById("alpha-matting");
const statusEl = document.getElementById("status");
const rerunBtn = document.getElementById("rerun");
const gallery = document.getElementById("gallery");
const cardTemplate = document.getElementById("card-template");
const batchActions = document.getElementById("batch-actions");
const downloadAllBtn = document.getElementById("download-all");

let busy = false;
// The most recently selected images, kept so the model/options can be changed
// and re-applied to the same set without re-uploading.
let lastFiles = [];
// Object URLs created for results, tracked so they can be revoked on a new run.
let resultUrls = [];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
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
  cardStatus.textContent = "Removing background…";
  cardStatus.classList.remove("error");

  const form = new FormData();
  form.append("file", file);
  form.append("model", modelSelect.value);
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
    download.href = url;
    download.setAttribute("download", `${base}-nobg.png`);
    download.hidden = false;
    cardStatus.textContent = "Done.";
    return true;
  } catch (err) {
    cardStatus.textContent = `Failed: ${err.message}`;
    cardStatus.classList.add("error");
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
    setStatus("Please choose one or more image files.", true);
    return;
  }
  if (busy) {
    setStatus("Still working on the previous batch — please wait.", true);
    return;
  }

  lastFiles = files;
  if (rerunBtn) {
    rerunBtn.disabled = false;
    rerunBtn.classList.remove("attention");
  }

  // Reset the gallery for this run.
  revokeResults();
  gallery.innerHTML = "";
  gallery.hidden = false;
  batchActions.hidden = true;
  downloadAllBtn.disabled = true;

  const cards = files.map((file) => ({ file, card: makeCard(file) }));

  busy = true;
  let done = 0;
  let ok = 0;
  const single = files.length === 1;
  setStatus(single ? "Removing background…" : `Processing 0/${files.length}…`);
  try {
    // Sequential, like the CLI's batch command — predictable progress and it
    // doesn't pile work onto the single-worker server.
    for (const { file, card } of cards) {
      const success = await processOne(file, card);
      done += 1;
      if (success) ok += 1;
      if (!single) setStatus(`Processing ${done}/${files.length}…`);
    }
    const failed = done - ok;
    setStatus(
      single
        ? ok
          ? "Done."
          : "Failed — see the card below."
        : `Done: ${ok} succeeded${failed ? `, ${failed} failed` : ""}.`,
      single && !ok
    );
    if (ok > 0) {
      downloadAllBtn.disabled = false;
      downloadAllBtn.textContent =
        ok === 1 ? "Download" : `Download all (${ok})`;
      batchActions.hidden = false;
    }
  } finally {
    busy = false;
  }
}

// Trigger a download for each successfully-processed card.
function downloadAll() {
  const links = gallery.querySelectorAll(".card-download:not([hidden])");
  links.forEach((link, i) => {
    // Stagger slightly so the browser doesn't drop near-simultaneous downloads.
    setTimeout(() => link.click(), i * 200);
  });
}

// Safety net: surface any uncaught error/rejection on the page instead of
// failing silently with only a console message.
window.addEventListener("error", (e) => {
  busy = false;
  setStatus(`Script error: ${e.message}`, true);
});
window.addEventListener("unhandledrejection", (e) => {
  busy = false;
  const reason = e.reason && e.reason.message ? e.reason.message : e.reason;
  setStatus(`Error: ${reason}`, true);
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
    setStatus("Settings changed — click “Re-run” to apply.");
  }
}
modelSelect.addEventListener("change", markStale);
alphaMatting.addEventListener("change", markStale);

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);

["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);

dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    handleFiles(e.dataTransfer.files);
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
