import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { Upload, X, Image as ImageIcon, Video, Loader2, Link } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface MediaItem {
  type: 'image' | 'video';
  file?: File;
  preview?: string;
  url?: string; // Public URL from storage
  uploading?: boolean;
  frameUrls?: string[]; // Extracted video frames for AI analysis
}

interface MediaDropZoneProps {
  media: MediaItem[];
  onMediaChange: (media: MediaItem[]) => void;
  onFramesReady?: (frameUrls: string[]) => void;
}

export interface MediaDropZoneHandle {
  processFiles: (files: File[]) => Promise<void>;
  addUrl: (url: string) => Promise<void>;
}

// Pull every TikTok/Instagram link out of free-form text (multiple links may be
// separated by spaces, commas, newlines — or nothing at all when a paste into a
// single-line input collapses line breaks and concatenates URLs).
const extractSocialUrls = (text: string): string[] => {
  const spaced = text.replace(/https?:\/\//g, ' $&');
  const matches = spaced.match(/https?:\/\/[^\s,]+/g) || [];
  const urls = matches
    .map(u => u.replace(/[.,;)\]]+$/, '')) // strip trailing punctuation
    .filter(u => u.includes('tiktok.com') || u.includes('instagram.com'));
  return [...new Set(urls)];
};

export const MediaDropZone = forwardRef<MediaDropZoneHandle, MediaDropZoneProps & { compact?: boolean }>(
  ({ media, onMediaChange, onFramesReady, compact }, ref) => {
  const [isDragging, setIsDragging] = useState(false);
  const [socialUrl, setSocialUrl] = useState("");
  const [isExtractingUrl, setIsExtractingUrl] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const uploadToStorage = async (file: File): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `uploads/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('inspiration-media')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('inspiration-media')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  // Extract frames from video at specified intervals
  const extractVideoFrames = async (file: File): Promise<Blob[]> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const frames: Blob[] = [];
      const timestamps = [0.1, 0.25, 0.5, 0.75, 0.9]; // Extract 5 frames at these percentages
      let currentIndex = 0;

      video.onloadedmetadata = () => {
        const duration = video.duration;
        if (!duration || duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
          resolve([]);
          return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve([]);
          return;
        }

        // Scale to fit within 1280x720 while preserving aspect ratio
        const scale = Math.min(1280 / video.videoWidth, 720 / video.videoHeight, 1);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);

        const captureFrame = () => {
          if (currentIndex >= timestamps.length) {
            URL.revokeObjectURL(video.src);
            resolve(frames);
            return;
          }

          video.currentTime = duration * timestamps[currentIndex];
        };

        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) {
              frames.push(blob);
            }
            currentIndex++;
            captureFrame();
          }, 'image/jpeg', 0.8);
        };

        video.onerror = () => {
          console.error('Video frame extraction error');
          resolve(frames); // Return whatever frames we got
        };

        captureFrame();
      };

      video.onerror = () => {
        reject(new Error('Failed to load video'));
      };

      video.src = URL.createObjectURL(file);
    });
  };

  const extractVideoFramesFromUrl = async (videoUrl: string): Promise<Blob[]> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      const frames: Blob[] = [];
      const timestamps = [0.1, 0.25, 0.5, 0.75, 0.9];
      let currentIndex = 0;

      video.onloadedmetadata = () => {
        const duration = video.duration;
        if (!duration || duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
          resolve([]);
          return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve([]); return; }

        const scale = Math.min(1280 / video.videoWidth, 720 / video.videoHeight, 1);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);

        const captureFrame = () => {
          if (currentIndex >= timestamps.length) { resolve(frames); return; }
          video.currentTime = duration * timestamps[currentIndex];
        };

        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) frames.push(blob);
            currentIndex++;
            captureFrame();
          }, 'image/jpeg', 0.8);
        };

        video.onerror = () => resolve(frames);
        captureFrame();
      };

      video.onerror = () => resolve([]);
      video.src = videoUrl;
    });
  };

  const handleSocialUrl = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? socialUrl).trim();
    if (!text) return;

    const urls = extractSocialUrls(text);
    if (urls.length === 0) {
      toast({ title: "Unsupported URL", description: "Only TikTok and Instagram links are supported", variant: "destructive" });
      return;
    }

    setIsExtractingUrl(true);
    const placeholders: MediaItem[] = urls.map(() => ({ type: 'video', uploading: true }));
    const baseIndex = media.length;
    const mediaWithPlaceholders = [...media, ...placeholders];
    onMediaChange(mediaWithPlaceholders);

    // Import every link in parallel; each resolves to its frames or an error
    const results = await Promise.allSettled(urls.map(async (url) => {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-social-video`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to extract video");

      // Server returns frames directly — no client-side extraction needed
      const frameUrls: string[] = data.frameUrls || [];
      const thumbnailUrl: string = data.thumbnailUrl || frameUrls[0] || "";
      return { thumbnailUrl, frameUrls };
    }));

    // Replace each placeholder with its result; drop the ones that failed
    const allFrameUrls: string[] = [];
    let firstError: string | null = null;
    const completed: (MediaItem | null)[] = mediaWithPlaceholders.map((item, idx) => {
      const resultIndex = idx - baseIndex;
      if (resultIndex < 0 || resultIndex >= urls.length) return item;
      const result = results[resultIndex];
      if (result.status === 'rejected') {
        if (!firstError) firstError = result.reason instanceof Error ? result.reason.message : "Please try again";
        return null;
      }
      const { thumbnailUrl, frameUrls } = result.value;
      allFrameUrls.push(...frameUrls);
      return { type: 'video' as const, url: thumbnailUrl, preview: thumbnailUrl, uploading: false, frameUrls: frameUrls.length > 0 ? frameUrls : undefined };
    });
    onMediaChange(completed.filter((m): m is MediaItem => m !== null));

    // One combined location-analysis pass over all imported videos' frames
    if (allFrameUrls.length > 0) onFramesReady?.(allFrameUrls);

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = urls.length - succeeded;
    if (succeeded > 0) {
      if (!textOverride) setSocialUrl("");
      toast({
        title: succeeded === 1 ? "Video added!" : `${succeeded} videos added!`,
        description: failed > 0
          ? `${failed} link${failed > 1 ? 's' : ''} couldn't be imported`
          : `Imported successfully — finding locations...`,
      });
    } else {
      toast({ title: "Couldn't import video", description: firstError ?? "Please try again", variant: "destructive" });
    }
    setIsExtractingUrl(false);
  }, [socialUrl, media, onMediaChange, onFramesReady]);

  const processFiles = useCallback(async (files: File[]) => {
    // Create initial media items with uploading state
    const newMedia: MediaItem[] = files.map(file => ({
      type: file.type.startsWith('image/') ? 'image' : 'video',
      file,
      preview: URL.createObjectURL(file),
      uploading: true,
    }));

    // Add to state immediately for preview
    const updatedMedia = [...media, ...newMedia];
    onMediaChange(updatedMedia);

    // Process all files in parallel
    const processPromises = files.map(async (file, index) => {
      const mediaIndex = media.length + index;
      const isVideo = file.type.startsWith('video/');

      // Upload the main file
      const url = await uploadToStorage(file);

      // For videos, also extract and upload frames
      let frameUrls: string[] = [];
      if (isVideo && url) {
        try {
          console.log('Extracting frames from video...');
          const frames = await extractVideoFrames(file);
          console.log(`Extracted ${frames.length} frames from video`);

          // Upload frames in parallel; partial failures are tolerated
          const frameUploadPromises = frames.map(async (blob) => {
            const frameFile = new File([blob], `frame_${crypto.randomUUID()}.jpg`, { type: 'image/jpeg' });
            return await uploadToStorage(frameFile);
          });

          const uploadedFrameUrls = await Promise.allSettled(frameUploadPromises);
          frameUrls = uploadedFrameUrls
            .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled')
            .map(r => r.value)
            .filter((u): u is string => u !== null);
          console.log(`Uploaded ${frameUrls.length} video frames`);
        } catch (error) {
          console.error('Video frame extraction failed:', error);
        }
      }

      return { index: mediaIndex, url, frameUrls };
    });

    const results = await Promise.all(processPromises);

    // Update media with URLs
    const finalMedia = updatedMedia.map((item, idx) => {
      const result = results.find(r => r.index === idx);
      if (result) {
        if (result.url) {
          return {
            ...item,
            url: result.url,
            uploading: false,
            frameUrls: result.frameUrls.length > 0 ? result.frameUrls : undefined,
          };
        } else {
          toast({
            title: "Upload failed",
            description: `Failed to upload ${item.file?.name}`,
            variant: "destructive",
          });
          return { ...item, uploading: false };
        }
      }
      return item;
    });

    onMediaChange(finalMedia);
  }, [media, onMediaChange]);

  useImperativeHandle(ref, () => ({
    processFiles,
    addUrl: (url: string) => handleSocialUrl(url),
  }), [processFiles, handleSocialUrl]);

  if (compact) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/') || file.type.startsWith('video/')
    );

    if (files.length > 0) {
      processFiles(files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(file =>
      file.type.startsWith('image/') || file.type.startsWith('video/')
    );

    if (files.length > 0) {
      processFiles(files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const removeMedia = (index: number) => {
    onMediaChange(media.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 transition-all duration-300 cursor-pointer group block",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.02]"
            : "border-border hover:border-primary/50 hover:bg-muted/50 active:bg-muted/70",
          "min-h-[180px] flex flex-col items-center justify-center"
        )}
      >
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={handleFileSelect}
          className="sr-only"
        />

        <div className={cn(
          "flex flex-col items-center gap-4 transition-all duration-300 pointer-events-none",
          isDragging ? "scale-110" : "group-hover:scale-105"
        )}>
          <div className={cn(
            "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
            isDragging
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
          )}>
            <Upload className="w-7 h-7" />
          </div>

          <div className="text-center">
            <p className="font-medium text-foreground">
              {isDragging ? "Drop your files here" : "Drop your inspo here"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Screenshots, photos, or screen recordings from your saved TikToks
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              or tap to browse • Images & videos up to 50MB
            </p>
          </div>
        </div>
      </label>

      {/* Social URL input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            ref={urlInputRef}
            type="text"
            value={socialUrl}
            onChange={e => setSocialUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSocialUrl()}
            onPaste={e => {
              // Parse from the clipboard directly: single-line inputs collapse
              // newlines, which would concatenate multiple pasted links
              const text = e.clipboardData.getData('text');
              if (extractSocialUrls(text).length > 1) {
                e.preventDefault();
                handleSocialUrl(text);
              }
            }}
            placeholder="Paste TikTok or Instagram links..."
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            disabled={isExtractingUrl}
          />
        </div>
        <button
          onClick={() => handleSocialUrl()}
          disabled={!socialUrl.trim() || isExtractingUrl}
          className="px-4 py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
        >
          {isExtractingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : "Import"}
        </button>
      </div>

      {/* Media Preview Grid */}
      {media.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 animate-fade-in">
          {media.map((item, index) => (
            <div
              key={index}
              className="relative group aspect-square rounded-lg overflow-hidden shadow-soft hover:shadow-medium transition-all duration-300 bg-muted"
            >
              {item.type === 'image' && item.preview && (
                <img
                  src={item.preview}
                  alt={`Upload ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              )}
              {item.type === 'video' && item.preview && (
                <div className="relative w-full h-full">
                  {item.file ? (
                    <video
                      src={item.preview}
                      className="w-full h-full object-cover"
                      muted
                    />
                  ) : (
                    <img
                      src={item.preview}
                      alt={`Video ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-foreground/10">
                    <Video className="w-8 h-8 text-background" />
                  </div>
                </div>
              )}

              {/* Upload overlay */}
              {item.uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              )}

              <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/20 transition-all duration-300" />
              <button
                onClick={() => removeMedia(index)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/90 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-destructive hover:text-destructive-foreground"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="absolute bottom-2 left-2 flex items-center gap-1">
                {item.type === 'image' && <ImageIcon className="w-4 h-4 text-background drop-shadow" />}
                {item.type === 'video' && <Video className="w-4 h-4 text-background drop-shadow" />}
                {item.url && (
                  <span className="text-xs text-background drop-shadow">✓</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

MediaDropZone.displayName = 'MediaDropZone';
