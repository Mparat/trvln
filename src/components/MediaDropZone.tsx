import { useState, useCallback } from "react";
import { Upload, X, Image as ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaItem {
  type: 'image' | 'video';
  file?: File;
  preview?: string;
}

interface MediaDropZoneProps {
  media: MediaItem[];
  onMediaChange: (media: MediaItem[]) => void;
}

export function MediaDropZone({ media, onMediaChange }: MediaDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

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
      const newMedia: MediaItem[] = files.map(file => ({
        type: file.type.startsWith('image/') ? 'image' : 'video',
        file,
        preview: URL.createObjectURL(file)
      }));
      onMediaChange([...media, ...newMedia]);
    }
  }, [media, onMediaChange]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(file => 
      file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    
    if (files.length > 0) {
      const newMedia: MediaItem[] = files.map(file => ({
        type: file.type.startsWith('image/') ? 'image' : 'video',
        file,
        preview: URL.createObjectURL(file)
      }));
      onMediaChange([...media, ...newMedia]);
    }
  }, [media, onMediaChange]);

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
              <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/20 transition-all duration-300" />
              <button
                onClick={() => removeMedia(index)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/90 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-destructive hover:text-destructive-foreground"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="absolute bottom-2 left-2">
                {item.type === 'image' && <ImageIcon className="w-4 h-4 text-background drop-shadow" />}
                {item.type === 'video' && <Video className="w-4 h-4 text-background drop-shadow" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
