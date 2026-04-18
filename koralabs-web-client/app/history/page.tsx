'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User as FirebaseAuthUser } from 'firebase/auth';
import { onAuthStateChangedHelper } from '../firebase/firebase';
import {
  getWatchHistory, clearWatchHistory, getUserById, formatUploader,
  VideoWithWatchedAt, User,
} from '../firebase/functions';
import styles from './page.module.css';

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${days}d ago`;
}

function formatViewCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K views`;
  return `${n} ${n === 1 ? 'view' : 'views'}`;
}

function HistoryContent() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<FirebaseAuthUser | null | undefined>(undefined);
  const [videos, setVideos] = useState<VideoWithWatchedAt[]>([]);
  const [userMap, setUserMap] = useState<Record<string, User | null>>({});
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChangedHelper((u) => setCurrentUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (currentUser === undefined) return;
    if (!currentUser) { router.replace('/'); return; }
  }, [currentUser, router]);

  const loadHistory = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const history = await getWatchHistory();
      setVideos(history);
      const uids = [...new Set(history.map((v) => v.uid).filter((u): u is string => !!u))];
      const entries = await Promise.all(uids.map(async (uid) => {
        try { return [uid, await getUserById(uid)] as const; }
        catch { return [uid, null] as const; }
      }));
      setUserMap(Object.fromEntries(entries));
    } catch {
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) loadHistory();
  }, [currentUser, loadHistory]);

  const handleClear = async () => {
    if (clearing || !window.confirm('Clear all watch history? This cannot be undone.')) return;
    setClearing(true);
    try {
      await clearWatchHistory();
      setVideos([]);
    } catch (err) {
      alert(`Failed to clear history: ${err}`);
    } finally {
      setClearing(false);
    }
  };

  if (currentUser === undefined || (currentUser && loading)) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Watch History</h1>
        </div>
        <div className={styles.list}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.skeletonRow}>
              <div className={`${styles.skeleton} ${styles.skeletonThumb}`} />
              <div className={styles.skeletonMeta}>
                <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
                <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
                <div className={`${styles.skeleton} ${styles.skeletonLineShort}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Watch History</h1>
        {videos.length > 0 && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={handleClear}
            disabled={clearing}
          >
            {clearing ? 'Clearing…' : 'Clear History'}
          </button>
        )}
      </div>

      {videos.length === 0 ? (
        <div className={styles.empty}>
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} className={styles.emptyIcon}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" />
          </svg>
          <p className={styles.emptyText}>Your watch history is empty</p>
          <Link href="/" className={styles.emptyLink}>Browse videos</Link>
        </div>
      ) : (
        <div className={styles.list}>
          {videos.map((v) => {
            const watchHref = `/watch?v=${v.filename ?? v.id}`;
            const thumb = v.thumbnailSmallUrl ?? '/images/thumbnails/thumbnail.png';
            const uploader = v.uid ? userMap[v.uid] : null;
            const uploaderName = formatUploader(uploader);
            const channelHref = v.uid ? `/channel/${v.uid}` : null;
            const initial = uploaderName.slice(0, 1).toUpperCase();

            return (
              <div key={`${v.id}_${v.watchedAt}`} className={styles.row}>
                <Link href={watchHref} className={styles.thumbLink}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumb} alt={v.title || 'Thumbnail'} className={styles.thumb} />
                </Link>
                <div className={styles.meta}>
                  <Link href={watchHref} className={styles.titleLink}>
                    <h3 className={styles.title}>{v.title || 'Untitled'}</h3>
                  </Link>
                  <div className={styles.channelRow}>
                    {channelHref ? (
                      <Link href={channelHref} className={styles.avatarLink}>
                        <div className={styles.avatar}>
                          {uploader?.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={uploader.photoUrl} alt={uploaderName} className={styles.avatarImg} />
                          ) : (
                            <span className={styles.avatarInitial}>{initial}</span>
                          )}
                        </div>
                      </Link>
                    ) : (
                      <div className={styles.avatar}>
                        <span className={styles.avatarInitial}>{initial}</span>
                      </div>
                    )}
                    {channelHref ? (
                      <Link href={channelHref} className={styles.uploaderLink}>
                        {uploaderName}
                      </Link>
                    ) : (
                      <span className={styles.uploaderName}>{uploaderName}</span>
                    )}
                  </div>
                  <p className={styles.stats}>
                    {formatViewCount(v.viewCount ?? 0)}
                    {v.watchedAt && <> &bull; Watched {timeAgo(v.watchedAt)}</>}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#aaa' }}>Loading…</div>}>
      <HistoryContent />
    </Suspense>
  );
}
