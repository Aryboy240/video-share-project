'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { User as FirebaseAuthUser } from 'firebase/auth';
import { onAuthStateChangedHelper } from '../../firebase/firebase';
import {
  getUserById, getChannelVideos, toggleSubscription, getSubscriptionStatus,
  formatUploader, User, Video,
} from '../../firebase/functions';
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

export default function ChannelPage() {
  const params = useParams();
  const uid = typeof params.uid === 'string'
    ? params.uid
    : Array.isArray(params.uid) ? params.uid[0] : '';

  const [channelUser, setChannelUser] = useState<User | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [currentUser, setCurrentUser] = useState<FirebaseAuthUser | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [togglingSub, setTogglingSub] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChangedHelper((user) => setCurrentUser(user));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    Promise.all([
      getUserById(uid).catch(() => null),
      getChannelVideos(uid).catch(() => [] as Video[]),
    ]).then(([user, vids]) => {
      setChannelUser(user);
      setSubscriberCount(user?.subscriberCount ?? 0);
      setVideos(vids);
    }).finally(() => setLoading(false));
  }, [uid]);

  useEffect(() => {
    if (!currentUser || !uid || currentUser.uid === uid) {
      setSubscribed(false);
      return;
    }
    getSubscriptionStatus(uid)
      .then((r) => setSubscribed(r.subscribed))
      .catch(() => {});
  }, [currentUser, uid]);

  const handleToggleSubscription = async () => {
    if (!currentUser || !uid || togglingSub) return;
    setTogglingSub(true);
    try {
      const { subscribed: newSub } = await toggleSubscription(uid);
      setSubscribed(newSub);
      setSubscriberCount((c) => newSub ? c + 1 : Math.max(0, c - 1));
    } catch {
      // ignore
    } finally {
      setTogglingSub(false);
    }
  };

  if (!loading && !channelUser) {
    return (
      <div className={styles.page}>
        <div className={styles.notFound}>
          <h2 className={styles.notFoundTitle}>Channel not found</h2>
          <p className={styles.notFoundMsg}>This channel doesn&apos;t exist or may have been removed.</p>
          <Link href="/" className={styles.notFoundLink}>Go home</Link>
        </div>
      </div>
    );
  }

  const displayName = formatUploader(channelUser);
  const initial = displayName.slice(0, 1).toUpperCase();
  const isOwner = !!currentUser && currentUser.uid === uid;
  const canSubscribe = !!currentUser && !isOwner;

  return (
    <div className={styles.page}>
      <div className={styles.banner}>
        <div className={styles.bannerAvatar}>
          {channelUser?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={channelUser.photoUrl} alt={displayName} className={styles.bannerAvatarImg} />
          ) : (
            <span className={styles.bannerAvatarInitial}>{initial}</span>
          )}
        </div>
        <div className={styles.bannerInfo}>
          <h1 className={styles.bannerName}>{displayName}</h1>
          <p className={styles.bannerSubs}>
            {subscriberCount} {subscriberCount === 1 ? 'subscriber' : 'subscribers'}
          </p>
        </div>
        <div className={styles.bannerActions}>
          {isOwner && (
            <Link href="/studio" className={styles.editChannelButton}>Edit channel</Link>
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
        </div>
      </div>

      <div className={styles.content}>
        {loading ? (
          <p className={styles.emptyState}>Loading…</p>
        ) : videos.length === 0 ? (
          <p className={styles.emptyState}>No videos yet.</p>
        ) : (
          <div className={styles.videoGrid}>
            {videos.map((video) => {
              const ts = parseTimestamp(video.id);
              const thumbSrc =
                video.thumbnailSmallUrl ?? '/images/thumbnails/thumbnail.png';
              return (
                <Link
                  key={video.id}
                  href={`/watch?v=${video.filename ?? video.id}`}
                  className={styles.cardLink}
                >
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
                      {video.duration != null && (
                        <span className={styles.durationBadge}>{formatDuration(video.duration)}</span>
                      )}
                    </div>
                    <div className={styles.cardInfo}>
                      <h3 className={styles.videoTitle}>{video.title || 'Untitled'}</h3>
                      <p className={styles.cardStats}>
                        {formatViewCount(video.viewCount ?? 0)}
                        {ts !== null && <> &bull; {timeAgo(ts)}</>}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
