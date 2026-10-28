
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
