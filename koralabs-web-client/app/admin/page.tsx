'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChangedHelper, signOut } from '../firebase/firebase';
import {
  checkAdminStatus,
  adminGetAllVideos,
  adminDeleteVideo,
  Video,
} from '../firebase/functions';
import styles from './admin.module.css';

function parseUploadDate(id?: string): string {
  if (!id) return '—';
  const idx = id.lastIndexOf('-');
  if (idx < 0) return '—';
  const ts = Number(id.slice(idx + 1));
  if (!Number.isFinite(ts)) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function AdminPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChangedHelper(async (user) => {
      if (!user) { router.replace('/admin/login'); return; }
      try {
        const { isAdmin } = await checkAdminStatus();
        if (!isAdmin) { router.replace('/admin/login'); return; }
      } catch {
        router.replace('/admin/login');
        return;
      }
      setAuthChecked(true);
    });
    return () => unsub();
  }, [router]);

  const loadVideos = useCallback(async () => {
    setLoadingVideos(true);
    try {
      const vids = await adminGetAllVideos();
      setVideos(vids);
    } catch (err) {
      console.error('Failed to load videos', err);
    } finally {
      setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    if (authChecked) loadVideos();
  }, [authChecked, loadVideos]);

  const handleDelete = async (video: Video) => {
    if (!video.id || deletingId) return;
    if (!window.confirm(`Delete "${video.title || 'this video'}"? This cannot be undone.`)) return;
    setDeletingId(video.id);
    // Optimistic removal
    setVideos((prev) => prev.filter((v) => v.id !== video.id));
    try {
      await adminDeleteVideo(video.id);
    } catch (err) {
      alert(`Failed to delete: ${err}`);
      // Restore on failure
      setVideos((prev) =>
        [...prev, video].sort((a, b) => (b.id ?? '').localeCompare(a.id ?? ''))
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/admin/login');
  };

  if (!authChecked) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Admin Dashboard</h1>
        <button type="button" className={styles.signOutButton} onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.tableHeader}>
          <div>Thumbnail</div>
          <div>Title</div>
          <div>Uploader UID</div>
          <div>Date</div>
          <div>Status</div>
          <div>Views</div>
          <div></div>
        </div>

        {loadingVideos && videos.length === 0 && (
          <div className={styles.empty}>Loading videos…</div>
        )}
        {!loadingVideos && videos.length === 0 && (
          <div className={styles.empty}>No videos found.</div>
        )}

        {videos.map((v) => {
          const thumb =
            v.thumbnailUrl && v.thumbnailUrl.length > 0
              ? v.thumbnailUrl
              : '/images/thumbnails/thumbnail.png';
          return (
            <div key={v.id} className={styles.tableRow}>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb} alt={v.title || 'Thumbnail'} className={styles.thumb} />
              </div>
              <div className={styles.titleCell}>
                <span className={styles.videoTitle}>{v.title || 'Untitled'}</span>
                <span className={styles.videoId}>{v.id}</span>
              </div>
              <div className={styles.uidCell}>{v.uid || '—'}</div>
              <div>{parseUploadDate(v.id)}</div>
              <div>
                <span className={`${styles.badge} ${v.status === 'processed' ? styles.badgeProcessed : styles.badgeProcessing}`}>
                  {v.status ?? 'unknown'}
                </span>
              </div>
              <div>{v.viewCount ?? 0}</div>
              <div>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => handleDelete(v)}
                  disabled={deletingId === v.id}
                >
                  {deletingId === v.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
