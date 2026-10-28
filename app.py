from __future__ import annotations

import asyncio
import io
import os
from functools import lru_cache
from typing import Any

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from transformers import AutoImageProcessor, AutoModelForImageClassification

APP_NAME = "DermaScan AI"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MODEL_ID = os.getenv("DERMASCAN_MODEL_ID", "LaurianeMD/vit-skin-disease")

app = FastAPI(
    title=APP_NAME,
    description=(
        "Educational skin-image classification prototype. Predictions are experimental, "
        "not clinically validated, and must not be used for diagnosis or treatment."
    ),
    version="0.2.0",
)
app.mount("/static", StaticFiles(directory="static"), name="static")


class SymptomRequest(BaseModel):
    duration: str = Field(default="unknown", max_length=40)
    itching: bool = False
    pain: bool = False
    changing: bool = False
    bleeding_or_open_sore: bool = False
    fever_or_rapid_spread: bool = False
    notes: str = Field(default="", max_length=1000)


@lru_cache(maxsize=1)
def get_skin_model():
    """Load and cache the model once. First use downloads model files from Hugging Face."""
    processor = AutoImageProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForImageClassification.from_pretrained(MODEL_ID)
    model.to("cpu")
    model.eval()
    return processor, model


def classify_image(image_bytes: bytes) -> list[dict[str, Any]]:
    processor, model = get_skin_model()
    with Image.open(io.BytesIO(image_bytes)) as source:
        image = source.convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    with torch.inference_mode():
        logits = model(**inputs).logits
        scores = torch.softmax(logits, dim=-1)[0]
    top_scores, top_indices = torch.topk(scores, k=min(3, scores.shape[-1]))
    results = []
    for score, index in zip(top_scores.tolist(), top_indices.tolist()):
        label = model.config.id2label.get(index, f"Class {index}")
        results.append({"label": str(label), "score": round(float(score), 4)})
    return results


@app.get("/")
def home():
    return FileResponse("static/index.html")


@app.get("/health")
def health():
    return {"status": "ok", "app": APP_NAME, "model_configured": True, "model_id": MODEL_ID}


@app.post("/api/image-check")
async def image_check(image: UploadFile = File(...)):
    """Validate an uploaded image and run experimental model inference in memory."""
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Please upload a JPG, PNG, or WEBP image.")
    content = await image.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 8 MB or smaller.")
    try:
        with Image.open(io.BytesIO(content)) as im:
            im.verify()
        with Image.open(io.BytesIO(content)) as im:
            fmt = im.format
            width, height = im.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail="The uploaded file could not be read as an image.")
    if fmt not in ALLOWED_FORMATS:
        raise HTTPException(status_code=415, detail="Please upload a JPG, PNG, or WEBP image.")
    if width < 64 or height < 64:
        raise HTTPException(status_code=400, detail="Image resolution is too small; use at least 64 × 64 pixels.")

    try:
        predictions = await asyncio.to_thread(classify_image, content)
    except Exception as exc:
        # The app should not imply a prediction was made if model loading/inference failed.
        raise HTTPException(
            status_code=503,
            detail=("The AI model could not be loaded or run. Check your internet connection "
                    "for the first model download, then restart the server. Error: " + str(exc)[:300]),
        ) from exc

    return {
        "accepted": True,
        "filename": image.filename,
        "width": width,
        "height": height,
        "model_configured": True,
        "model_id": MODEL_ID,
        "predictions": predictions,
        "message": "Experimental model output generated. These labels are not a diagnosis.",
        "mode": "experimental_image_classification",
        "disclaimer": (
            "Educational/research use only. This model is not clinically validated and may be wrong, "
            "including across different skin tones, lighting, and image types. Do not use it to diagnose "
            "or choose treatment. Consult a qualified healthcare professional about skin concerns."
        ),
    }


@app.post("/api/symptom-summary")
def symptom_summary(data: SymptomRequest):
    """Rule-based safety guidance only; not a diagnostic classifier."""
    urgent = data.bleeding_or_open_sore or data.fever_or_rapid_spread
    prompt_review = data.changing or data.pain or data.duration in {"over_month", "2_4_weeks"}

    if urgent:
        urgency = "Seek prompt medical advice"
        explanation = (
            "Because you reported a bleeding/open sore or fever/rapid spread, please contact a healthcare "
            "professional promptly. If symptoms are severe or you feel acutely unwell, seek urgent local medical care."
        )
    elif prompt_review:
        urgency = "Arrange a clinician review"
        explanation = (
            "A changing, painful, or persistent skin concern should be assessed by a qualified healthcare professional. "
            "This questionnaire cannot identify its cause."
        )
    else:
        urgency = "Monitor and seek advice if concerned"
        explanation = (
            "This form cannot determine whether a skin concern is harmless. Arrange a professional assessment if it "
            "persists, worsens, changes, or worries you."
        )

    return {
        "mode": "rule_based_educational_guidance",
        "diagnosis": None,
        "disease_prediction": None,
        "urgency_label": urgency,
        "summary": explanation,
        "symptoms_recorded": {
            "duration": data.duration,
            "itching": data.itching,
            "pain": data.pain,
            "changing": data.changing,
            "bleeding_or_open_sore": data.bleeding_or_open_sore,
            "fever_or_rapid_spread": data.fever_or_rapid_spread,
            "notes_provided": bool(data.notes.strip()),
        },
        "disclaimer": (
            "Educational guidance only, not a diagnosis or a substitute for medical care. "
            "Image model outputs are experimental and not clinically validated."
        ),
    }
