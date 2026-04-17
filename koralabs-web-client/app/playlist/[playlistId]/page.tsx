'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { User as FirebaseAuthUser } from 'firebase/auth';
import { onAuthStateChangedHelper } from '../../firebase/firebase';
import {
  getPlaylist, removeFromPlaylist, deletePlaylist, reorderPlaylist,
  updatePlaylistVisibility,
  PlaylistDetail, Video,
} from '../../firebase/functions';
import styles from './page.module.css';

export default function PlaylistPage() {
  const params = useParams();
  const playlistId = typeof params.playlistId === 'string'
    ? params.playlistId
    : Array.isArray(params.playlistId) ? params.playlistId[0] : '';
  const router = useRouter();

  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<FirebaseAuthUser | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState(false);
  const [togglingVis, setTogglingVis] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);

  // Drag-to-reorder state
  const dragIdxRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChangedHelper((u) => setCurrentUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!playlistId) return;
    setLoading(true);
    getPlaylist(playlistId)
      .then((pl) => {
        setPlaylist(pl);
        setVideos(pl.videos);
      })
      .catch((err) => setError(err?.message ?? 'Failed to load playlist'))
      .finally(() => setLoading(false));
  }, [playlistId]);

  const isOwner = !!currentUser && playlist?.uid === currentUser.uid;

  const handleRemove = async (videoId: string) => {
    if (removingId || !playlistId) return;
    setRemovingId(videoId);
    try {
      await removeFromPlaylist(playlistId, videoId);
      setVideos((prev) => prev.filter((v) => v.id !== videoId && v.filename !== videoId));
      setPlaylist((prev) =>
        prev ? { ...prev, videoIds: prev.videoIds.filter((id) => id !== videoId) } : prev
      );
    } catch { /* silent */ } finally {
      setRemovingId(null);
    }
  };

  const handleDelete = async () => {
    if (deletingPlaylist || !playlistId) return;
    if (!confirm('Delete this playlist?')) return;
    setDeletingPlaylist(true);
    try {
      await deletePlaylist(playlistId);
      router.push('/studio');
    } catch { setDeletingPlaylist(false); }
  };

  // Drag handlers for reorder
  const handleDragStart = (idx: number) => { dragIdxRef.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOver(idx);
  };
  const handleDrop = async (idx: number) => {
    const from = dragIdxRef.current;
    if (from === null || from === idx) { dragIdxRef.current = null; setDragOver(null); return; }
    const reordered = [...videos];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(idx, 0, moved);
    setVideos(reordered);
    dragIdxRef.current = null;
    setDragOver(null);
    const newIds = reordered.map((v) => v.id ?? v.filename ?? '').filter(Boolean);
    try {
      await reorderPlaylist(playlistId, newIds);
    } catch { /* silent — local state already updated */ }
  };

  const handleToggleVisibility = async () => {
    if (!playlist || togglingVis || !playlistId) return;
    const next = playlist.visibility === 'public' ? 'private' : 'public';
    setTogglingVis(true);
    try {
      await updatePlaylistVisibility(playlistId, next);
      setPlaylist((prev) => prev ? { ...prev, visibility: next } : prev);
    } catch { /* silent */ } finally {
      setTogglingVis(false);
    }
  };

  if (loading) {
    return <div className={styles.page}><p className={styles.empty}>Loading…</p></div>;
  }
  if (error || !playlist) {
    return <div className={styles.page}><p className={styles.empty}>{error ?? 'Playlist not found.'}</p></div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{playlist.title}</h1>
          {playlist.description && (
            <p className={styles.description}>{playlist.description}</p>
          )}
          <div className={styles.meta}>
            <span className={`${styles.visBadge} ${playlist.visibility === 'private' ? styles.visPrivate : styles.visPublic}`}>
              {playlist.visibility}
            </span>
            <span className={styles.videoCountMeta}>{videos.length} {videos.length === 1 ? 'video' : 'videos'}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          {videos.length > 0 && (
            <Link
              href={`/watch?v=${videos[0].filename ?? videos[0].id}&list=${playlistId}`}
              className={styles.playAllBtn}
            >
              ▶ Play all
            </Link>
          )}
          {isOwner && (
            <button
              type="button"
              className={styles.visToggleBtn}
              onClick={handleToggleVisibility}
              disabled={togglingVis}
            >
              {togglingVis ? '…' : playlist.visibility === 'public' ? 'Make private' : 'Make public'}
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={handleDelete}
              disabled={deletingPlaylist}
            >
              {deletingPlaylist ? 'Deleting…' : 'Delete playlist'}
            </button>
          )}
        </div>
      </div>

      {videos.length === 0 && (
        <p className={styles.empty}>No videos in this playlist.</p>
      )}

      <div className={styles.list}>
        {videos.map((v, i) => {
          const thumb = v.thumbnailSmallUrl ?? '/images/thumbnails/thumbnail.png';
          const isDragTarget = dragOver === i;
          return (
            <div
              key={v.id ?? i}
              className={`${styles.item} ${isDragTarget ? styles.itemDragOver : ''}`}
              draggable={isOwner}
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragLeave={() => setDragOver(null)}
            >
              <span className={styles.num}>{i + 1}</span>
              {isOwner && <span className={styles.dragHandle} title="Drag to reorder">⠿</span>}
              <Link href={`/watch?v=${v.filename ?? v.id}&list=${playlistId}`} className={styles.thumb}>
                <Image
                  src={thumb}
                  alt={v.title || 'thumbnail'}
                  width={120}
                  height={68}
                  className={styles.thumbImg}
                  unoptimized
                />
              </Link>
              <div className={styles.info}>
                <Link href={`/watch?v=${v.filename ?? v.id}&list=${playlistId}`} className={styles.videoTitle}>
                  {v.title || 'Untitled'}
                </Link>
              </div>
              {isOwner && (
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => handleRemove(v.id ?? v.filename ?? '')}
                  disabled={removingId === (v.id ?? v.filename)}
                  title="Remove from playlist"
                >✕</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
