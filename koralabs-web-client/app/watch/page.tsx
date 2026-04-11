'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import styles from './page.module.css';
import { getVideos, Video } from '../firebase/functions';

function WatchContent() {
  const videoPrefix = 'https://storage.googleapis.com/koralabs-processed-videos/';
  const videoSrc = useSearchParams().get('v');
  const [video, setVideo] = useState<Video | null>(null);

  useEffect(() => {
    if (!videoSrc) return;
    getVideos().then((videos) => {
      const match = videos.find((v) => v.filename === videoSrc);
      setVideo(match ?? null);
    });
  }, [videoSrc]);

  const title = video?.title && video.title.length > 0 ? video.title : 'Untitled';
  const description = video?.description && video.description.length > 0 ? video.description : null;

  return (
    <div className={styles.watchPage}>
      <div className={styles.videoContainer}>
        <video controls src={videoPrefix + videoSrc} className={styles.videoPlayer} />
      </div>

      <div className={styles.contentRow}>
        <div className={styles.mainColumn}>
          <div className={styles.videoInfoSection}>
            <h1 className={styles.videoTitle}>{title}</h1>

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
              <button className={styles.subscribeButton}>Subscribe</button>
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