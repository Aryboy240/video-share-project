'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { User as FirebaseAuthUser } from 'firebase/auth';
import styles from './page.module.css';
import { getVideos, getUserById, formatUploader, deleteVideo, toggleSubscription, getSubscriptionStatus, Video, User } from '../firebase/functions';
import { onAuthStateChangedHelper } from '../firebase/firebase';

function WatchContent() {
  const router = useRouter();
  const videoPrefix = 'https://storage.googleapis.com/koralabs-processed-videos/';
  const videoSrc = useSearchParams().get('v');
  const [video, setVideo] = useState<Video | null>(null);
  const [uploader, setUploader] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<FirebaseAuthUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState<number>(0);
  const [togglingSub, setTogglingSub] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChangedHelper((u) => setCurrentUser(u));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!videoSrc) return;
    getVideos().then((videos) => {
      const match = videos.find((v) => v.filename === videoSrc);
      setVideo(match ?? null);
    });
  }, [videoSrc]);

  useEffect(() => {
    if (!video?.uid) {
      setUploader(null);
      return;
    }
    getUserById(video.uid)
      .then((u) => {
        setUploader(u);
        setSubscriberCount(u?.subscriberCount ?? 0);
      })
      .catch(() => setUploader(null));
  }, [video?.uid]);

  useEffect(() => {
    if (!currentUser || !video?.uid || currentUser.uid === video.uid) {
      setSubscribed(false);
      return;
    }
    getSubscriptionStatus(video.uid)
      .then((res) => setSubscribed(res.subscribed))
      .catch(() => setSubscribed(false));
  }, [currentUser, video?.uid]);

  const canSubscribe = !!currentUser && !!video?.uid && currentUser.uid !== video.uid;

  const handleToggleSubscription = async () => {
    if (!video?.uid || togglingSub) return;
    setTogglingSub(true);
    try {
      const res = await toggleSubscription(video.uid);
      setSubscribed(res.subscribed);
      setSubscriberCount((c) => c + (res.subscribed ? 1 : -1));
    } catch (err) {
      alert(`Failed to update subscription: ${err}`);
    } finally {
      setTogglingSub(false);
    }
  };

  const canDelete = !!currentUser && !!video?.uid && currentUser.uid === video.uid;

  const handleDelete = async () => {
    if (!video?.id || deleting) return;
    if (!window.confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
      return;
    }
    setDeleting(true);
    try {
      await deleteVideo(video.id);
      router.push('/');
    } catch (err) {
      alert(`Failed to delete video: ${err}`);
      setDeleting(false);
    }
  };

  const title = video?.title && video.title.length > 0 ? video.title : 'Untitled';
  const description = video?.description && video.description.length > 0 ? video.description : null;
  const uploaderLabel = formatUploader(uploader);
  const posterUrl = video?.thumbnailUrl && video.thumbnailUrl.length > 0
    ? video.thumbnailUrl
    : '/images/thumbnails/thumbnail.png';

  return (
    <div className={styles.watchPage}>
      <div className={styles.videoContainer}>
        <video
          controls
          src={videoPrefix + videoSrc}
          poster={posterUrl}
          className={styles.videoPlayer}
        />
      </div>

      <div className={styles.contentRow}>
        <div className={styles.mainColumn}>
          <div className={styles.videoInfoSection}>
            <h1 className={styles.videoTitle}>{title}</h1>

            <p className={styles.uploader}>Uploader: {uploaderLabel}</p>

            <div className={styles.metadataRow}>
              <span className={styles.viewCount}>240 views</span>
              <span className={styles.uploadDate}>Uploaded 1 April 2026</span>
            </div>

            {description && (
              <p className={styles.description}>{description}</p>
            )}

            <div className={styles.divider}></div>

            <div className={styles.channelRow}>
              <div className={styles.avatar}>
                <span className={styles.avatarInitials}>KL</span>
              </div>
              <div className={styles.channelInfo}>
                <h3 className={styles.channelName}>KoraLabs Video</h3>
              </div>
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
              {canDelete && (
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>

          <div className={styles.commentsSection}>
            <h2 className={styles.commentsHeading}>Comments</h2>
            <div className={styles.divider}></div>

            <div className={styles.commentCard}>
              <div className={styles.commentAvatar}>
                <span className={styles.avatarInitials}>AK</span>
              </div>
              <div className={styles.commentContent}>
                <div className={styles.commentHeader}>
                  <span className={styles.username}>Aryan Kora</span>
                  <span className={styles.timestamp}>2 hours ago</span>
                </div>
                <p className={styles.commentText}>This is a great video! Learned a lot from it.</p>
              </div>
            </div>

            <div className={styles.commentCard}>
              <div className={styles.commentAvatar}>
                <span className={styles.avatarInitials}>VS</span>
              </div>
              <div className={styles.commentContent}>
                <div className={styles.commentHeader}>
                  <span className={styles.username}>Brandon Tidmarsh</span>
                  <span className={styles.timestamp}>5 hours ago</span>
                </div>
                <p className={styles.commentText}>Thanks for sharing this content. Very informative!</p>
              </div>
            </div>

            <div className={styles.commentCard}>
              <div className={styles.commentAvatar}>
                <span className={styles.avatarInitials}>MR</span>
              </div>
              <div className={styles.commentContent}>
                <div className={styles.commentHeader}>
                  <span className={styles.username}>Dylan Ellis-Patey</span>
                  <span className={styles.timestamp}>1 day ago</span>
                </div>
                <p className={styles.commentText}>Could you make more videos like this? I'm really enjoying them.</p>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.sidebar}>
          <h2 className={styles.sidebarHeading}>Up Next</h2>

          <div className={styles.relatedVideoCard}>
            <div className={styles.thumbnailPlaceholder}></div>
            <div className={styles.videoDetails}>
              <h3 className={styles.relatedVideoTitle}>Related Video Title 1</h3>
              <p className={styles.channelName}>KoraLabs Video</p>
              <p className={styles.duration}>10:25</p>
            </div>
          </div>

          <div className={styles.relatedVideoCard}>
            <div className={styles.thumbnailPlaceholder}></div>
            <div className={styles.videoDetails}>
              <h3 className={styles.relatedVideoTitle}>Related Video Title 2</h3>
              <p className={styles.channelName}>KoraLabs Video</p>
              <p className={styles.duration}>15:42</p>
            </div>
          </div>

          <div className={styles.relatedVideoCard}>
            <div className={styles.thumbnailPlaceholder}></div>
            <div className={styles.videoDetails}>
              <h3 className={styles.relatedVideoTitle}>Related Video Title 3</h3>
              <p className={styles.channelName}>KoraLabs Video</p>
              <p className={styles.duration}>8:17</p>
            </div>
          </div>

          <div className={styles.relatedVideoCard}>
            <div className={styles.thumbnailPlaceholder}></div>
            <div className={styles.videoDetails}>
              <h3 className={styles.relatedVideoTitle}>Related Video Title 4</h3>
              <p className={styles.channelName}>KoraLabs Video</p>
              <p className={styles.duration}>12:30</p>
            </div>
          </div>

          <div className={styles.relatedVideoCard}>
            <div className={styles.thumbnailPlaceholder}></div>
            <div className={styles.videoDetails}>
              <h3 className={styles.relatedVideoTitle}>Related Video Title 5</h3>
              <p className={styles.channelName}>KoraLabs Video</p>
              <p className={styles.duration}>20:15</p>
            </div>
          </div>
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