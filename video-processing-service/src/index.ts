import express from 'express';

import {
  downloadRawVideo,
  deleteRawVideo,
  deleteRawVideoFromBucket,
  transcodeToHLS,
  getVideoDuration,
  setupDirectories
} from './storage';

import { isVideoNew, setVideo } from "./firestore";

// Create the local directories for videos
setupDirectories();

const app = express();
app.use(express.json());

// Process a video file from Cloud Storage into 360p
app.post('/process-video', async (req, res) => {

  // Get the bucket and filename from the Cloud Pub/Sub message
  let data;
  try {
    const message = Buffer.from(req.body.message.data, 'base64').toString('utf8');
    data = JSON.parse(message);
    if (!data.name) {
      throw new Error('Invalid message payload received.');
    }
  } catch (error) {
    console.error(error);
    return res.status(400).send('Bad Request: missing filename.');
  }

  const inputFileName = data.name; // Format of <UID>-<DATE>.<EXTENSION>
  const videoId = inputFileName.split('.')[0]; // Extract the UID part as video ID

  if (!await isVideoNew(videoId)) {
    return res.status(400).send('Bad Request: video is already being processed.');
  } else {
    await setVideo(videoId, {
      id: videoId,
      uid: videoId.split('-')[0],
      status: 'processing',
    });
  }

  // Download the raw video from Cloud Storage
  await downloadRawVideo(inputFileName);

  // Transcode into HLS adaptive streams
  let masterFilename: string;
  try {
    masterFilename = await transcodeToHLS(inputFileName, videoId);
  } catch (err) {
    await deleteRawVideo(inputFileName);
    return res.status(500).send('Processing failed');
  }

  const hlsMasterUrl =
    `https://storage.googleapis.com/koralabs-processed-videos/${masterFilename}`;

  let duration: number | undefined;
  try {
    duration = await getVideoDuration(`./raw-videos/${inputFileName}`);
  } catch (err) {
    console.warn('Could not determine video duration:', err);
  }

  await setVideo(videoId, {
    status: 'processed',
    filename: videoId,  // used as the watch URL param for HLS videos
    hlsMasterUrl,
    streamType: 'hls',
    ...(duration !== undefined ? { duration } : {}),
  });

  try {
    await deleteRawVideoFromBucket(inputFileName);
  } catch (err) {
    console.error(
      `Failed to delete raw video gs://koralabs-raw-videos/${inputFileName}. ` +
      `Processing succeeded; continuing.`,
      err
    );
  }

  await deleteRawVideo(inputFileName);

  return res.status(200).send('Processing finished successfully');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});