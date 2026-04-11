'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { User as FirebaseAuthUser } from 'firebase/auth';
import styles from './page.module.css';
import {
  getVideos, getUserById, formatUploader,
  toggleLike, getLikeStatus,
  toggleSubscription, getSubscriptionStatus,
  addComment, getComments, deleteComment,
  recordView, editComment,
  Video, User, Comment,
} from '../firebase/functions';
import { onAuthStateChangedHelper } from '../firebase/firebase';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseUploadDate(id?: string): Date | null {
  if (!id) return null;
  const idx = id.lastIndexOf('-');
  if (idx < 0) return null;
  const ts = Number(id.slice(idx + 1));
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function formatUploadDate(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function IconPlay() {
  return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
}
function IconPause() {
  return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
}
function IconVolumeMuted() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97V10.18L16.45 12.63A4.43 4.43 0 0 0 16.5 12zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 17.73 18l2 2L21 18.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
    </svg>
  );
}
function IconVolumeLow() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.5 12A4.5 4.5 0 0 0 16 7.97V16a4.5 4.5 0 0 0 2.5-4zm-13.5 0c0 3.54 2.46 6.54 6 7.4v-2.06c-2.27-.75-4-2.9-4-5.34s1.73-4.59 4-5.34V4.6C7.46 5.46 5 8.46 5 12zm7-8L9 7H5v10h4l3 3V4z"/>
    </svg>
  );
}
function IconVolumeHigh() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97V16a4.5 4.5 0 0 0 2.5-4zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
  );
}
function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
    </svg>
  );
}
function IconFullscreen() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
    </svg>
  );
}
function IconFullscreenExit() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
    </svg>
  );
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// ── Component ─────────────────────────────────────────────────────────────────

function WatchContent() {
  const videoPrefix = 'https://storage.googleapis.com/koralabs-processed-videos/';
  const videoSrc = useSearchParams().get('v');

  // Firebase / page state
  const [video, setVideo] = useState<Video | null>(null);
  const [uploader, setUploader] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<FirebaseAuthUser | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState<number>(0);
  const [togglingSub, setTogglingSub] = useState(false);
  const [likeAction, setLikeAction] = useState<'like' | 'dislike' | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [dislikeCount, setDislikeCount] = useState(0);
  const [togglingLike, setTogglingLike] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [commentUserMap, setCommentUserMap] = useState<Record<string, User | null>>({});
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<string | null>(null);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const viewRecorded = useRef(false);

  // Player refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackIdRef = useRef(0);
  const isDraggingRef = useRef(false);
  const pausedRef = useRef(true);
  const restoreTimeRef = useRef<{ time: number; playing: boolean } | null>(null);

  // Player state
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showVolSlider, setShowVolSlider] = useState(false);
  const [feedbackState, setFeedbackState] = useState<{ icon: string; id: number } | null>(null);

  // ── Firebase effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChangedHelper((u) => setCurrentUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!videoSrc) return;
    getVideos().then((videos) => {
      const match = videos.find((v) => v.filename === videoSrc);
      setVideo(match ?? null);
    });
  }, [videoSrc]);

  useEffect(() => {
    if (!video?.resolutions || video.resolutions.length === 0) { setSelectedResolution(null); return; }
    setSelectedResolution(video.resolutions[0]);
  }, [video?.resolutions]);

  useEffect(() => {
    if (!video?.uid) { setUploader(null); return; }
    getUserById(video.uid)
      .then((u) => { setUploader(u); setSubscriberCount(u?.subscriberCount ?? 0); })
      .catch(() => setUploader(null));
  }, [video?.uid]);

  useEffect(() => {
    setLikeCount(video?.likeCount ?? 0);
    setDislikeCount(video?.dislikeCount ?? 0);
  }, [video?.likeCount, video?.dislikeCount]);

  useEffect(() => {
    if (!currentUser || !video?.id) { setLikeAction(null); return; }
    getLikeStatus(video.id).then((r) => setLikeAction(r.action)).catch(() => setLikeAction(null));
  }, [currentUser, video?.id]);

  useEffect(() => { setCommentCount(video?.commentCount ?? 0); }, [video?.commentCount]);

  useEffect(() => {
    if (!video?.id) { setComments([]); return; }
    getComments(video.id).then(async (fetched) => {
      setComments(fetched);
      const uids = [...new Set(fetched.map((c) => c.uid))];
      const entries = await Promise.all(uids.map(async (uid) => {
        try { return [uid, await getUserById(uid)] as const; }
        catch { return [uid, null] as const; }
      }));
      setCommentUserMap(Object.fromEntries(entries));
    }).catch(() => setComments([]));
  }, [video?.id]);

  useEffect(() => {
    if (!currentUser || !video?.uid || currentUser.uid === video.uid) { setSubscribed(false); return; }
    getSubscriptionStatus(video.uid).then((r) => setSubscribed(r.subscribed)).catch(() => setSubscribed(false));
  }, [currentUser, video?.uid]);

  useEffect(() => {
    if (!video?.id || viewRecorded.current) return;
    viewRecorded.current = true;
    recordView(video.id).then((r) => setViewCount(r.viewCount)).catch(() => {});
  }, [video?.id]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Player effects ────────────────────────────────────────────────────────────

  // Init volume from localStorage
  useEffect(() => {
    const savedVol = parseFloat(localStorage.getItem('player-volume') ?? '');
    const savedMuted = localStorage.getItem('player-muted') === 'true';
    if (Number.isFinite(savedVol)) setVolume(Math.max(0, Math.min(1, savedVol)));
    setMuted(savedMuted);
  }, []);

  // Sync volume/muted → video element + localStorage
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
    localStorage.setItem('player-volume', String(volume));
    localStorage.setItem('player-muted', String(muted));
  }, [volume, muted]);

  // Keep pausedRef in sync (avoids stale closure in resetControlsTimer)
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Fullscreen change
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Settings outside-click
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [settingsOpen]);

  // ── Player callbacks ──────────────────────────────────────────────────────────

  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (!pausedRef.current) {
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, []);

  const triggerFeedback = useCallback((icon: string) => {
    feedbackIdRef.current += 1;
    const id = feedbackIdRef.current;
    setFeedbackState({ icon, id });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedbackState(null), 700);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); triggerFeedback('▶'); }
    else { v.pause(); triggerFeedback('⏸'); }
  }, [triggerFeedback]);

  const toggleFullscreen = useCallback(async () => {
    const c = containerRef.current;
    if (!c) return;
    if (!document.fullscreenElement) await c.requestFullscreen();
    else await document.exitFullscreen();
  }, []);

  const seek = useCallback((clientX: number) => {
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar || !Number.isFinite(v.duration) || v.duration === 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
  }, []);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    seek(e.clientX);
    const onMove = (me: MouseEvent) => { if (isDraggingRef.current) seek(me.clientX); };
    const onUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [seek]);

  const applySpeed = useCallback((speed: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
    setPlaybackSpeed(speed);
    setSettingsOpen(false);
  }, []);

  const handleResolutionChange = useCallback((res: string) => {
    const v = videoRef.current;
    restoreTimeRef.current = { time: v?.currentTime ?? 0, playing: !(v?.paused ?? true) };
    setSelectedResolution(res);
    setSettingsOpen(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          resetControlsTimer();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 5);
          resetControlsTimer();
          break;
        case 'ArrowRight':
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
          resetControlsTimer();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume((p) => parseFloat(Math.min(1, p + 0.1).toFixed(2)));
          setMuted(false);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume((p) => parseFloat(Math.max(0, p - 0.1).toFixed(2)));
          break;
        case 'f': case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm': case 'M':
          e.preventDefault();
          setMuted((p) => !p);
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [togglePlay, toggleFullscreen, resetControlsTimer]);

  // ── Firebase handlers ─────────────────────────────────────────────────────────

  const canSubscribe = !!currentUser && !!video?.uid && currentUser.uid !== video.uid;

  const handleToggleSubscription = async () => {
    if (!video?.uid || togglingSub) return;
    setTogglingSub(true);
    try {
      const res = await toggleSubscription(video.uid);
      setSubscribed(res.subscribed);
      setSubscriberCount((c) => c + (res.subscribed ? 1 : -1));
    } catch (err) { alert(`Failed to update subscription: ${err}`); }
    finally { setTogglingSub(false); }
  };

  const handleToggleLike = async (action: 'like' | 'dislike') => {
    if (!video?.id || togglingLike || !currentUser) return;
    const prev = likeAction;
    if (prev === action) {
      setLikeAction(null);
      action === 'like' ? setLikeCount((c) => c - 1) : setDislikeCount((c) => c - 1);
    } else {
      setLikeAction(action);
      action === 'like' ? setLikeCount((c) => c + 1) : setDislikeCount((c) => c + 1);
      if (prev === 'like') setLikeCount((c) => c - 1);
      if (prev === 'dislike') setDislikeCount((c) => c - 1);
    }
    setTogglingLike(true);
    try {
      const res = await toggleLike(video.id, action);
      setLikeAction(res.action);
    } catch (err) {
      setLikeAction(prev);
      setLikeCount(video?.likeCount ?? 0);
      setDislikeCount(video?.dislikeCount ?? 0);
      alert(`Failed to update: ${err}`);
    } finally { setTogglingLike(false); }
  };

  const handlePostComment = async () => {
    if (!video?.id || !commentText.trim() || postingComment || !currentUser) return;
    setPostingComment(true);
    const text = commentText.trim();
    setCommentText('');
    try {
      const { id } = await addComment(video.id, text);
      const newComment: Comment = { id, uid: currentUser.uid, text, createdAt: new Date().toISOString() };
      setComments((prev) => [...prev, newComment]);
      setCommentCount((c) => c + 1);
      if (!commentUserMap[currentUser.uid]) {
        setCommentUserMap((m) => ({ ...m, [currentUser.uid]: {
          uid: currentUser.uid, email: currentUser.email ?? undefined, displayName: currentUser.displayName ?? undefined,
        }}));
      }
    } catch (err) { setCommentText(text); alert(`Failed to post comment: ${err}`); }
    finally { setPostingComment(false); }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!video?.id || deletingCommentId) return;
    setDeletingCommentId(commentId);
    try {
      await deleteComment(video.id, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setCommentCount((c) => Math.max(0, c - 1));
    } catch (err) { alert(`Failed to delete comment: ${err}`); }
    finally { setDeletingCommentId(null); }
  };

  const handleSaveEdit = async (commentId: string) => {
    if (!video?.id || savingCommentId || !editCommentText.trim()) return;
    setSavingCommentId(commentId);
    try {
      await editComment(video.id, commentId, editCommentText.trim());
      setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, text: editCommentText.trim() } : c));
      setEditingCommentId(null);
      setEditCommentText('');
    } catch (err) { alert(`Failed to edit comment: ${err}`); }
    finally { setSavingCommentId(null); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────────

  const isOwner = !!currentUser && !!video?.uid && currentUser.uid === video.uid;
  const title = video?.title && video.title.length > 0 ? video.title : 'Untitled';
  const description = video?.description && video.description.length > 0 ? video.description : null;
  const uploaderLabel = formatUploader(uploader);
  const posterUrl = video?.thumbnailUrl && video.thumbnailUrl.length > 0
    ? video.thumbnailUrl : '/images/thumbnails/thumbnail.png';

  const resolvedVideoUrl =
    video?.resolutions && video.resolutions.length > 0 && selectedResolution
      ? `${videoPrefix}${video.id}_${selectedResolution}.mp4`
      : `${videoPrefix}${videoSrc}`;

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (bufferedEnd / duration) * 100 : 0;

  const VolumeIcon = muted || volume === 0 ? IconVolumeMuted : volume < 0.5 ? IconVolumeLow : IconVolumeHigh;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.watchPage}>

      {/* ── Custom video player ── */}
      <div
        ref={containerRef}
        className={`${styles.videoContainer}${!controlsVisible ? ' ' + styles.controlsHidden : ''}`}
        onMouseMove={resetControlsTimer}
        onMouseLeave={() => { if (!pausedRef.current) setControlsVisible(false); }}
        onTouchStart={resetControlsTimer}
      >
        <video
          ref={videoRef}
          src={resolvedVideoUrl}
          poster={posterUrl}
          className={styles.videoPlayer}
          onClick={togglePlay}
          onPlay={() => { setPaused(false); resetControlsTimer(); }}
          onPause={() => {
            setPaused(true);
            setControlsVisible(true);
            if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
          }}
          onTimeUpdate={() => { const v = videoRef.current; if (v) setCurrentTime(v.currentTime); }}
          onDurationChange={() => { const v = videoRef.current; if (v) setDuration(v.duration); }}
          onProgress={() => {
            const v = videoRef.current;
            if (v && v.buffered.length > 0) setBufferedEnd(v.buffered.end(v.buffered.length - 1));
          }}
          onVolumeChange={() => {
            const v = videoRef.current;
            if (v) { setVolume(v.volume); setMuted(v.muted); }
          }}
          onLoadedMetadata={() => {
            const v = videoRef.current;
            if (!v) return;
            setDuration(v.duration);
            if (restoreTimeRef.current) {
              v.currentTime = restoreTimeRef.current.time;
              if (restoreTimeRef.current.playing) v.play();
              restoreTimeRef.current = null;
            }
          }}
        />

        {/* Feedback overlay */}
        {feedbackState && (
          <div key={feedbackState.id} className={styles.feedbackOverlay}>
            {feedbackState.icon}
          </div>
        )}

        {/* Control bar */}
        <div className={`${styles.controlBar}${!controlsVisible ? ' ' + styles.controlBarHidden : ''}`}>
          {/* Progress */}
          <div ref={progressRef} className={styles.progressArea} onMouseDown={handleProgressMouseDown}>
            <div className={styles.progressTrack}>
              <div className={styles.progressBuffered} style={{ width: `${bufferedPct}%` }} />
              <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
              <div className={styles.progressScrubber} style={{ left: `${progressPct}%` }} />
            </div>
          </div>

          {/* Row */}
          <div className={styles.controlsRow}>
            {/* Left */}
            <div className={styles.controlsLeft}>
              <button type="button" className={styles.controlBtn} onClick={togglePlay} title={paused ? 'Play (Space)' : 'Pause (Space)'}>
                {paused ? <IconPlay /> : <IconPause />}
              </button>

              <div
                className={styles.volumeWrap}
                onMouseEnter={() => setShowVolSlider(true)}
                onMouseLeave={() => setShowVolSlider(false)}
              >
                <button type="button" className={styles.controlBtn} onClick={() => setMuted((m) => !m)} title="Toggle mute (M)">
                  <VolumeIcon />
                </button>
                {showVolSlider && (
                  <input
                    type="range"
                    className={styles.volumeInput}
                    min={0} max={1} step={0.02}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVolume(val);
                      setMuted(val === 0);
                    }}
                  />
                )}
              </div>

              <span className={styles.timeDisplay}>{formatTime(currentTime)} / {formatTime(duration)}</span>
            </div>

            {/* Right */}
            <div className={styles.controlsRight}>
              <div ref={settingsRef} className={styles.settingsWrap}>
                <button
                  type="button"
                  className={`${styles.controlBtn}${settingsOpen ? ' ' + styles.controlBtnActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); setSettingsOpen((o) => !o); }}
                  title="Settings"
                >
                  <IconSettings />
                </button>

                {settingsOpen && (
                  <div className={styles.settingsPopup} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.settingsSection}>
                      <div className={styles.settingsSectionLabel}>Playback Speed</div>
                      <div className={styles.settingsOptions}>
                        {SPEEDS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`${styles.settingsOptionBtn}${playbackSpeed === s ? ' ' + styles.settingsOptionActive : ''}`}
                            onClick={() => applySpeed(s)}
                          >
                            {s === 1 ? 'Normal' : `${s}x`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {video?.resolutions && video.resolutions.length > 1 && (
                      <>
                        <div className={styles.settingsDivider} />
                        <div className={styles.settingsSection}>
                          <div className={styles.settingsSectionLabel}>Quality</div>
                          <div className={styles.settingsOptions}>
                            {video.resolutions.map((res) => (
                              <button
                                key={res}
                                type="button"
                                className={`${styles.settingsOptionBtn}${selectedResolution === res ? ' ' + styles.settingsOptionActive : ''}`}
                                onClick={() => handleResolutionChange(res)}
                              >
                                {res}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button type="button" className={styles.controlBtn} onClick={toggleFullscreen} title="Fullscreen (F)">
                {isFullscreen ? <IconFullscreenExit /> : <IconFullscreen />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Below player ── */}
      <div className={styles.contentRow}>
        <div className={styles.mainColumn}>
          <div className={styles.videoInfoSection}>
            <h1 className={styles.videoTitle}>{title}</h1>
            <p className={styles.uploader}>Uploader: {uploaderLabel}</p>
            <div className={styles.metadataRow}>
              {viewCount !== null && (
                <span className={styles.viewCount}>{viewCount} {viewCount === 1 ? 'view' : 'views'}</span>
              )}
              {video?.id && (
                <span className={styles.uploadDate}>Uploaded {formatUploadDate(parseUploadDate(video.id))}</span>
              )}
            </div>

            <div className={styles.likeRow}>
              <button
                type="button"
                className={`${styles.likeButton} ${likeAction === 'like' ? styles.likeButtonActive : ''}`}
                onClick={() => handleToggleLike('like')}
                disabled={!currentUser || togglingLike}
                title={currentUser ? 'Like' : 'Sign in to like'}
              >👍 {likeCount}</button>
              <button
                type="button"
                className={`${styles.likeButton} ${likeAction === 'dislike' ? styles.dislikeButtonActive : ''}`}
                onClick={() => handleToggleLike('dislike')}
                disabled={!currentUser || togglingLike}
                title={currentUser ? 'Dislike' : 'Sign in to dislike'}
              >👎 {dislikeCount}</button>
            </div>

            {description && <p className={styles.description}>{description}</p>}
            <div className={styles.divider} />

            <div className={styles.channelRow}>
              <div className={styles.avatar}><span className={styles.avatarInitials}>KL</span></div>
              <div className={styles.channelInfo}><h3 className={styles.channelName}>KoraLabs Video</h3></div>
              {isOwner && (
                <Link href={`/studio?edit=${video?.id}`} className={styles.editButton}>Edit video</Link>
              )}
              {canSubscribe && (
                <button
                  type="button"
                  className={subscribed ? styles.unsubscribeButton : styles.subscribeButton}
                  onClick={handleToggleSubscription}
                  disabled={togglingSub}
                >
                  {subscribed ? 'Unsubscribe' : 'Subscribe'}
                </button>
              )}
              <span className={styles.subscriberCount}>
                {subscriberCount} {subscriberCount === 1 ? 'subscriber' : 'subscribers'}
              </span>
            </div>
          </div>

          <div id="comments" className={styles.commentsSection}>
            <h2 className={styles.commentsHeading}>{commentCount} {commentCount === 1 ? 'Comment' : 'Comments'}</h2>
            <div className={styles.divider} />

            {currentUser ? (
              <div className={styles.commentPostRow}>
                <textarea
                  className={styles.commentInput}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment…"
                  maxLength={500}
                  rows={2}
                  disabled={postingComment}
                />
                <button
                  type="button"
                  className={styles.commentPostButton}
                  onClick={handlePostComment}
                  disabled={!commentText.trim() || postingComment}
                >
                  {postingComment ? 'Posting…' : 'Post'}
                </button>
              </div>
            ) : (
              <p className={styles.signInPrompt}>Sign in to leave a comment.</p>
            )}

            {comments.map((c) => {
              const commenter = commentUserMap[c.uid] ?? null;
              const displayName = commenter?.displayName || commenter?.email || 'User';
              const initials = displayName.slice(0, 2).toUpperCase();
              return (
                <div key={c.id} className={styles.commentCard}>
                  <div className={styles.commentAvatar}>
                    <span className={styles.avatarInitials}>{initials}</span>
                  </div>
                  <div className={styles.commentContent}>
                    <div className={styles.commentHeader}>
                      <span className={styles.username}>{displayName}</span>
                      <span className={styles.timestamp}>{relativeTime(c.createdAt)}</span>
                      {currentUser?.uid === c.uid && (
                        <div className={styles.commentMenuWrap} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className={styles.commentMenuBtn}
                            onClick={() => setOpenMenuId(openMenuId === c.id ? null : c.id)}
                            title="More options"
                          >⋮</button>
                          {openMenuId === c.id && (
                            <div className={styles.commentDropdown}>
                              <button
                                type="button"
                                className={styles.commentDropdownItem}
                                onClick={() => { setEditingCommentId(c.id); setEditCommentText(c.text); setOpenMenuId(null); }}
                              >Edit</button>
                              <button
                                type="button"
                                className={styles.commentDropdownItem}
                                onClick={() => { handleDeleteComment(c.id); setOpenMenuId(null); }}
                                disabled={deletingCommentId === c.id}
                              >Delete</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {editingCommentId === c.id ? (
                      <div className={styles.commentEditWrap}>
                        <textarea
                          className={styles.commentInput}
                          value={editCommentText}
                          onChange={(e) => setEditCommentText(e.target.value)}
                          rows={2}
                          maxLength={500}
                          disabled={savingCommentId === c.id}
                        />
                        <div className={styles.commentEditActions}>
                          <button type="button" className={styles.commentCancelBtn}
                            onClick={() => { setEditingCommentId(null); setEditCommentText(''); }}
                            disabled={savingCommentId === c.id}
                          >Cancel</button>
                          <button type="button" className={styles.commentSaveBtn}
                            onClick={() => handleSaveEdit(c.id)}
                            disabled={!editCommentText.trim() || savingCommentId === c.id}
                          >{savingCommentId === c.id ? 'Saving…' : 'Save'}</button>
                        </div>
                      </div>
                    ) : (
                      <p className={styles.commentText}>{c.text}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {comments.length === 0 && <p className={styles.noComments}>No comments yet. Be the first!</p>}
          </div>
        </div>

        <div className={styles.sidebar}>
          <h2 className={styles.sidebarHeading}>Up Next</h2>
          {[
            { t: 'Related Video Title 1', d: '10:25' },
            { t: 'Related Video Title 2', d: '15:42' },
            { t: 'Related Video Title 3', d: '8:17' },
            { t: 'Related Video Title 4', d: '12:30' },
            { t: 'Related Video Title 5', d: '20:15' },
          ].map((rv) => (
            <div key={rv.t} className={styles.relatedVideoCard}>
              <div className={styles.thumbnailPlaceholder} />
              <div className={styles.videoDetails}>
                <h3 className={styles.relatedVideoTitle}>{rv.t}</h3>
                <p className={styles.channelName}>KoraLabs Video</p>
                <p className={styles.duration}>{rv.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Watch() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <WatchContent />
    </Suspense>
  );
}
