"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupDirectories = setupDirectories;
exports.getVideoDuration = getVideoDuration;
exports.transcodeToHLS = transcodeToHLS;
exports.downloadRawVideo = downloadRawVideo;
exports.uploadProcessedVideo = uploadProcessedVideo;
exports.deleteRawVideo = deleteRawVideo;
exports.deleteRawVideoFromBucket = deleteRawVideoFromBucket;
exports.deleteProcessedVideo = deleteProcessedVideo;
const storage_1 = require("@google-cloud/storage");
const fs_1 = __importDefault(require("fs"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const storage = new storage_1.Storage();
const rawVideoBucketName = "koralabs-raw-videos";
const processedVideoBucketName = "koralabs-processed-videos";
const localRawVideoPath = "./raw-videos";
const localProcessedVideoPath = "./processed-videos";
/**
 * Creates the local directories for raw and processed videos.
 */
function setupDirectories() {
    ensureDirectoryExistence(localRawVideoPath);
    ensureDirectoryExistence(localProcessedVideoPath);
}
const HLS_VARIANTS = [
    { label: '1080p', height: 1080, width: 1920, bandwidth: 5000000 },
    { label: '720p', height: 720, width: 1280, bandwidth: 2800000 },
    { label: '480p', height: 480, width: 854, bandwidth: 1400000 },
    { label: '360p', height: 360, width: 640, bandwidth: 800000 },
];
/**
 * Probes the source video and returns its height in pixels.
 */
function getVideoHeight(rawVideoName) {
    return new Promise((resolve, reject) => {
        fluent_ffmpeg_1.default.ffprobe(`${localRawVideoPath}/${rawVideoName}`, (err, metadata) => {
            if (err)
                return reject(err);
            const stream = metadata.streams.find((s) => s.codec_type === 'video');
            if (!(stream === null || stream === void 0 ? void 0 : stream.height)) {
                return reject(new Error('Could not determine video height'));
            }
            resolve(stream.height);
        });
    });
}
/**
 * Probes a local file and returns its duration in seconds.
 */
function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        fluent_ffmpeg_1.default.ffprobe(filePath, (err, metadata) => {
            if (err)
                return reject(err);
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
function transcodeResolutionToHLS(rawVideoName, videoId, label, height) {
    const segmentPattern = `${localProcessedVideoPath}/${videoId}_${label}_%03d.ts`;
    const outputPlaylist = `${localProcessedVideoPath}/${videoId}_${label}.m3u8`;
    return new Promise((resolve, reject) => {
        (0, fluent_ffmpeg_1.default)(`${localRawVideoPath}/${rawVideoName}`)
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
            .on('error', (err) => {
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
function uploadHlsFile(fileName, videoId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ext = (_a = fileName.split('.').pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        const contentType = ext === 'm3u8' ? 'application/x-mpegURL' : 'video/MP2T';
        const destination = `${videoId}/${fileName}`;
        const bucket = storage.bucket(processedVideoBucketName);
        yield bucket.upload(`${localProcessedVideoPath}/${fileName}`, {
            destination,
            metadata: {
                cacheControl: 'public, max-age=31536000, immutable',
                contentType,
            },
        });
        yield bucket.file(destination).makePublic();
        console.log(`Uploaded ${destination} (${contentType})`);
    });
}
/**
 * Transcodes the raw video into HLS adaptive streams, generates a
 * master playlist, uploads everything to Cloud Storage, and cleans up.
 * 360p is always included; higher resolutions are skipped if the source
 * is shorter.
 * @returns The master playlist filename, e.g. "{videoId}_master.m3u8".
 */
function transcodeToHLS(rawVideoName, videoId) {
    return __awaiter(this, void 0, void 0, function* () {
        const sourceHeight = yield getVideoHeight(rawVideoName);
        console.log(`Source video height: ${sourceHeight}px`);
        const toProcess = HLS_VARIANTS.filter(({ height, label }) => height <= sourceHeight || label === '360p');
        // Transcode each resolution to HLS segments + per-resolution playlist
        for (const { label, height } of toProcess) {
            yield transcodeResolutionToHLS(rawVideoName, videoId, label, height);
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
        fs_1.default.writeFileSync(`${localProcessedVideoPath}/${masterFilename}`, master);
        // Upload all generated HLS files (.m3u8 playlists + .ts segments)
        const localFiles = fs_1.default.readdirSync(localProcessedVideoPath);
        const hlsFiles = localFiles.filter((f) => f.startsWith(`${videoId}_`) &&
            (f.endsWith('.m3u8') || f.endsWith('.ts')));
        for (const file of hlsFiles) {
            yield uploadHlsFile(file, videoId);
        }
        // Clean up all local HLS files
        for (const file of hlsFiles) {
            yield deleteProcessedVideo(file);
        }
        return `${videoId}/${masterFilename}`;
    });
}
/**
 * @param fileName - The name of the file to download from the
 * {@link rawVideoBucketName} bucket into the {@link localRawVideoPath} folder.
 * @returns A promise that resolves when the file has been downloaded.
 */
function downloadRawVideo(fileName) {
    return __awaiter(this, void 0, void 0, function* () {
        yield storage.bucket(rawVideoBucketName)
            .file(fileName)
            .download({
            destination: `${localRawVideoPath}/${fileName}`,
        });
        console.log(`gs://${rawVideoBucketName}/${fileName} downloaded to ${localRawVideoPath}/${fileName}.`);
    });
}
/**
 * @param fileName - The name of the file to upload from the
 * {@link localProcessedVideoPath} folder into the {@link processedVideoBucketName}.
 * @returns A promise that resolves when the file has been uploaded.
 */
function uploadProcessedVideo(fileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const bucket = storage.bucket(processedVideoBucketName);
        // Upload video to the bucket
        yield storage.bucket(processedVideoBucketName)
            .upload(`${localProcessedVideoPath}/${fileName}`, {
            destination: fileName,
            metadata: {
                cacheControl: "public, max-age=31536000, immutable",
            },
        });
        console.log(`${localProcessedVideoPath}/${fileName} uploaded to gs://${processedVideoBucketName}/${fileName}.`);
        // Set the video to be publicly readable
        yield bucket.file(fileName).makePublic();
    });
}
/**
 * @param fileName - The name of the file to delete from the
 * {@link localRawVideoPath} folder.
 * @returns A promise that resolves when the file has been deleted.
 *
 */
function deleteRawVideo(fileName) {
    return deleteFile(`${localRawVideoPath}/${fileName}`);
}
/**
 * @param fileName - The name of the file to delete from the
 * {@link rawVideoBucketName} bucket in Cloud Storage.
 * @returns A promise that resolves when the file has been deleted.
 */
function deleteRawVideoFromBucket(fileName) {
    return __awaiter(this, void 0, void 0, function* () {
        yield storage.bucket(rawVideoBucketName).file(fileName).delete();
        console.log(`gs://${rawVideoBucketName}/${fileName} deleted from Cloud Storage.`);
    });
}
/**
* @param fileName - The name of the file to delete from the
* {@link localProcessedVideoPath} folder.
* @returns A promise that resolves when the file has been deleted.
*
*/
function deleteProcessedVideo(fileName) {
    return deleteFile(`${localProcessedVideoPath}/${fileName}`);
}
/**
 * @param filePath - The path of the file to delete.
 * @returns A promise that resolves when the file has been deleted.
 */
function deleteFile(filePath) {
    return new Promise((resolve, reject) => {
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlink(filePath, (err) => {
                if (err) {
                    console.error(`Failed to delete file at ${filePath}`, err);
                    reject(err);
                }
                else {
                    console.log(`File deleted at ${filePath}`);
                    resolve();
                }
            });
        }
        else {
            console.log(`File not found at ${filePath}, skipping delete.`);
            resolve();
        }
    });
}
/**
 * Ensures a directory exists, creating it if necessary.
 * @param {string} dirPath - The directory path to check.
 */
function ensureDirectoryExistence(dirPath) {
    if (!fs_1.default.existsSync(dirPath)) {
        fs_1.default.mkdirSync(dirPath, { recursive: true }); // recursive: true enables creating nested directories
        console.log(`Directory created at ${dirPath}`);
    }
}
