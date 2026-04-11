import styles from './page.module.css'
import Image from 'next/image';
import Link from 'next/link';
import {getVideos, getUserById, formatUploader, User} from './firebase/functions';

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
        {
          videos.map((video) => (
            <Link href={`/watch?v=${video.filename}`} key={video.id} className={styles.cardLink}>
              <div className={styles.videoCard}>
                <div className={styles.thumbnailContainer}>
                  <Image
                    src={video.thumbnailUrl && video.thumbnailUrl.length > 0 ? video.thumbnailUrl : '/images/thumbnails/thumbnail.png'}
                    alt={video.title || 'Video thumbnail'}
                    width={300}
                    height={169}
                    className={styles.thumbnail}
                    unoptimized
                  />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.videoTitle}>{video.title && video.title.length > 0 ? video.title : 'Untitled'}</h3>
                  {video.description && video.description.length > 0 && (
                    <p className={styles.description}>{video.description}</p>
                  )}
                  <p className={styles.uploader}>Uploader: {formatUploader(video.uid ? userMap.get(video.uid) : null)}</p>
                  <div className={styles.statusContainer}>
                    <span className={`${styles.statusBadge} ${video.status === 'processing' ? styles.processing : styles.processed}`}>
                      {video.status === 'processing' ? 'Processing' : 'Processed'}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))
        }
      </div>
    </main>
  )
}

export const revalidate = 30;
