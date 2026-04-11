import styles from './page.module.css'
import Image from 'next/image';
import Link from 'next/link';
import { getVideos, getUserById, formatUploader, User } from './firebase/functions';

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

export default async function Home() {
  const videos = await getVideos();

  const uniqueUids = Array.from(
    new Set(videos.map((v) => v.uid).filter((u): u is string => !!u))
  );
  const userEntries = await Promise.all(
    uniqueUids.map(async (uid) => {
      try {
        const user = await getUserById(uid);
        return [uid, user] as const;
      } catch {
        return [uid, null] as const;
      }
    })
  );
  const userMap = new Map<string, User | null>(userEntries);

  return (
    <main className={styles.main}>
      <div className={styles.videoGrid}>
        {videos.map((video) => {
          const uploader = video.uid ? userMap.get(video.uid) : null;
          const uploaderName = formatUploader(uploader);
          const initial = uploaderName.slice(0, 1).toUpperCase();
          const ts = parseTimestamp(video.id);
          const thumbSrc = video.thumbnailUrl && video.thumbnailUrl.length > 0
            ? video.thumbnailUrl
            : '/images/thumbnails/thumbnail.png';

          return (
            <Link href={`/watch?v=${video.filename}`} key={video.id} className={styles.cardLink}>
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
        })}
      </div>
    </main>
  );
}

export const revalidate = 30;
