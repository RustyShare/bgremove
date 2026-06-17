"use strict";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const modelSelect = document.getElementById("model");
const alphaMatting = document.getElementById("alpha-matting");
const results = document.getElementById("results");
const originalImg = document.getElementById("original");
const resultImg = document.getElementById("result");
const downloadLink = document.getElementById("download");
const statusEl = document.getElementById("status");
const spinner = document.getElementById("spinner");
const rerunBtn = document.getElementById("rerun");

// Track object URLs so we can revoke them and avoid leaking memory.
let originalUrl = null;
let resultUrl = null;
let elapsedTimer = null;
let busy = false;
// The most recently uploaded image, kept so the model/options can be changed
// and re-applied to the same picture without re-uploading.
let lastFile = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

// Inline progress: a spinner in the result panel + an elapsing status line.
// There is no modal — the rest of the UI stays fully interactive.
function startProgress() {
  if (spinner) spinner.hidden = false;
  let seconds = 0;
  setStatus("Removing background… 0s");
  elapsedTimer = setInterval(() => {
    seconds += 1;
    setStatus(`Removing background… ${seconds}s`);
  }, 1000);
}

function stopProgress() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  if (spinner) spinner.hidden = true;
}

function revoke(url) {
  if (url) URL.revokeObjectURL(url);
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setStatus("Please choose an image file.", true);
    return;
  }
  if (busy) {
    setStatus("Still working on the previous image — please wait.", true);
    return;
  }

  // Remember this image so it can be re-run with a different model/options, and
  // enable the re-run button (clearing any "stale" highlight for a fresh run).
  lastFile = file;
  if (rerunBtn) {
    rerunBtn.disabled = false;
    rerunBtn.classList.remove("attention");
  }

  // Show the original immediately.
  revoke(originalUrl);
  originalUrl = URL.createObjectURL(file);
  originalImg.src = originalUrl;
  results.hidden = false;
  downloadLink.hidden = true;
  resultImg.removeAttribute("src");

  const form = new FormData();
  form.append("file", file);
  form.append("model", modelSelect.value);
  form.append("alpha_matting", alphaMatting.checked ? "true" : "false");

  busy = true;
  startProgress();
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
    revoke(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    resultImg.src = resultUrl;
    downloadLink.href = resultUrl;
    const base = file.name.replace(/\.[^.]+$/, "") || "cutout";
    downloadLink.setAttribute("download", `${base}-nobg.png`);
    downloadLink.hidden = false;
    setStatus("Done.");
  } catch (err) {
    setStatus(`Failed: ${err.message}`, true);
  } finally {
    stopProgress();
    busy = false;
  }
}

// Safety net: surface any uncaught error/rejection on the page instead of
// failing silently with only a console message.
window.addEventListener("error", (e) => {
  stopProgress();
  busy = false;
  setStatus(`Script error: ${e.message}`, true);
});
window.addEventListener("unhandledrejection", (e) => {
  stopProgress();
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

fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

// Re-run the same image with the currently selected model/options.
rerunBtn.addEventListener("click", () => {
  if (lastFile && !busy) handleFile(lastFile);
});

// When the model or options change after a result exists, the shown cutout is
// stale — highlight the re-run button and hint that it can be re-applied.
function markStale() {
  if (lastFile && !busy) {
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
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  handleFile(file);
});

// Allow pasting an image from the clipboard.
window.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) =>
    i.type.startsWith("image/")
  );
  if (item) handleFile(item.getAsFile());
});
