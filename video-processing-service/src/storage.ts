import { Storage } from "@google-cloud/storage";
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';


const storage = new Storage();

const rawVideoBucketName = "koralabs-raw-videos";
const processedVideoBucketName = "koralabs-processed-videos";

const localRawVideoPath = "./raw-videos";
const localProcessedVideoPath = "./processed-videos";

/**
 * Creates the local directories for raw and processed videos.
 */
export function setupDirectories() {
  ensureDirectoryExistence(localRawVideoPath);
  ensureDirectoryExistence(localProcessedVideoPath);
}


const HLS_VARIANTS = [
  { label: '1080p', height: 1080, width: 1920, bandwidth: 5000000 },
  { label: '720p',  height: 720,  width: 1280, bandwidth: 2800000 },
  { label: '480p',  height: 480,  width: 854,  bandwidth: 1400000 },
  { label: '360p',  height: 360,  width: 640,  bandwidth: 800000  },
];

/**
 * Probes the source video and returns its height in pixels.
 */
function getVideoHeight(rawVideoName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(
      `${localRawVideoPath}/${rawVideoName}`,
      (err, metadata) => {
        if (err) return reject(err);
        const stream = metadata.streams.find(
          (s) => s.codec_type === 'video'
        );
        if (!stream?.height) {
          return reject(new Error('Could not determine video height'));
        }
        resolve(stream.height);
      }
    );
  });
}

/**
 * Probes a local file and returns its duration in seconds.
 */
export function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration;
      if (typeof duration !== 'number' || !Number.isFinite(duration)) {
        return reject(new Error('Could not determine video duration'));
      }
      resolve(Math.round(duration));
    });
  });
}

/**
 * Transcodes a raw video to HLS segments for a single resolution.
 */
function transcodeResolutionToHLS(
  rawVideoName: string,
  videoId: string,
  label: string,
  height: number,
): Promise<void> {
  const segmentPattern =
    `${localProcessedVideoPath}/${videoId}_${label}_%03d.ts`;
  const outputPlaylist =
    `${localProcessedVideoPath}/${videoId}_${label}.m3u8`;
  return new Promise((resolve, reject) => {
    ffmpeg(`${localRawVideoPath}/${rawVideoName}`)
      .outputOptions('-vf', `scale=-2:${height}`)
      .outputOptions('-c:v', 'libx264')
      .outputOptions('-crf', '23')
      .outputOptions('-preset', 'fast')
      .outputOptions('-g', '144')
      .outputOptions('-keyint_min', '144')
      .outputOptions('-force_key_frames', 'expr:gte(t,n_forced*6)')
      .outputOptions('-c:a', 'aac')
      .outputOptions('-hls_time', '6')
      .outputOptions('-hls_list_size', '0')
      .outputOptions('-hls_playlist_type', 'vod')
      .outputOptions('-hls_segment_filename', segmentPattern)
      .on('end', () => {
        console.log(`HLS transcode for ${label} complete`);
        resolve();
      })
      .on('error', (err: any) => {
        console.error(`HLS transcode error for ${label}: ${err.message}`);
        reject(err);
      })
      .save(outputPlaylist);
  });
}

/**
 * Uploads an HLS file (.m3u8 or .ts) with the correct Content-Type.
 * Files are stored under a per-video folder: {videoId}/{fileName}.
 */
async function uploadHlsFile(
  fileName: string,
  videoId: string,
): Promise<void> {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const contentType =
    ext === 'm3u8' ? 'application/x-mpegURL' : 'video/MP2T';

  const destination = `${videoId}/${fileName}`;
  const bucket = storage.bucket(processedVideoBucketName);
  await bucket.upload(`${localProcessedVideoPath}/${fileName}`, {
    destination,
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      contentType,
    },
  });
  await bucket.file(destination).makePublic();
  console.log(`Uploaded ${destination} (${contentType})`);
}

/**
 * Transcodes the raw video into HLS adaptive streams, generates a
 * master playlist, uploads everything to Cloud Storage, and cleans up.
 * 360p is always included; higher resolutions are skipped if the source
 * is shorter.
 * @returns The master playlist filename, e.g. "{videoId}_master.m3u8".
 */
export async function transcodeToHLS(
  rawVideoName: string,
  videoId: string,
  onResolutionComplete?: (done: number, total: number) => Promise<void>,
): Promise<string> {
  const sourceHeight = await getVideoHeight(rawVideoName);
  console.log(`Source video height: ${sourceHeight}px`);

  const toProcess = HLS_VARIANTS.filter(
    ({ height, label }) => height <= sourceHeight || label === '360p'
  );

  // Transcode each resolution to HLS segments + per-resolution playlist
  for (let i = 0; i < toProcess.length; i++) {
    const { label, height } = toProcess[i];
    await transcodeResolutionToHLS(rawVideoName, videoId, label, height);
    if (onResolutionComplete) {
      await onResolutionComplete(i + 1, toProcess.length);
    }
  }

  // Generate master playlist referencing each variant stream — lowest quality
  // first so hls.js level 0 maps to the lowest resolution, enabling natural
  // conservative start without requiring startLevel overrides.
  const masterFilename = `${videoId}_master.m3u8`;
  const masterVariants = [...toProcess].reverse(); // ascending: 360p → 1080p
  let master = '#EXTM3U\n#EXT-X-VERSION:3\n';
  for (const { label, width, height, bandwidth } of masterVariants) {
    master += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},`;
    master += `RESOLUTION=${width}x${height}\n`;
    master += `${videoId}_${label}.m3u8\n`;
  }
  fs.writeFileSync(
    `${localProcessedVideoPath}/${masterFilename}`, master,
  );

  // Upload all generated HLS files (.m3u8 playlists + .ts segments)
  const localFiles = fs.readdirSync(localProcessedVideoPath);
  const hlsFiles = localFiles.filter(
    (f) => f.startsWith(`${videoId}_`) &&
           (f.endsWith('.m3u8') || f.endsWith('.ts'))
  );
  for (const file of hlsFiles) {
    await uploadHlsFile(file, videoId);
  }

  // Clean up all local HLS files
  for (const file of hlsFiles) {
    await deleteProcessedVideo(file);
  }

  return `${videoId}/${masterFilename}`;
}


/**
 * @param fileName - The name of the file to download from the 
 * {@link rawVideoBucketName} bucket into the {@link localRawVideoPath} folder.
 * @returns A promise that resolves when the file has been downloaded.
 */
export async function downloadRawVideo(fileName: string) {
  await storage.bucket(rawVideoBucketName)
    .file(fileName)
    .download({
      destination: `${localRawVideoPath}/${fileName}`,
    });

  console.log(
    `gs://${rawVideoBucketName}/${fileName} downloaded to ${localRawVideoPath}/${fileName}.`
  );
}


/**
 * @param fileName - The name of the file to upload from the 
 * {@link localProcessedVideoPath} folder into the {@link processedVideoBucketName}.
 * @returns A promise that resolves when the file has been uploaded.
 */
export async function uploadProcessedVideo(fileName: string) {
  const bucket = storage.bucket(processedVideoBucketName);

  // Upload video to the bucket
  await storage.bucket(processedVideoBucketName)
    .upload(`${localProcessedVideoPath}/${fileName}`, {
      destination: fileName,
      metadata: {
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
  console.log(
    `${localProcessedVideoPath}/${fileName} uploaded to gs://${processedVideoBucketName}/${fileName}.`
  );

  // Set the video to be publicly readable
  await bucket.file(fileName).makePublic();
}


/**
 * @param fileName - The name of the file to delete from the
 * {@link localRawVideoPath} folder.
 * @returns A promise that resolves when the file has been deleted.
 *
 */
export function deleteRawVideo(fileName: string) {
  return deleteFile(`${localRawVideoPath}/${fileName}`);
}


/**
 * @param fileName - The name of the file to delete from the
 * {@link rawVideoBucketName} bucket in Cloud Storage.
 * @returns A promise that resolves when the file has been deleted.
 */
export async function deleteRawVideoFromBucket(fileName: string) {
  await storage.bucket(rawVideoBucketName).file(fileName).delete();
  console.log(
    `gs://${rawVideoBucketName}/${fileName} deleted from Cloud Storage.`
  );
}


/**
* @param fileName - The name of the file to delete from the
* {@link localProcessedVideoPath} folder.
* @returns A promise that resolves when the file has been deleted.
* 
*/
export function deleteProcessedVideo(fileName: string) {
  return deleteFile(`${localProcessedVideoPath}/${fileName}`);
}


/**
 * @param filePath - The path of the file to delete.
 * @returns A promise that resolves when the file has been deleted.
 */
function deleteFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`Failed to delete file at ${filePath}`, err);
          reject(err);
        } else {
          console.log(`File deleted at ${filePath}`);
          resolve();
        }
      });
    } else {
      console.log(`File not found at ${filePath}, skipping delete.`);
      resolve();
    }
  });
}


/**
 * Ensures a directory exists, creating it if necessary.
 * @param {string} dirPath - The directory path to check.
 */
function ensureDirectoryExistence(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true }); // recursive: true enables creating nested directories
    console.log(`Directory created at ${dirPath}`);
  }
}