'use client';

/**
 * Display media via Google Drive preview iframe when archived, otherwise a
 * native <video>/<img> against the same-origin stream URL.
 */
export function MediaEmbed({
  embedUrl,
  streamUrl,
  kind,
  className,
  title,
  poster,
  autoPlay = false,
}: {
  embedUrl?: string | null;
  streamUrl: string;
  kind: 'video' | 'image';
  className?: string;
  title?: string;
  poster?: string;
  /** Previews stay paused until the user hits play. */
  autoPlay?: boolean;
}) {
  if (embedUrl) {
    return (
      <iframe
        title={title ?? (kind === 'video' ? 'Video preview' : 'Image preview')}
        src={embedUrl}
        className={className ?? 'aspect-video w-full max-w-md rounded-md border border-zinc-200 bg-black'}
        allow={autoPlay ? 'autoplay; encrypted-media' : 'encrypted-media'}
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  if (kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={streamUrl} alt={title ?? ''} className={className} />;
  }

  return (
    <video
      className={className ?? 'w-full max-w-md rounded-md bg-black shadow-sm'}
      controls
      playsInline
      preload="metadata"
      autoPlay={autoPlay}
      poster={poster}
      src={streamUrl}
    />
  );
}
