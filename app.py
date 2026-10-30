
from __future__ import annotations

import asyncio
import io
import os
from functools import lru_cache
from typing import Any

import torch
from torchvision import models, transforms
from huggingface_hub import hf_hub_download
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

APP_NAME = "DermaScan AI"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

HF_REPO_ID = "SRTxVIPER/dermascan-skin-cnn"
MODEL_FILENAME = "skin_cnn.pth"

app = FastAPI(
    title=APP_NAME,
    description=(
        "Educational skin-image classification prototype. "
        "Predictions are experimental and not clinically validated."
    ),
    version="1.0.0",
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
    """Download and load the trained ResNet18 checkpoint."""

    checkpoint_path = hf_hub_download(
        repo_id=HF_REPO_ID,
        filename=MODEL_FILENAME,
    )

    checkpoint = torch.load(
        checkpoint_path,
        map_location="cpu",
        weights_only=False,
    )

    class_names = checkpoint["class_names"]
    num_classes = checkpoint["num_classes"]

    model = models.resnet18(weights=None)
    model.fc = torch.nn.Linear(
        model.fc.in_features,
        num_classes,
    )

    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    image_size = checkpoint.get("image_size", 224)
    mean = checkpoint.get("mean", [0.485, 0.456, 0.406])
    std = checkpoint.get("std", [0.229, 0.224, 0.225])

    image_transform = transforms.Compose([
        transforms.Resize((image_size, image_size)),
        transforms.ToTensor(),
        transforms.Normalize(mean=mean, std=std),
    ])

    return model, class_names, image_transform


def classify_image(image_bytes: bytes) -> list[dict[str, Any]]:
    model, class_names, image_transform = get_skin_model()

    with Image.open(io.BytesIO(image_bytes)) as source:
        image = source.convert("RGB")

    tensor = image_transform(image).unsqueeze(0)

    with torch.inference_mode():
        logits = model(tensor)
        scores = torch.softmax(logits, dim=1)[0]

    top_scores, top_indices = torch.topk(
        scores,
        k=min(3, len(class_names)),
    )

    results = []

    for score, index in zip(
        top_scores.tolist(),
        top_indices.tolist(),
    ):
        results.append({
            "label": str(class_names[index]),
            "score": round(float(score), 4),
        })

    return results


@app.get("/")
def home():
    return FileResponse("static/index.html")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "app": APP_NAME,
        "model_configured": True,
        "model_repo": HF_REPO_ID,
    }


@app.post("/api/image-check")
async def image_check(image: UploadFile = File(...)):

    if image.content_type not in {
        "image/jpeg",
        "image/png",
        "image/webp",
    }:
        raise HTTPException(
            status_code=415,
            detail="Please upload a JPG, PNG, or WEBP image.",
        )

    content = await image.read(MAX_IMAGE_BYTES + 1)

    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image must be 8 MB or smaller.",
        )

    try:
        with Image.open(io.BytesIO(content)) as im:
            im.verify()

        with Image.open(io.BytesIO(content)) as im:
            fmt = im.format
            width, height = im.size

    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
    ):
        raise HTTPException(
            status_code=400,
            detail="The uploaded file could not be read as an image.",
        )

    if fmt not in ALLOWED_FORMATS:
        raise HTTPException(
            status_code=415,
            detail="Please upload a JPG, PNG, or WEBP image.",
        )

    if width < 64 or height < 64:
        raise HTTPException(
            status_code=400,
            detail="Image resolution is too small; use at least 64 × 64 pixels.",
        )

    try:
        predictions = await asyncio.to_thread(
            classify_image,
            content,
        )

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "The CNN model could not be loaded or run. "
                "Check the Hugging Face repository, checkpoint filename, "
                "and Render logs. Error: " + str(exc)[:300]
            ),
        ) from exc

    return {
        "accepted": True,
        "filename": image.filename,
        "width": width,
        "height": height,
        "model_configured": True,
        "model_id": HF_REPO_ID,
        "predictions": predictions,
        "message": (
            "Experimental CNN output generated. "
            "These labels are not a diagnosis."
        ),
        "mode": "experimental_resnet18_classification",
        "disclaimer": (
            "Educational and research use only. This model is not clinically "
            "validated and may be wrong. Do not use its output to diagnose "
            "a condition or choose treatment. Consult a qualified healthcare "
            "professional about skin concerns."
        ),
    }


@app.post("/api/symptom-summary")
def symptom_summary(data: SymptomRequest):

    urgent = (
        data.bleeding_or_open_sore
        or data.fever_or_rapid_spread
    )

    prompt_review = (
        data.changing
        or data.pain
        or data.duration in {"over_month", "2_4_weeks"}
    )

    if urgent:
        urgency = "Seek prompt medical advice"
        explanation = (
            "Because you reported a bleeding/open sore or fever/rapid spread, "
            "please contact a healthcare professional promptly. "
            "If symptoms are severe, seek urgent local medical care."
        )

    elif prompt_review:
        urgency = "Arrange a clinician review"
        explanation = (
            "A changing, painful, or persistent skin concern should be "
            "assessed by a qualified healthcare professional. "
            "This questionnaire cannot identify its cause."
        )

    else:
        urgency = "Monitor and seek advice if concerned"
        explanation = (
            "This form cannot determine whether a skin concern is harmless. "
            "Arrange a professional assessment if it persists, worsens, "
            "changes, or worries you."
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
            "Educational guidance only, not a diagnosis or a substitute "
            "for medical care. Image model outputs are experimental."
        ),
    }
