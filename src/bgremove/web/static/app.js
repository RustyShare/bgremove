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
const overlay = document.getElementById("overlay");

// Track object URLs so we can revoke them and avoid leaking memory.
let originalUrl = null;
let resultUrl = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
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

  // Show the original immediately.
  revoke(originalUrl);
  originalUrl = URL.createObjectURL(file);
  originalImg.src = originalUrl;
  results.hidden = false;
  downloadLink.hidden = true;
  resultImg.removeAttribute("src");
  setStatus("");

  const form = new FormData();
  form.append("file", file);
  form.append("model", modelSelect.value);
  form.append("alpha_matting", alphaMatting.checked ? "true" : "false");

  overlay.hidden = false;
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
    overlay.hidden = true;
  }
}

// --- Wire up the dropzone -------------------------------------------------

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

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
