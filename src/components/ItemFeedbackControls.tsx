import { useState, type MouseEvent } from 'react';
import { ThumbsUp, ThumbsDown, Meh, MessageSquare, Undo2, Loader2, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ItineraryItem } from '@/hooks/useItineraryItems';

interface ItemFeedbackControlsProps {
  item: ItineraryItem;
  canUndo: boolean;
  onVote: (vote: 'up' | 'down' | 'neutral') => void;
  onComment: (comment: string) => void;
  onSubmitFeedback: (overrides?: { vote?: 'up' | 'down' | 'neutral' | null; comment?: string | null }) => void;
  onUndo: () => void;
}

export function ItemFeedbackControls({
  item,
  canUndo,
  onVote,
  onComment,
  onSubmitFeedback,
  onUndo,
}: ItemFeedbackControlsProps) {
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState(item.comment || '');

  const handleVote = (vote: 'up' | 'down' | 'neutral', e: MouseEvent) => {
    e.stopPropagation();
    onVote(vote);
    if (vote === 'up') {
      onSubmitFeedback({ vote });
    } else if (vote === 'down') {
      // Open comment box so user can optionally explain before submitting
      setShowCommentInput(true);
    }
  };

  const handleSubmitComment = (e: MouseEvent) => {
    e.stopPropagation();
    const nextComment = commentText.trim() || null;
    if (nextComment) onComment(nextComment);
    setShowCommentInput(false);
    onSubmitFeedback({ vote: item.vote, comment: nextComment });
  };

  const handleUndo = (e: MouseEvent) => {
    e.stopPropagation();
    onUndo();
  };

  if (item.isUpdating) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 bg-primary/10 rounded-lg">
        <Loader2 className="w-3 h-3 animate-spin text-primary" />
        <span className="text-xs text-primary">Updating...</span>
      </div>
    );
  }

  return (
    <div 
      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Vote buttons */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 w-7 p-0 rounded-full",
          item.vote === 'up' && "bg-emerald-500/20 text-emerald-600"
        )}
        onClick={(e) => handleVote('up', e)}
        title="Keep this"
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 w-7 p-0 rounded-full",
          item.vote === 'down' && "bg-red-500/20 text-red-600"
        )}
        onClick={(e) => handleVote('down', e)}
        title="Replace this"
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 w-7 p-0 rounded-full",
          item.vote === 'neutral' && "bg-amber-500/20 text-amber-600"
        )}
        onClick={(e) => handleVote('neutral', e)}
        title="Indifferent"
      >
        <Meh className="w-3.5 h-3.5" />
      </Button>

      {/* Comment button */}
      <Popover open={showCommentInput} onOpenChange={setShowCommentInput}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 w-7 p-0 rounded-full",
              item.comment && "bg-blue-500/20 text-blue-600"
            )}
            title="Add note"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-72 p-3" 
          align="start"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            {item.vote === 'down' && (
              <p className="text-xs text-muted-foreground">What would you change? <span className="opacity-60">(optional)</span></p>
            )}
            <Textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={item.vote === 'down' ? "e.g. Too expensive, prefer a different style..." : "Add your note..."}
              className="min-h-[60px] text-sm resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCommentInput(false)}
              >
                <X className="w-3 h-3 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmitComment}
                disabled={!commentText.trim() && !item.vote}
              >
                <Send className="w-3 h-3 mr-1" />
                {item.vote === 'down' ? 'Replace this' : 'Submit'}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Undo button (only if item has been updated) */}
      {canUndo && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={handleUndo}
          title="Undo to previous version"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </Button>
      )}

      {/* Submit button for downvote/neutral */}
      {(item.vote === 'down' || item.vote === 'neutral') && (
        <Button
          size="sm"
          className="h-7 px-2 ml-1"
          onClick={(e) => {
            e.stopPropagation();
            onSubmitFeedback({ vote: item.vote, comment: item.comment });
          }}
        >
          <Send className="w-3 h-3 mr-1" />
          Update
        </Button>
      )}
    </div>
  );
}
