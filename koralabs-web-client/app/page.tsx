import styles from './page.module.css'
import Image from 'next/image';
import Link from 'next/link';
import {getVideos} from './firebase/functions';

export default async function Home() {
  const videos = await getVideos();

  return (
    <main className={styles.main}>
      <div className={styles.videoGrid}>
        {
          videos.map((video) => (
            <Link href={`/watch?v=${video.filename}`} key={video.id} className={styles.cardLink}>
              <div className={styles.videoCard}>
                <div className={styles.thumbnailContainer}>
                  <Image
                    src={'/images/thumbnails/thumbnail.png'} // Placeholder thumbnail
                    alt={video.title || 'Video thumbnail'}
                    width={300}
                    height={169}
                    className={styles.thumbnail}
                  />
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.videoTitle}>{video.title && video.title.length > 0 ? video.title : 'Untitled'}</h3>
                  {video.description && video.description.length > 0 && (
                    <p className={styles.description}>{video.description}</p>
                  )}
                  <p className={styles.uploader}>Uploader: {video.uid || 'Unknown'}</p>
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
