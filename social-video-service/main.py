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
INSTAGRAM_COOKIES = os.environ.get("INSTAGRAM_COOKIES")

SUPPORTED_DOMAINS = [
    "tiktok.com", "vm.tiktok.com",
    "instagram.com", "www.instagram.com",
]


class ExtractRequest(BaseModel):
    url: str


BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def is_supported_url(url: str) -> bool:
    return any(domain in url for domain in SUPPORTED_DOMAINS)


def is_instagram_url(url: str) -> bool:
    return "instagram.com" in url


def _summarize_ytdlp_error(stderr: str, url: str) -> str:
    """Map common yt-dlp failure modes to clear, user-facing messages."""
    text = (stderr or "").lower()

    if "login required" in text or "requires authentication" in text or "log in" in text:
        if is_instagram_url(url):
            return (
                "Instagram requires login to view this video. It may be private, "
                "age-restricted, or rate-limited. Set INSTAGRAM_COOKIES to import it."
            )
        return "This video requires login to view."

    if "private" in text:
        return "This video is private and cannot be imported."

    if "unable to extract" in text or "unsupported url" in text:
        return "Could not read this video — the link format may have changed or is unsupported."

    if "404" in text or "not found" in text or "does not exist" in text:
        return "This video no longer exists or the link is invalid."

    return stderr.strip().split("\n")[-1] if stderr else "Unknown error"


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


FRAME_COUNT = 5


def probe_duration(video_path: str) -> float | None:
    """Video duration in seconds via ffprobe, or None if it can't be read."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            capture_output=True, text=True, timeout=30,
        )
        duration = float(out.stdout.strip())
        return duration if duration > 0 else None
    except (ValueError, subprocess.TimeoutExpired):
        return None


def frame_timestamps(duration: float | None, count: int = FRAME_COUNT) -> list[float]:
    """Evenly spaced timestamps at the centre of `count` equal segments
    (10%, 30%, 50%, 70%, 90% for 5), skipping the first and last instants,
    which are often black frames, title cards or end screens."""
    if not duration:
        # Unknown length: sample the opening seconds, where something is
        # almost certainly on screen.
        return [0.5, 1.5, 2.5, 3.5, 4.5][:count]
    return [duration * (i + 0.5) / count for i in range(count)]


def extract_frame(video_path: str, ts: float, out: str) -> str | None:
    # -ss before -i seeks by keyframe without decoding the whole video
    subprocess.run(
        [
            "ffmpeg", "-ss", f"{ts:.3f}", "-i", video_path,
            "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3",
            out, "-y",
        ],
        capture_output=True, timeout=30,
    )
    return out if os.path.exists(out) and os.path.getsize(out) > 0 else None


def extract_frames(video_path: str, frames_dir: str) -> list[str]:
    timestamps = frame_timestamps(probe_duration(video_path))
    outs = [os.path.join(frames_dir, f"frame_{i + 1}.jpg") for i in range(len(timestamps))]
    with ThreadPoolExecutor(max_workers=len(timestamps)) as pool:
        results = list(pool.map(lambda a: extract_frame(video_path, *a), zip(timestamps, outs)))
    return [p for p in results if p]


@app.get("/health")
def health():
    # Report the running yt-dlp version so a deploy can be verified from the
    # browser (whether this build has the current extractor + import fix).
    try:
        from yt_dlp.version import __version__ as ytdlp_version
    except Exception:
        ytdlp_version = "unknown"
    return {
        "status": "ok",
        "ytdlp_version": ytdlp_version,
        "instagram_cookies_configured": bool(INSTAGRAM_COOKIES),
    }


@app.post("/extract")
def extract_video(req: ExtractRequest):
    if not is_supported_url(req.url):
        raise HTTPException(status_code=400, detail="Only TikTok and Instagram URLs are supported")

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "video.mp4")

        # Download video (low resolution is fine — we only need frames)
        cmd = [
            "yt-dlp",
            "--no-playlist",
            "-f", "b[height<=480]/b[height<=720]/b",
            "--merge-output-format", "mp4",
            "--no-warnings",
            "--user-agent", BROWSER_USER_AGENT,
            "-o", video_path,
        ]

        # Instagram often requires authentication — pass cookies if provided
        if INSTAGRAM_COOKIES and is_instagram_url(req.url):
            cookie_path = os.path.join(tmpdir, "cookies.txt")
            with open(cookie_path, "w") as cf:
                cf.write(INSTAGRAM_COOKIES)
            cmd += ["--cookies", cookie_path]

        cmd.append(req.url)

        try:
            dl = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Video download timed out")

        if dl.returncode != 0 or not os.path.exists(video_path):
            error_msg = _summarize_ytdlp_error(dl.stderr, req.url)
            raise HTTPException(status_code=400, detail=f"Could not download video: {error_msg}")

        frames_dir = os.path.join(tmpdir, "frames")
        os.makedirs(frames_dir)
        frame_paths = extract_frames(video_path, frames_dir)

        if not frame_paths:
            raise HTTPException(status_code=500, detail="Failed to extract frames from video")

        # Upload all frames in parallel
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(upload_frame, frame_paths))

        frame_urls = [u for u in results if u]

        if not frame_urls:
            raise HTTPException(status_code=500, detail="Failed to upload frames")

        return {"frameUrls": frame_urls, "thumbnailUrl": frame_urls[0]}
