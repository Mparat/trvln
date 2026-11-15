import os
import re
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


# Frames per video: at least MIN_FRAMES, and for quick-cut montages one per
# scene up to MAX_FRAMES. analyze-inspiration takes 20 images per request
# across all imported videos, so keep this well under 20.
MIN_FRAMES = 5
MAX_FRAMES = 10
# ffmpeg scene score (0-1) above which a frame counts as a cut
SCENE_THRESHOLD = 0.2
# Shots shorter than this are merged into the next one (flashes, transitions)
MIN_SCENE_SECONDS = 0.4


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


def detect_scene_cuts(video_path: str) -> list[float]:
    """Timestamps (seconds) where the picture changes to a new shot.
    Runs on a 160px-wide copy so a full decode stays fast; returns [] if
    detection fails, which falls back to evenly spaced frames."""
    try:
        out = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-i", video_path, "-an",
                "-vf", f"scale=160:-2,select='gt(scene\\,{SCENE_THRESHOLD})',showinfo",
                "-f", "null", "-",
            ],
            capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        return []
    return sorted(
        float(m) for m in re.findall(r"Parsed_showinfo.*?pts_time:\s*([\d.]+)", out.stderr)
    )


def scene_segments(duration: float, cuts: list[float]) -> list[tuple[float, float]]:
    """Split [0, duration] at the cuts, merging shots under MIN_SCENE_SECONDS."""
    bounds = [0.0]
    for cut in cuts:
        if cut - bounds[-1] >= MIN_SCENE_SECONDS and duration - cut >= MIN_SCENE_SECONDS:
            bounds.append(cut)
    bounds.append(duration)
    return list(zip(bounds, bounds[1:]))


def frame_timestamps(duration: float | None, cuts: list[float] | None = None) -> list[float]:
    """Pick when to grab frames.

    - Unknown length: the opening seconds, where something is surely on screen.
    - Many shots (quick-cut montage): the middle of each shot, so every clip is
      seen once; past MAX_FRAMES shots, an even spread of them.
    - Few shots (incl. one continuous take): MIN_FRAMES frames shared across the
      shots by length, every shot getting at least one, each placed at the
      centre of an equal slice of its shot (so never the first/last instant,
      which is often a black frame, title card or end screen).
    """
    if not duration:
        return [0.5, 1.5, 2.5, 3.5, 4.5][:MIN_FRAMES]

    segments = scene_segments(duration, cuts or [])
    n = len(segments)

    if n > MAX_FRAMES:
        segments = [segments[int((i + 0.5) * n / MAX_FRAMES)] for i in range(MAX_FRAMES)]
        n = MAX_FRAMES

    alloc = [1] * n
    for _ in range(MIN_FRAMES - n):
        # give the next frame to the shot with the longest gap per frame
        k = max(range(n), key=lambda i: (segments[i][1] - segments[i][0]) / alloc[i])
        alloc[k] += 1

    return [
        start + (end - start) * (j + 0.5) / count
        for (start, end), count in zip(segments, alloc)
        for j in range(count)
    ]


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
    duration = probe_duration(video_path)
    cuts = detect_scene_cuts(video_path) if duration else []
    timestamps = frame_timestamps(duration, cuts)
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
