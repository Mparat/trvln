import os
import subprocess
import tempfile
import requests
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

SUPPORTED_DOMAINS = [
    "tiktok.com", "vm.tiktok.com",
    "instagram.com", "www.instagram.com",
]


class ExtractRequest(BaseModel):
    url: str


def is_supported_url(url: str) -> bool:
    return any(domain in url for domain in SUPPORTED_DOMAINS)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract")
def extract_video(req: ExtractRequest):
    if not is_supported_url(req.url):
        raise HTTPException(status_code=400, detail="Only TikTok and Instagram URLs are supported")

    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "video.mp4")

        result = subprocess.run(
            [
                "yt-dlp",
                "--no-playlist",
                "-f", "b[height<=720]/b",
                "--merge-output-format", "mp4",
                "--no-warnings",
                "-o", output_path,
                req.url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip().split("\n")[-1] if result.stderr else "Unknown error"
            raise HTTPException(status_code=400, detail=f"Could not download video: {error_msg}")

        if not os.path.exists(output_path):
            raise HTTPException(status_code=400, detail="Video download produced no output")

        file_size = os.path.getsize(output_path)
        if file_size > 100 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Video is too large (max 100MB)")

        file_name = f"social/{uuid.uuid4()}.mp4"

        with open(output_path, "rb") as f:
            upload_response = requests.post(
                f"{SUPABASE_URL}/storage/v1/object/inspiration-media/{file_name}",
                headers={
                    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                    "Content-Type": "video/mp4",
                },
                data=f,
                timeout=60,
            )

        if not upload_response.ok:
            raise HTTPException(status_code=500, detail="Failed to upload video to storage")

        public_url = f"{SUPABASE_URL}/storage/v1/object/public/inspiration-media/{file_name}"
        return {"url": public_url}
