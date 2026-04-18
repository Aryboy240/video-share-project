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
const express_1 = __importDefault(require("express"));
const storage_1 = require("./storage");
const firestore_1 = require("./firestore");
// Create the local directories for videos
(0, storage_1.setupDirectories)();
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Process a video file from Cloud Storage into 360p
app.post('/process-video', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    // Get the bucket and filename from the Cloud Pub/Sub message
    let data;
    try {
        const message = Buffer.from(req.body.message.data, 'base64').toString('utf8');
        data = JSON.parse(message);
        if (!data.name) {
            throw new Error('Invalid message payload received.');
        }
    }
    catch (error) {
        console.error(error);
        return res.status(400).send('Bad Request: missing filename.');
    }
    const inputFileName = data.name; // Format of <UID>-<DATE>.<EXTENSION>
    const videoId = inputFileName.split('.')[0]; // Extract the UID part as video ID
    if (!(yield (0, firestore_1.isVideoNew)(videoId))) {
        return res.status(400).send('Bad Request: video is already being processed.');
    }
    else {
        yield (0, firestore_1.setVideo)(videoId, {
            id: videoId,
            uid: videoId.split('-')[0],
            status: 'processing',
        });
    }
    // Download the raw video from Cloud Storage
    yield (0, storage_1.downloadRawVideo)(inputFileName);
    // Transcode into HLS adaptive streams
    let masterFilename;
    try {
        masterFilename = yield (0, storage_1.transcodeToHLS)(inputFileName, videoId);
    }
    catch (err) {
        yield (0, storage_1.deleteRawVideo)(inputFileName);
        return res.status(500).send('Processing failed');
    }
    const hlsMasterUrl = `https://storage.googleapis.com/koralabs-processed-videos/${masterFilename}`;
    let duration;
    try {
        duration = yield (0, storage_1.getVideoDuration)(`./raw-videos/${inputFileName}`);
    }
    catch (err) {
        console.warn('Could not determine video duration:', err);
    }
    yield (0, firestore_1.setVideo)(videoId, Object.assign({ status: 'processed', filename: videoId, // used as the watch URL param for HLS videos
        hlsMasterUrl, streamType: 'hls' }, (duration !== undefined ? { duration } : {})));
    try {
        yield (0, storage_1.deleteRawVideoFromBucket)(inputFileName);
    }
    catch (err) {
        console.error(`Failed to delete raw video gs://koralabs-raw-videos/${inputFileName}. ` +
            `Processing succeeded; continuing.`, err);
    }
    yield (0, storage_1.deleteRawVideo)(inputFileName);
    return res.status(200).send('Processing finished successfully');
}));
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
