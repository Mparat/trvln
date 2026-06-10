import os
import subprocess
import tempfile
import requests
import uuid
from concurrent.futures import ThreadPoolExecutor
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


def upload_frame(path: str) -> str | None:
    file_name = f"social/frames/{uuid.uuid4()}.jpg"
    with open(path, "rb") as f:
        resp = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/inspiration-media/{file_name}",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "image/jpeg",
            },
            data=f,
            timeout=30,
        )
    if not resp.ok:
        return None
    return f"{SUPABASE_URL}/storage/v1/object/public/inspiration-media/{file_name}"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract")
def extract_video(req: ExtractRequest):
    if not is_supported_url(req.url):
        raise HTTPException(status_code=400, detail="Only TikTok and Instagram URLs are supported")

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "video.mp4")

        # Download video (low resolution is fine — we only need frames)
        dl = subprocess.run(
            [
                "yt-dlp",
                "--no-playlist",
                "-f", "b[height<=480]/b[height<=720]/b",
                "--merge-output-format", "mp4",
                "--no-warnings",
                "-o", video_path,
                req.url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )

        if dl.returncode != 0 or not os.path.exists(video_path):
            error_msg = dl.stderr.strip().split("\n")[-1] if dl.stderr else "Unknown error"
            raise HTTPException(status_code=400, detail=f"Could not download video: {error_msg}")

        # Extract 5 frames with ffmpeg using select filter (fast, no full decode)
        frames_dir = os.path.join(tmpdir, "frames")
        os.makedirs(frames_dir)
        frame_pattern = os.path.join(frames_dir, "frame_%d.jpg")

        ffmpeg = subprocess.run(
            [
                "ffmpeg", "-i", video_path,
                "-vf", "select='eq(n\\,0)+eq(n\\,round(n_frames/4))+eq(n\\,round(n_frames/2))+eq(n\\,round(3*n_frames/4))+eq(n\\,n_frames-1)',scale=720:-2",
                "-vsync", "vfr",
                "-q:v", "3",
                frame_pattern,
                "-y",
            ],
            capture_output=True,
            timeout=60,
        )

        frame_paths = sorted([
            os.path.join(frames_dir, f)
            for f in os.listdir(frames_dir)
            if f.endswith(".jpg")
        ])

        if not frame_paths:
            # Fallback: grab frames at fixed timestamps
            for i, ts in enumerate(["00:00:01", "00:00:03", "00:00:05"]):
                out = os.path.join(frames_dir, f"frame_{i+1}.jpg")
                subprocess.run(
                    ["ffmpeg", "-ss", ts, "-i", video_path, "-vframes", "1", "-q:v", "3", out, "-y"],
                    capture_output=True, timeout=30,
                )
            frame_paths = sorted([
                os.path.join(frames_dir, f)
                for f in os.listdir(frames_dir)
                if f.endswith(".jpg")
            ])

        if not frame_paths:
            raise HTTPException(status_code=500, detail="Failed to extract frames from video")

        # Upload all frames in parallel
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(upload_frame, frame_paths))

        frame_urls = [u for u in results if u]

        if not frame_urls:
            raise HTTPException(status_code=500, detail="Failed to upload frames")

        return {"frameUrls": frame_urls, "thumbnailUrl": frame_urls[0]}
