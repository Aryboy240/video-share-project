'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { getVideos, getUserById, formatUploader, User, Video } from './firebase/functions';
import { onAuthStateChangedHelper } from './firebase/firebase';
import { User as FirebaseAuthUser } from 'firebase/auth';
import styles from './page.module.css';

const CATEGORIES = [
  'All', 'Gaming', 'Music', 'Education', 'Technology',
  'Entertainment', 'Sports', 'News', 'Comedy', 'Other',
] as const;

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

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseTimestamp(id?: string): number | null {
  if (!id) return null;
  const idx = id.lastIndexOf('-');
  if (idx < 0) return null;
  const ts = Number(id.slice(idx + 1));
  return Number.isFinite(ts) ? ts : null;
}

function SkeletonCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={`${styles.skeleton} ${styles.skeletonThumb}`} />
      <div className={styles.skeletonMeta}>
        <div className={`${styles.skeleton} ${styles.skeletonAvatar}`} />
        <div className={styles.skeletonInfo}>
          <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
          <div className={`${styles.skeleton} ${styles.skeletonLine} ${styles.skeletonLineMd}`} />
          <div className={`${styles.skeleton} ${styles.skeletonLine} ${styles.skeletonLineSm}`} />
        </div>
      </div>
    </div>
  );
}

function VideoCard({ video, userMap }: { video: Video; userMap: Map<string, User | null> }) {
  const uploader = video.uid ? userMap.get(video.uid) : null;
  const uploaderName = formatUploader(uploader);
  const initial = uploaderName.slice(0, 1).toUpperCase();
  const ts = parseTimestamp(video.id);
  const thumbSrc =
    video.thumbnailSmallUrl ?? '/images/thumbnails/thumbnail.png';
  const watchHref = `/watch?v=${video.filename ?? video.id}`;
  const channelHref = video.uid ? `/channel/${video.uid}` : null;

  const avatarEl = uploader?.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={uploader.photoUrl} alt={uploaderName} className={styles.cardAvatarImg} />
  ) : (
    <span className={styles.cardAvatarInitials}>{initial}</span>
  );

  return (
    <div className={styles.cardOuter}>
      <Link href={watchHref} className={styles.cardLink}>
        <div className={styles.thumbnailContainer}>
          <Image
            src={thumbSrc}
            alt={video.title || 'Video thumbnail'}
            width={480}
            height={270}
            className={styles.thumbnail}
            unoptimized
          />
          {video.duration != null && (
            <span className={styles.durationBadge}>{formatDuration(video.duration)}</span>
          )}
        </div>
      </Link>
      <div className={styles.cardMeta}>
        {channelHref ? (
          <Link href={channelHref} className={styles.cardAvatarLink}>
            <div className={styles.cardAvatar}>{avatarEl}</div>
          </Link>
        ) : (
          <div className={styles.cardAvatar}>{avatarEl}</div>
        )}
        <div className={styles.cardInfo}>
          <Link href={watchHref} className={styles.cardTitleLink}>
            <h3 className={styles.videoTitle}>{video.title || 'Untitled'}</h3>
          </Link>
          {channelHref ? (
            <Link href={channelHref} className={styles.cardUploaderLink}>
              <p className={styles.cardUploaderName}>{uploaderName}</p>
            </Link>
          ) : (
            <p className={styles.cardUploaderName}>{uploaderName}</p>
          )}
          <p className={styles.cardStats}>
            {formatViewCount(video.viewCount ?? 0)}
            {ts !== null && <> &bull; {timeAgo(ts)}</>}
          </p>
        </div>
      </div>
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get('search')?.trim() ?? '';
  const rawCategory = searchParams.get('category')?.trim() ?? '';
  const activeCategory = (CATEGORIES as readonly string[]).find(
    (c) => c !== 'All' && c.toLowerCase() === rawCategory.toLowerCase()
  ) ?? 'All';

  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [userMap, setUserMap] = useState<Map<string, User | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<FirebaseAuthUser | null | undefined>(undefined);

  useEffect(() => {
    const unsub = onAuthStateChangedHelper((u) => setCurrentUser(u));
    return () => unsub();
  }, []);

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

  const filteredVideos = allVideos.filter((v) => {
    const matchesQuery = !query || (
      (v.title ?? '').toLowerCase().includes(query.toLowerCase()) ||
      (v.uid ?? '').toLowerCase().includes(query.toLowerCase())
    );
    const matchesCategory = activeCategory === 'All' ||
      (v.tags ?? []).some((t) => t.toLowerCase() === activeCategory.toLowerCase());
    return matchesQuery && matchesCategory;
  });

  const handleCategoryClick = (cat: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (cat === 'All') {
      params.delete('category');
    } else {
      params.set('category', cat);
    }
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : '/');
  };

  return (
    <main className={styles.main}>
      <div className={styles.categoryRow}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`${styles.categoryPill}${activeCategory === cat ? ' ' + styles.categoryPillActive : ''}`}
            onClick={() => handleCategoryClick(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      {(query || activeCategory !== 'All') && (
        <p className={styles.searchHeader}>
          {query && <>Results for <strong>&lsquo;{query}&rsquo;</strong></>}
          {query && activeCategory !== 'All' && <> in </>}
          {activeCategory !== 'All' && <strong>{activeCategory}</strong>}
        </p>
      )}
      {loading ? (
        <div className={styles.videoGrid}>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filteredVideos.length === 0 ? (
        query ? (
          <p className={styles.emptyState}>No videos found for &lsquo;{query}&rsquo;.</p>
        ) : currentUser ? (
          <div className={styles.emptyStateBox}>
            <svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} className={styles.emptyStateIcon}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
            <h2 className={styles.emptyStateHeading}>No videos yet</h2>
            <p className={styles.emptyStateSubtext}>Be the first to upload</p>
            <a href="/studio" className={styles.emptyStateButton}>Upload a video</a>
          </div>
        ) : (
          <p className={styles.emptyState}>No videos have been uploaded yet.</p>
        )
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
