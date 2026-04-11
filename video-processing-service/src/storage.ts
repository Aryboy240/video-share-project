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


const ALL_RESOLUTIONS = [
  { label: '1080p', height: 1080 },
  { label: '720p',  height: 720  },
  { label: '480p',  height: 480  },
  { label: '360p',  height: 360  },
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
 * Transcodes a raw video to the given height, preserving aspect ratio.
 */
function convertVideoToResolution(
  rawVideoName: string,
  outputName: string,
  height: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(`${localRawVideoPath}/${rawVideoName}`)
      .outputOptions('-vf', `scale=-2:${height}`)
      .outputOptions('-c:v', 'libx264')
      .outputOptions('-crf', '23')
      .outputOptions('-preset', 'fast')
      .outputOptions('-c:a', 'aac')
      .on('end', () => {
        console.log(`Transcoded ${outputName} successfully`);
        resolve();
      })
      .on('error', (err: any) => {
        console.error(`Transcode error for ${outputName}: ${err.message}`);
        reject(err);
      })
      .save(`${localProcessedVideoPath}/${outputName}`);
  });
}

/**
 * Transcodes the raw video into all applicable resolutions, uploads each
 * to Cloud Storage, and cleans up local output files. 360p is always
 * included; higher resolutions are skipped if the source is shorter.
 * @returns Array of resolution labels generated, highest first
 *          (e.g. ['1080p', '720p', '360p']).
 */
export async function transcodeAllResolutions(
  rawVideoName: string,
  videoId: string,
): Promise<string[]> {
  const sourceHeight = await getVideoHeight(rawVideoName);
  console.log(`Source video height: ${sourceHeight}px`);

  const toProcess = ALL_RESOLUTIONS.filter(
    ({ height, label }) => height <= sourceHeight || label === '360p'
  );

  const generated: string[] = [];
  for (const { label, height } of toProcess) {
    const outputName = `${videoId}_${label}.mp4`;
    await convertVideoToResolution(rawVideoName, outputName, height);
    await uploadProcessedVideo(outputName);
    await deleteProcessedVideo(outputName);
    generated.push(label);
  }
  return generated;
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