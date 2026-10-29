
const imageInput = document.getElementById("skin-image");
const dropZone = document.getElementById("drop-zone");
const preview = document.getElementById("image-preview");
const placeholder = document.getElementById("upload-placeholder");
const imageMeta = document.getElementById("image-meta");
const imageStatus = document.getElementById("image-status");
const modelResults = document.getElementById("model-results");
const checkImageBtn = document.getElementById("check-image-btn");

let selectedFile = null;

function setStatus(message, error = false) {
  imageStatus.textContent = message;
  imageStatus.classList.toggle("error", error);
}

function clearResults() {
  modelResults.replaceChildren();
  modelResults.hidden = true;
  modelResults.style.display = "none";
}

function addText(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function selectImage(file) {
  if (!file) return;

  selectedFile = file;
  setStatus("");
  clearResults();

  preview.hidden = true;
  imageMeta.hidden = true;
  placeholder.hidden = false;

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    selectedFile = null;
    imageInput.value = "";
    setStatus("Please choose a JPG, PNG, or WEBP image.", true);
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    selectedFile = null;
    imageInput.value = "";
    setStatus("Image must be smaller than 8 MB.", true);
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    preview.src = reader.result;
    preview.hidden = false;
    placeholder.hidden = true;
    imageMeta.hidden = false;
    imageMeta.textContent =
      `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  };

  reader.onerror = () => {
    setStatus("Could not preview the image. Please try again.", true);
  };

  reader.readAsDataURL(file);
}

imageInput.addEventListener("change", event => {
  selectImage(event.target.files[0]);
});

["dragenter", "dragover"].forEach(type => {
  dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach(type => {
  dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  });
});

dropZone.addEventListener("drop", event => {
  selectImage(event.dataTransfer.files[0]);
});

function renderPredictions(data) {
  clearResults();

  modelResults.hidden = false;
  modelResults.style.display = "block";

  addText(
    modelResults,
    "h3",
    "",
    "AI Skin Image Analysis"
  );

  addText(
    modelResults,
    "p",
    "model-note",
    `Model: ${data.model_id || "Skin image classifier"}`
  );

  const predictions = Array.isArray(data.predictions)
    ? data.predictions
    : [];

  if (predictions.length === 0) {
    addText(
      modelResults,
      "p",
      "model-disclaimer",
      "The server accepted the image but returned no predictions. Check the backend and model configuration."
    );
    return;
  }

  addText(
    modelResults,
    "h4",
    "",
    "Top predicted categories"
  );

  const list = document.createElement("div");
  list.className = "prediction-list";

  predictions.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "prediction-row";

    const label = document.createElement("strong");
    label.textContent =
      `${index + 1}. ${item.label || "Unknown category"}`;

    const score = document.createElement("span");
    const rawScore = Number(item.score);

    if (Number.isFinite(rawScore)) {
      const percentage =
        rawScore >= 0 && rawScore <= 1
          ? rawScore * 100
          : rawScore;

      score.textContent =
        `${percentage.toFixed(1)}% model score`;
    } else {
      score.textContent = "Score unavailable";
    }

    row.append(label, score);
    list.appendChild(row);

    if (item.label) {
      const link = document.createElement("a");

      link.href =
        "https://pubmed.ncbi.nlm.nih.gov/?term=" +
        encodeURIComponent(item.label + " skin condition");

      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "reference-link";
      link.textContent =
        `Search scientific articles about ${item.label}`;

      list.appendChild(link);
    }
  });

  modelResults.appendChild(list);

  addText(
    modelResults,
    "h4",
    "",
    "About the results"
  );

  addText(
    modelResults,
    "p",
    "model-note",
    "These categories are experimental image-classifier predictions. They are not confirmed diagnoses. Similar skin conditions can look alike, and image quality, lighting, and skin tone can affect results."
  );

  addText(
    modelResults,
    "p",
    "model-disclaimer",
    data.disclaimer ||
      "Educational use only. Consult a qualified healthcare professional about skin concerns. Do not choose medication based on these predictions."
  );
}

checkImageBtn.addEventListener("click", async () => {
  if (!selectedFile) {
    setStatus("Please upload an image first.", true);
    return;
  }

  const originalText = checkImageBtn.textContent;
  checkImageBtn.disabled = true;
  checkImageBtn.textContent = "Analyzing image...";

  clearResults();

  try {
    const formData = new FormData();
    formData.append("image", selectedFile);

    const response = await fetch("/api/image-check", {
      method: "POST",
      body: formData
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Invalid server response (HTTP ${response.status}). Check PowerShell.`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.detail || `Image analysis failed (HTTP ${response.status}).`
      );
    }

    setStatus(
      `Image processed: ${data.width} × ${data.height}.`
    );

    renderPredictions(data);

    modelResults.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  } catch (error) {
    clearResults();

    modelResults.hidden = false;
    modelResults.style.display = "block";

    addText(
      modelResults,
      "h3",
      "",
      "Analysis could not be completed"
    );

    addText(
      modelResults,
      "p",
      "model-disclaimer",
      error.message ||
        "Could not connect to the server. Check that the backend is running."
    );

    setStatus(
      "Image analysis failed. See the message below.",
      true
    );
  } finally {
    checkImageBtn.disabled = false;
    checkImageBtn.textContent = originalText;
  }
});

document
  .getElementById("symptom-form")
  .addEventListener("submit", async event => {
    event.preventDefault();

    const form = event.currentTarget;

    const payload = {
      duration: form.duration.value,
      itching: form.itching.checked,
      pain: form.pain.checked,
      changing: form.changing.checked,
      bleeding_or_open_sore:
        form.bleeding_or_open_sore.checked,
      fever_or_rapid_spread:
        form.fever_or_rapid_spread.checked,
      notes: form.notes.value
    };

    const button = form.querySelector(
      'button[type="submit"]'
    );

    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = "Preparing summary...";

    try {
      const response = await fetch("/api/symptom-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Could not generate summary."
        );
      }

      document.getElementById("result-urgency").textContent =
        data.urgency_label || "Educational guidance";

      document.getElementById("result-summary").textContent =
        data.summary || "No summary was returned.";

      document.getElementById("result-disclaimer").textContent =
        data.disclaimer || "";

      const result = document.getElementById("results");
      result.hidden = false;

      document.getElementById("step-number").textContent = "02";

      result.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    } catch (error) {
      alert(error.message || "Could not contact the server.");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

document.getElementById("reset-btn").addEventListener("click", () => {
  document.getElementById("symptom-form").reset();
  document.getElementById("results").hidden = true;
  document.getElementById("step-number").textContent = "01";

  imageInput.value = "";
  selectedFile = null;

  clearResults();

  preview.hidden = true;
  preview.removeAttribute("src");

  placeholder.hidden = false;
  imageMeta.hidden = true;

  setStatus("");

  document.getElementById("screening").scrollIntoView({
    behavior: "smooth"
  });
});

/* ===== DermaScan AI: interactive dashboard upgrade ===== */
(() => {
  const cards = [...document.querySelectorAll(".stat-card")];
  const screening = document.getElementById("screening");
  const imageInput = document.getElementById("skin-image");
  const symptomForm = document.getElementById("symptom-form");

  if (!cards.length) return;

  // Add accessible, clickable behavior to all four dashboard cards.
  cards.forEach((card, index) => {
    const actions = [
      () => {
        screening?.scrollIntoView({ behavior: "smooth" });
        setTimeout(() => imageInput?.click(), 450);
      },
      () => {
        screening?.scrollIntoView({ behavior: "smooth" });
        setTimeout(() => {
          document.getElementById("duration")?.focus();
        }, 450);
      },
      () => showAIStatus(),
      () => showRecords()
    ];

    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${card.querySelector(".stat-label")?.textContent || "dashboard feature"}`);
    card.style.cursor = "pointer";
    card.style.transition = "transform 180ms ease, border-color 180ms ease";

    card.addEventListener("mouseenter", () => {
      card.style.transform = "translateY(-3px)";
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });

    card.addEventListener("click", actions[index] || (() => {}));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        actions[index]?.();
      }
    });
  });

  // Create a reusable interactive dialog.
  function openDialog(title, description) {
    document.getElementById("ds-interactive-dialog")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "ds-interactive-dialog";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
      display: "grid",
      placeItems: "center",
      padding: "20px",
      background: "rgba(3, 8, 20, .78)",
      backdropFilter: "blur(8px)"
    });

    const panel = document.createElement("section");
    Object.assign(panel.style, {
      width: "min(100%, 480px)",
      padding: "26px",
      borderRadius: "18px",
      background: "#111a2b",
      border: "1px solid #304057",
      color: "#f3f7ff",
      boxShadow: "0 24px 80px rgba(0,0,0,.4)"
    });
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "ds-dialog-title");

    const heading = document.createElement("h2");
    heading.id = "ds-dialog-title";
    heading.textContent = title;
    heading.style.marginTop = "0";

    const body = document.createElement("p");
    body.textContent = description;
    body.style.lineHeight = "1.7";
    body.style.color = "#c1cde0";

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      gap: "10px",
      flexWrap: "wrap",
      marginTop: "22px"
    });

    function addButton(label, callback, primary = false) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      Object.assign(button.style, {
        padding: "11px 16px",
        borderRadius: "10px",
        border: "1px solid #40516b",
        cursor: "pointer",
        fontWeight: "600",
        background: primary ? "#35c7b0" : "#1c2940",
        color: primary ? "#07131a" : "#f3f7ff"
      });
      button.addEventListener("click", callback);
      actions.appendChild(button);
      return button;
    }

    addButton("Close", () => overlay.remove());
    panel.append(heading, body, actions);
    overlay.appendChild(panel);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) overlay.remove();
    });
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") overlay.remove();
    });
    document.body.appendChild(overlay);
    panel.querySelector("button")?.focus();

    return { overlay, panel, body, actions, addButton };
  }

  // AI card: check the API, but don't confuse API health with model readiness.
  async function showAIStatus() {
    const dialog = openDialog(
      "AI inference status",
      "Checking whether the DermaScan backend is responding…"
    );

    const status = document.createElement("p");
    status.style.lineHeight = "1.6";
    dialog.panel.insertBefore(status, dialog.actions);

    const testButton = dialog.addButton("Check backend again", async () => {
      testButton.disabled = true;
      testButton.textContent = "Checking…";
      await checkHealth(status);
      testButton.disabled = false;
      testButton.textContent = "Check backend again";
    }, true);

    await checkHealth(status);
  }

  async function checkHealth(target) {
    target.textContent = "Contacting /health…";
    try {
      const response = await fetch("/health", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      target.textContent =
        `Backend: ${data.status || "responding"}. ` +
        `Configured model: ${data.model_configured ? data.model_id || "Yes" : "Not configured"}. ` +
        "This health check does not prove that model weights have loaded or that image inference succeeds. " +
        "Use Analyze Image to test the full workflow.";
    } catch (error) {
      target.textContent =
        `Backend check failed: ${error.message}. Check the Render service and runtime logs.`;
    }
  }

  // Patient records: provide a session-only summary, never a fake database.
  function showRecords() {
    const dialog = openDialog(
      "Session summary",
      "This prototype does not save patient records to a database. You can export the information currently entered in this browser session."
    );

    dialog.addButton("Export current summary", () => {
      const form = symptomForm;
      const checked = form
        ? [...form.querySelectorAll('input[type="checkbox"]:checked')]
            .map(input => input.parentElement?.innerText.trim() || input.name)
        : [];

      const duration = form?.elements.duration?.selectedOptions[0]?.textContent || "Not entered";
      const notes = form?.elements.notes?.value.trim() || "No notes entered";
      const file = imageInput?.files?.[0];

      const content = [
        "DERMASCAN AI — SESSION SUMMARY",
        "Educational prototype only — NOT A DIAGNOSIS",
        "",
        `Generated: ${new Date().toLocaleString()}`,
        `Image selected in this session: ${file ? file.name : "No"}`,
        `Concern duration: ${duration}`,
        `Reported symptoms: ${checked.length ? checked.join(", ") : "None selected"}`,
        `Notes: ${notes}`,
        "",
        "This file is generated locally from the current form. It is not a medical record or a validated clinical assessment."
      ].join("\n");

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "dermascan-session-summary.txt";
      link.click();
      URL.revokeObjectURL(url);
      dialog.overlay.remove();
    }, true);
  }

  // Keep the sidebar navigation responsive and highlight the active section.
  const navLinks = [...document.querySelectorAll(".nav-item[href^='#']")];
  navLinks.forEach(link => {
    link.addEventListener("click", () => {
      navLinks.forEach(item => item.classList.remove("active"));
      link.classList.add("active");
    });
  });

  // Make the demo status label respond to the real health endpoint.
  const statusCard = document.querySelector(".status-card");
  if (statusCard) {
    statusCard.title = "Click to check the backend";
    statusCard.style.cursor = "pointer";
    statusCard.addEventListener("click", showAIStatus);
    statusCard.setAttribute("role", "button");
    statusCard.tabIndex = 0;
    statusCard.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showAIStatus();
      }
    });
  }
})();

