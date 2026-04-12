'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { getVideos, getUserById, formatUploader, User, Video } from './firebase/functions';
import styles from './page.module.css';

function formatViewCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K views`;
  return `${n} ${n === 1 ? 'view' : 'views'}`;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

function parseTimestamp(id?: string): number | null {
  if (!id) return null;
  const idx = id.lastIndexOf('-');
  if (idx < 0) return null;
  const ts = Number(id.slice(idx + 1));
  return Number.isFinite(ts) ? ts : null;
}

function VideoCard({ video, userMap }: { video: Video; userMap: Map<string, User | null> }) {
  const uploader = video.uid ? userMap.get(video.uid) : null;
  const uploaderName = formatUploader(uploader);
  const initial = uploaderName.slice(0, 1).toUpperCase();
  const ts = parseTimestamp(video.id);
  const thumbSrc =
    video.thumbnailUrl && video.thumbnailUrl.length > 0
      ? video.thumbnailUrl
      : '/images/thumbnails/thumbnail.png';

  return (
    <Link href={`/watch?v=${video.filename ?? video.id}`} key={video.id} className={styles.cardLink}>
      <div className={styles.videoCard}>
        <div className={styles.thumbnailContainer}>
          <Image
            src={thumbSrc}
            alt={video.title || 'Video thumbnail'}
            width={480}
            height={270}
            className={styles.thumbnail}
            unoptimized
          />
        </div>
        <div className={styles.cardMeta}>
          <div className={styles.cardAvatar}>
            {uploader?.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={uploader.photoUrl} alt={uploaderName} className={styles.cardAvatarImg} />
            ) : (
              <span className={styles.cardAvatarInitials}>{initial}</span>
            )}
          </div>
          <div className={styles.cardInfo}>
            <h3 className={styles.videoTitle}>{video.title || 'Untitled'}</h3>
            <p className={styles.cardUploaderName}>{uploaderName}</p>
            <p className={styles.cardStats}>
              {formatViewCount(video.viewCount ?? 0)}
              {ts !== null && <> &bull; {timeAgo(ts)}</>}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get('search')?.trim() ?? '';

  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [userMap, setUserMap] = useState<Map<string, User | null>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const videos = await getVideos();
        if (cancelled) return;
        const uniqueUids = Array.from(
          new Set(videos.map((v) => v.uid).filter((u): u is string => !!u))
        );
        const userEntries = await Promise.all(
          uniqueUids.map(async (uid) => {
            try { return [uid, await getUserById(uid)] as const; }
            catch { return [uid, null] as const; }
          })
        );
        if (cancelled) return;
        setAllVideos(videos);
        setUserMap(new Map(userEntries));
      } catch (err) {
        console.error('Failed to load videos', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filteredVideos = query
    ? allVideos.filter((v) => {
        const q = query.toLowerCase();
        return (
          (v.title ?? '').toLowerCase().includes(q) ||
          (v.uid ?? '').toLowerCase().includes(q)
        );
      })
    : allVideos;

  return (
    <main className={styles.main}>
      {query && (
        <p className={styles.searchHeader}>
          Results for <strong>&lsquo;{query}&rsquo;</strong>
        </p>
      )}
      {loading ? (
        <p className={styles.loadingState}>Loading videos…</p>
      ) : filteredVideos.length === 0 ? (
        <p className={styles.emptyState}>
          {query ? `No videos found for '${query}'.` : 'No videos yet.'}
        </p>
      ) : (
        <div className={styles.videoGrid}>
          {filteredVideos.map((video) => (
            <VideoCard key={video.id} video={video} userMap={userMap} />
          ))}
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className={styles.main}>
          <p className={styles.loadingState}>Loading videos…</p>
        </main>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
