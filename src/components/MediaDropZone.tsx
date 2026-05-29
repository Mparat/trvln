import { useState, useCallback } from "react";
import { Upload, X, Image as ImageIcon, Video, Loader2 } from "lucide-react";
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
}

export function MediaDropZone({ media, onMediaChange }: MediaDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    
    if (files.length > 0) {
      processFiles(files);
    }
  }, [processFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(file => 
      file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    
    if (files.length > 0) {
      processFiles(files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  }, [processFiles]);

  const removeMedia = useCallback((index: number) => {
    onMediaChange(media.filter((_, i) => i !== index));
  }, [media, onMediaChange]);

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
                  <video
                    src={item.preview}
                    className="w-full h-full object-cover"
                    muted
                  />
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
}
