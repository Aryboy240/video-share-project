import * as functions from "firebase-functions/v1";
import {initializeApp} from "firebase-admin/app";
import {Firestore, FieldValue} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import {Storage} from "@google-cloud/storage";
import {onCall} from "firebase-functions/v2/https";
import sharp from "sharp";
import * as https from "https";
import * as http from "http";

initializeApp();

const firestore = new Firestore({databaseId: "koralabs-video-web-client"});
const storage = new Storage();
const rawVideoBucketName = "koralabs-raw-videos";
const processedVideoBucketName = "koralabs-processed-videos";
const allowedThumbnailExtensions = new Set([
  "jpg", "jpeg", "png", "webp", "gif",
]);

/**
 * Fetches an image from a URL and returns the raw buffer.
 * Follows redirects automatically.
 * @param {string} url - The image URL to fetch.
 * @return {Promise<Buffer>} Resolves with the raw image buffer.
 */
function fetchImageBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        // Follow one redirect
        fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} fetching avatar`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Mirrors a Google profile photo to GCS and returns the public GCS URL.
 * Falls back to the original URL if anything fails.
 * @param {string} uid - The user's UID, used as the GCS filename.
 * @param {string} sourceUrl - The Google profile photo URL to mirror.
 * @return {Promise<string>} The public GCS URL, or sourceUrl on failure.
 */
async function mirrorAvatarToGcs(
  uid: string,
  sourceUrl: string
): Promise<string> {
  try {
    const imgBuffer = await fetchImageBuffer(sourceUrl);
    const jpegBuffer = await sharp(imgBuffer)
      .resize(256, 256, {fit: "cover"})
      .jpeg({quality: 90})
      .toBuffer();
    const bucket = storage.bucket(processedVideoBucketName);
    const dest = `avatars/${uid}.jpg`;
    await bucket.file(dest).save(jpegBuffer, {
      metadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=86400",
      },
    });
    await bucket.file(dest).makePublic();
    return `https://storage.googleapis.com/${processedVideoBucketName}/${dest}`;
  } catch (err) {
    logger.warn(`mirrorAvatarToGcs failed for ${uid}, using original`, err);
    return sourceUrl;
  }
}

export const createUser = functions
  .region("europe-west2")
  .auth.user()
  .onCreate(async (user) => {
    let photoUrl: string | undefined = user.photoURL ?? undefined;
    if (photoUrl) {
      photoUrl = await mirrorAvatarToGcs(user.uid, photoUrl);
    }
    const userInfo = {
      uid: user.uid,
      email: user.email,
      photoUrl: photoUrl ?? null,
      displayName: user.displayName ?? user.email?.split("@")[0] ?? "User",
    };
    await firestore.collection("users").doc(user.uid).set(userInfo);
    logger.info(`User Created: ${JSON.stringify(userInfo)}`);
    return;
  });

export const refreshUserAvatar = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be authenticated."
      );
    }
    const uid = request.auth.uid;
    const authUser = await getAuth().getUser(uid);
    const sourceUrl = authUser.photoURL;
    if (!sourceUrl) {
      return {photoUrl: null};
    }
    const photoUrl = await mirrorAvatarToGcs(uid, sourceUrl);
    await firestore.collection("users").doc(uid).set(
      {photoUrl},
      {merge: true}
    );
    return {photoUrl};
  }
);

export const backfillUserAvatars = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be authenticated."
      );
    }
    await requireAdmin(request.auth.uid);
    const snap = await firestore.collection("users").get();
    let updated = 0;
    await Promise.all(snap.docs.map(async (doc) => {
      const data = doc.data();
      const url: string | undefined = data.photoUrl;
      if (
        !url ||
        !(
          url.includes("lh3.googleusercontent.com") ||
          url.includes("googleusercontent.com")
        )
      ) return;
      try {
        const gcsUrl = await mirrorAvatarToGcs(doc.id, url);
        if (gcsUrl !== url) {
          await doc.ref.set({photoUrl: gcsUrl}, {merge: true});
          updated++;
        }
      } catch (err) {
        logger.warn(`backfillUserAvatars: failed for ${doc.id}`, err);
      }
    }));
    return {updated};
  }
);

const videoCollectionId = "videos";
const watchHistoryCollectionId = "watchHistory";

async function createNotification(
  uid: string,
  notification: {
    type: "comment" | "subscribe" | "like";
    fromUid: string;
    fromName: string;
    videoId?: string;
    videoTitle?: string;
    message: string;
  }
): Promise<void> {
  try {
    await firestore
      .collection("notifications")
      .doc(uid)
      .collection("items")
      .add({
        uid,
        ...notification,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (err) {
    logger.warn("createNotification failed", err);
  }
}

export const generateUploadUrl = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const auth = request.auth;
    const data = request.data;

    const rawTitle = typeof data.title === "string" ? data.title.trim() : "";
    const rawDescription =
      typeof data.description === "string" ? data.description.trim() : "";

    if (!rawTitle) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A video title is required."
      );
    }
    if (rawTitle.length > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Title must be 100 characters or fewer."
      );
    }
    if (rawDescription.length > 500) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Description must be 500 characters or fewer."
      );
    }

    const rawTags: string[] = [];
    if (Array.isArray(data.tags)) {
      for (const t of data.tags) {
        if (typeof t === "string" && t.trim().length > 0) {
          rawTags.push(t.trim().slice(0, 30));
        }
      }
    }
    if (rawTags.length > 10) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Maximum 10 tags allowed."
      );
    }

    const bucket = storage.bucket(rawVideoBucketName);

    const fileName = `${auth.uid}-${Date.now()}.${data.fileExtension}`;
    const videoId = fileName.split(".")[0];

    const rawThumbnailExtension =
      typeof data.thumbnailExtension === "string" ?
        data.thumbnailExtension.trim().toLowerCase().replace(/^\./, "") :
        "";

    let thumbnailUploadUrl: string | null = null;
    let thumbnailUrl: string | null = null;

    if (rawThumbnailExtension) {
      if (!allowedThumbnailExtensions.has(rawThumbnailExtension)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Thumbnail extension must be one of: " +
            Array.from(allowedThumbnailExtensions).join(", ")
        );
      }
      const processedBucket = storage.bucket(processedVideoBucketName);
      const thumbnailPath = `thumbnails/${videoId}.${rawThumbnailExtension}`;
      const [tUrl] = await processedBucket
        .file(thumbnailPath)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000,
          extensionHeaders: {
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      thumbnailUploadUrl = tUrl;
      thumbnailUrl =
        `https://storage.googleapis.com/${processedVideoBucketName}/` +
        thumbnailPath;
    }

    const firestoreDoc: Record<string, unknown> = {
      id: videoId,
      uid: auth.uid,
      title: rawTitle,
      description: rawDescription,
      tags: rawTags,
    };

    await firestore
      .collection(videoCollectionId)
      .doc(videoId)
      .set(firestoreDoc, {merge: true});

    const [url] = await bucket.file(fileName).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
    });

    return {url, fileName, thumbnailUploadUrl, thumbnailUrl};
  }
);

export interface Video {
  id?: string,
  uid?: string,
  filename?: string,
  status?: "processing" | "processed",
  title?: string,
  description?: string,
  tags?: string[],
  thumbnailUrl?: string,
  thumbnailSmallUrl?: string,
  thumbnailMediumUrl?: string,
  resolutions?: string[],
  hlsMasterUrl?: string,
  streamType?: string,
  duration?: number,
}

async function generateThumbnailVariants(
  thumbnailPath: string,
  videoId: string
): Promise<{smallUrl: string; mediumUrl: string}> {
  const processedBucket = storage.bucket(processedVideoBucketName);
  const [srcBuffer] = await processedBucket.file(thumbnailPath).download();
  const [smallBuffer, mediumBuffer] = await Promise.all([
    sharp(srcBuffer)
      .resize(640, 360, {fit: "cover"})
      .jpeg({quality: 80})
      .toBuffer(),
    sharp(srcBuffer)
      .resize(1280, 720, {fit: "cover"})
      .jpeg({quality: 85})
      .toBuffer(),
  ]);
  const smallPath = `thumbnails/small/${videoId}.jpg`;
  const mediumPath = `thumbnails/medium/${videoId}.jpg`;
  const meta = {
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
  };
  await Promise.all([
    processedBucket.file(smallPath).save(smallBuffer, {metadata: meta}),
    processedBucket.file(mediumPath).save(mediumBuffer, {metadata: meta}),
  ]);
  await Promise.all([
    processedBucket.file(smallPath).makePublic(),
    processedBucket.file(mediumPath).makePublic(),
  ]);
  const base = `https://storage.googleapis.com/${processedVideoBucketName}/`;
  return {smallUrl: base + smallPath, mediumUrl: base + mediumPath};
}

export const processThumbnail = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const {videoId, thumbnailPath} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    if (typeof thumbnailPath !== "string" || !thumbnailPath) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A thumbnailPath is required."
      );
    }

    // Verify ownership
    const docRef = firestore.collection(videoCollectionId).doc(videoId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Video not found.");
    }
    if (snap.data()?.uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only process your own videos."
      );
    }

    try {
      const processedBucket = storage.bucket(processedVideoBucketName);
      const {smallUrl, mediumUrl} = await generateThumbnailVariants(
        thumbnailPath,
        videoId
      );
      await docRef.set(
        {thumbnailSmallUrl: smallUrl, thumbnailMediumUrl: mediumUrl},
        {merge: true}
      );
      // Delete original after variants are safely generated and written
      try {
        await processedBucket.file(thumbnailPath).delete();
      } catch (delErr) {
        logger.warn("processThumbnail: could not delete original", delErr);
      }
      return {
        success: true,
        thumbnailSmallUrl: smallUrl,
        thumbnailMediumUrl: mediumUrl,
      };
    } catch (err) {
      logger.error("processThumbnail failed", err);
      throw new functions.https.HttpsError(
        "internal", "Failed to generate thumbnail variants."
      );
    }
  }
);

export const getVideos = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async () => {
    const querySnapshot =
      await firestore.collection(videoCollectionId).limit(50).get();
    return querySnapshot.docs
      .map((doc) => doc.data())
      .filter((v) => v.status === "processed");
  });

export const getVideoById = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    const videoId = request.data?.videoId;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A videoId is required."
      );
    }
    // Try direct doc ID first (covers both legacy MP4 and HLS videos)
    const byId = await firestore
      .collection(videoCollectionId).doc(videoId).get();
    if (byId.exists) return byId.data();
    // Fall back: query by filename field
    const snap = await firestore
      .collection(videoCollectionId)
      .where("filename", "==", videoId)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].data();
  }
);

export const getChannelVideos = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    const uid = request.data?.uid;
    if (typeof uid !== "string" || !uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A uid is required."
      );
    }
    const snap = await firestore
      .collection(videoCollectionId)
      .where("uid", "==", uid)
      .get();
    const docs = snap.docs
      .map((d) => d.data())
      .filter((v) => v.status === "processed");
    docs.sort((a, b) => {
      const ai = typeof a.id === "string" ? a.id : "";
      const bi = typeof b.id === "string" ? b.id : "";
      return bi.localeCompare(ai);
    });
    return docs;
  }
);

export const getUserVideos = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const snap = await firestore
      .collection(videoCollectionId)
      .where("uid", "==", request.auth.uid)
      .get();
    const docs = snap.docs.map((d) => d.data());
    docs.sort((a, b) => {
      const ai = typeof a.id === "string" ? a.id : "";
      const bi = typeof b.id === "string" ? b.id : "";
      return bi.localeCompare(ai);
    });
    return docs;
  }
);

export const getUserById = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    const uid = request.data?.uid;
    if (typeof uid !== "string" || !uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A uid is required."
      );
    }
    const doc = await firestore.collection("users").doc(uid).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() ?? {};
    return {
      uid: data.uid,
      email: data.email,
      displayName: data.displayName,
      photoUrl: data.photoUrl,
      subscriberCount: typeof data.subscriberCount === "number" ?
        data.subscriberCount : 0,
    };
  }
);

export const updateVideoMetadata = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const {videoId, title, description, thumbnailExtension} = request.data;

    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }

    const rawTitle = typeof title === "string" ? title.trim() : "";
    if (!rawTitle) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A video title is required."
      );
    }
    if (rawTitle.length > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Title must be 100 characters or fewer."
      );
    }

    const rawDescription =
      typeof description === "string" ? description.trim() : "";
    if (rawDescription.length > 500) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Description must be 500 characters or fewer."
      );
    }

    const docRef = firestore.collection(videoCollectionId).doc(videoId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Video not found.");
    }
    const video = snap.data() ?? {};
    if (video.uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only edit your own videos."
      );
    }

    const rawTags: string[] = [];
    if (Array.isArray(request.data.tags)) {
      for (const t of request.data.tags) {
        if (typeof t === "string" && t.trim().length > 0) {
          rawTags.push(t.trim().slice(0, 30));
        }
      }
    }
    if (rawTags.length > 10) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Maximum 10 tags allowed."
      );
    }

    const updates: Record<string, unknown> = {
      title: rawTitle,
      description: rawDescription,
      tags: rawTags,
    };

    let thumbnailUploadUrl: string | null = null;
    let thumbnailUrl: string | null = null;

    if (typeof thumbnailExtension === "string" && thumbnailExtension) {
      const ext = thumbnailExtension.trim().toLowerCase().replace(/^\./, "");
      if (!allowedThumbnailExtensions.has(ext)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Thumbnail extension must be one of: " +
            Array.from(allowedThumbnailExtensions).join(", ")
        );
      }
      const processedBucket = storage.bucket(processedVideoBucketName);
      const thumbnailPath = `thumbnails/${videoId}.${ext}`;
      const [tUrl] = await processedBucket
        .file(thumbnailPath)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000,
          extensionHeaders: {
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      thumbnailUploadUrl = tUrl;
      thumbnailUrl =
        `https://storage.googleapis.com/${processedVideoBucketName}/` +
        thumbnailPath;
    }

    await docRef.set(updates, {merge: true});
    return {success: true, thumbnailUploadUrl, thumbnailUrl};
  }
);

export const toggleSubscription = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const channelUid = request.data?.channelUid;
    if (typeof channelUid !== "string" || !channelUid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A channelUid is required."
      );
    }
    const subscriberUid = request.auth.uid;
    if (subscriberUid === channelUid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "You cannot subscribe to yourself."
      );
    }

    const subId = `${subscriberUid}_${channelUid}`;
    const subRef = firestore.collection("subscriptions").doc(subId);
    const channelUserRef = firestore.collection("users").doc(channelUid);

    const subscribed = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(subRef);
      if (snap.exists) {
        tx.delete(subRef);
        tx.set(
          channelUserRef,
          {subscriberCount: FieldValue.increment(-1)},
          {merge: true}
        );
        return false;
      }
      tx.set(subRef, {
        subscriberUid,
        channelUid,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        channelUserRef,
        {subscriberCount: FieldValue.increment(1)},
        {merge: true}
      );
      return true;
    });

    if (subscribed) {
      (async () => {
        try {
          const userSnap = await firestore
            .collection("users").doc(subscriberUid).get();
          const fromName =
            (userSnap.data() ?? {}).displayName as string || "Someone";
          await createNotification(channelUid, {
            type: "subscribe",
            fromUid: subscriberUid,
            fromName,
            message: `${fromName} subscribed to your channel`,
          });
        } catch (err) {
          logger.warn("toggleSubscription notification failed", err);
        }
      })();
    }

    return {subscribed};
  }
);

export const getSubscriptionStatus = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const channelUid = request.data?.channelUid;
    if (typeof channelUid !== "string" || !channelUid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A channelUid is required."
      );
    }
    const subId = `${request.auth.uid}_${channelUid}`;
    const snap = await firestore.collection("subscriptions").doc(subId).get();
    return {subscribed: snap.exists};
  }
);

export const toggleLike = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const {videoId, action} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    if (action !== "like" && action !== "dislike") {
      throw new functions.https.HttpsError(
        "invalid-argument", "action must be \"like\" or \"dislike\"."
      );
    }
    const uid = request.auth.uid;
    const likeRef = firestore
      .collection("videoLikes")
      .doc(`${videoId}__${uid}`);
    const videoRef = firestore.collection(videoCollectionId).doc(videoId);

    const newAction: "like" | "dislike" | null =
      await firestore.runTransaction(async (tx) => {
        const likeSnap = await tx.get(likeRef);
        if (!likeSnap.exists) {
          tx.set(likeRef, {videoId, uid, action});
          tx.set(
            videoRef,
            {[`${action}Count`]: FieldValue.increment(1)},
            {merge: true}
          );
          return action as "like" | "dislike";
        }
        const existing = likeSnap.data()!;
        if (existing.action === action) {
          tx.delete(likeRef);
          tx.set(
            videoRef,
            {[`${action}Count`]: FieldValue.increment(-1)},
            {merge: true}
          );
          return null;
        }
        // switching sides
        tx.set(likeRef, {videoId, uid, action});
        tx.set(
          videoRef,
          {
            [`${existing.action}Count`]: FieldValue.increment(-1),
            [`${action}Count`]: FieldValue.increment(1),
          },
          {merge: true}
        );
        return action as "like" | "dislike";
      });

    if (newAction === "like") {
      (async () => {
        try {
          const [videoSnap, userSnap] = await Promise.all([
            videoRef.get(),
            firestore.collection("users").doc(uid).get(),
          ]);
          const videoData = videoSnap.data() ?? {};
          const ownerUid = videoData.uid as string | undefined;
          if (!ownerUid || ownerUid === uid) return;
          const fromName =
            (userSnap.data() ?? {}).displayName as string || "Someone";
          await createNotification(ownerUid, {
            type: "like",
            fromUid: uid,
            fromName,
            videoId,
            videoTitle: videoData.title as string | undefined,
            message: `${fromName} liked your video`,
          });
        } catch (err) {
          logger.warn("toggleLike notification failed", err);
        }
      })();
    }

    return {action: newAction};
  }
);

export const getLikeStatus = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const {videoId} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    const snap = await firestore
      .collection("videoLikes")
      .doc(`${videoId}__${request.auth.uid}`)
      .get();
    if (!snap.exists) return {action: null};
    const data = snap.data()!;
    return {action: data.action as "like" | "dislike"};
  }
);

export const addComment = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const {videoId, text} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    const rawText = typeof text === "string" ? text.trim() : "";
    if (!rawText) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Comment text is required."
      );
    }
    if (rawText.length > 500) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Comment must be 500 characters or fewer."
      );
    }
    const uid = request.auth.uid;
    const messagesRef = firestore
      .collection("comments").doc(videoId).collection("messages");
    const newRef = messagesRef.doc();
    const videoRef = firestore.collection(videoCollectionId).doc(videoId);
    await firestore.runTransaction(async (tx) => {
      tx.set(newRef, {
        videoId, uid, text: rawText,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(videoRef, {commentCount: FieldValue.increment(1)}, {merge: true});
    });

    // Fire notification — non-fatal, don't await
    (async () => {
      try {
        const [videoSnap, userSnap] = await Promise.all([
          videoRef.get(),
          firestore.collection("users").doc(uid).get(),
        ]);
        const videoData = videoSnap.data() ?? {};
        const ownerUid = videoData.uid as string | undefined;
        if (!ownerUid || ownerUid === uid) return;
        const fromName =
          (userSnap.data() ?? {}).displayName as string || "Someone";
        await createNotification(ownerUid, {
          type: "comment",
          fromUid: uid,
          fromName,
          videoId,
          videoTitle: videoData.title as string | undefined,
          message: `${fromName} commented on your video`,
        });
      } catch (err) {
        logger.warn("addComment notification failed", err);
      }
    })();

    return {id: newRef.id};
  }
);

export const getComments = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    const {videoId} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    const messagesRef = firestore
      .collection("comments").doc(videoId).collection("messages");

    const [pinnedSnap, regularSnap] = await Promise.all([
      messagesRef.where("pinned", "==", true).limit(1).get(),
      messagesRef.orderBy("createdAt", "asc").limit(50).get(),
    ]);

    const mapDoc = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
      const data = d.data();
      const ts = data.createdAt;
      return {
        id: d.id,
        uid: data.uid as string,
        text: data.text as string,
        createdAt: ts ? ts.toDate().toISOString() : null,
        pinned: data.pinned === true,
      };
    };

    const pinnedIds = new Set(pinnedSnap.docs.map((d) => d.id));
    const regular = regularSnap.docs
      .filter((d) => !pinnedIds.has(d.id))
      .map(mapDoc);
    const pinned = pinnedSnap.docs.map(mapDoc);

    return [...pinned, ...regular];
  }
);

export const deleteComment = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const {videoId, commentId} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    if (typeof commentId !== "string" || !commentId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A commentId is required."
      );
    }
    const commentRef = firestore
      .collection("comments").doc(videoId)
      .collection("messages").doc(commentId);
    const snap = await commentRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Comment not found.");
    }
    const commentData = snap.data() ?? {};
    if (commentData.uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only delete your own comments."
      );
    }
    const videoRef = firestore.collection(videoCollectionId).doc(videoId);
    await firestore.runTransaction(async (tx) => {
      tx.delete(commentRef);
      tx.set(videoRef, {commentCount: FieldValue.increment(-1)}, {merge: true});
    });
    return {success: true};
  }
);

export const recordView = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    const {videoId} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    const videoRef = firestore.collection(videoCollectionId).doc(videoId);
    await videoRef.set(
      {viewCount: FieldValue.increment(1)}, {merge: true}
    );
    const snap = await videoRef.get();
    const count = snap.data()?.viewCount ?? 1;
    return {viewCount: typeof count === "number" ? count : 1};
  }
);

export const editComment = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const {videoId, commentId, text} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    if (typeof commentId !== "string" || !commentId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A commentId is required."
      );
    }
    const rawText = typeof text === "string" ? text.trim() : "";
    if (!rawText) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Comment text is required."
      );
    }
    if (rawText.length > 500) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Comment must be 500 characters or fewer."
      );
    }
    const commentRef = firestore
      .collection("comments").doc(videoId)
      .collection("messages").doc(commentId);
    const snap = await commentRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Comment not found.");
    }
    const commentData = snap.data() ?? {};
    if (commentData.uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only edit your own comments."
      );
    }
    await commentRef.update({text: rawText});
    return {success: true};
  }
);

export const deleteVideo = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const videoId = request.data?.videoId;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A videoId is required."
      );
    }

    const docRef = firestore.collection(videoCollectionId).doc(videoId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Video not found."
      );
    }

    const video = snapshot.data() ?? {};
    if (video.uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You can only delete your own videos."
      );
    }

    const processedBucket = storage.bucket(processedVideoBucketName);

    // New layout: HLS files live under {videoId}/...
    // Legacy layout: flat {videoId}_... files in bucket root
    const [folderFiles] = await processedBucket.getFiles(
      {prefix: `${videoId}/`}
    );
    const [legacyFiles] = await processedBucket.getFiles(
      {prefix: `${videoId}_`}
    );
    const allFiles = [...folderFiles, ...legacyFiles];
    if (allFiles.length > 0) {
      await Promise.all(
        allFiles.map(async (file) => {
          try {
            await file.delete();
          } catch (err) {
            logger.warn(`Failed to delete ${file.name}`, err);
          }
        })
      );
    } else if (
      typeof video.filename === "string" &&
      video.filename.length > 0
    ) {
      try {
        await processedBucket.file(video.filename).delete();
      } catch (err) {
        logger.warn(
          `Failed to delete processed video ${video.filename}`,
          err
        );
      }
    }

    if (
      typeof video.thumbnailUrl === "string" &&
      video.thumbnailUrl.length > 0
    ) {
      const thumbPrefix =
        `https://storage.googleapis.com/${processedVideoBucketName}/`;
      if (video.thumbnailUrl.startsWith(thumbPrefix)) {
        const thumbnailPath = video.thumbnailUrl.slice(
          thumbPrefix.length
        );
        try {
          await processedBucket.file(thumbnailPath).delete();
        } catch (err) {
          logger.warn(
            `Failed to delete thumbnail ${thumbnailPath}`,
            err
          );
        }
      }
    }

    await docRef.delete();

    return {success: true};
  }
);

export const backfillUserDisplayNames = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Must be authenticated."
      );
    }
    await requireAdmin(request.auth.uid);
    const snap = await firestore.collection("users").get();
    let updated = 0;
    await Promise.all(snap.docs.map(async (doc) => {
      const data = doc.data();
      if (data.displayName) return;
      try {
        const authUser = await getAuth().getUser(doc.id);
        const displayName =
          authUser.displayName ??
          authUser.email?.split("@")[0] ??
          "User";
        await doc.ref.set({displayName}, {merge: true});
        updated++;
      } catch (err) {
        logger.warn(`backfill: could not update ${doc.id}`, err);
      }
    }));
    return {updated};
  }
);

// ── Admin functions ──────────────────────────────────────────────────────────

const adminCollectionId = "admins";

async function requireAdmin(uid: string): Promise<void> {
  const snap = await firestore.collection(adminCollectionId).doc(uid).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin access required."
    );
  }
}


export const checkAdminStatus = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) return {isAdmin: false};
    const snap = await firestore
      .collection(adminCollectionId).doc(request.auth.uid).get();
    return {isAdmin: snap.exists};
  }
);

export const adminGetAllVideos = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    await requireAdmin(request.auth.uid);

    const snap = await firestore
      .collection(videoCollectionId)
      .orderBy("id", "desc")
      .limit(100)
      .get();
    return snap.docs.map((d) => d.data());
  }
);

export const adminDeleteVideo = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    await requireAdmin(request.auth.uid);

    const videoId = request.data?.videoId;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }

    const docRef = firestore.collection(videoCollectionId).doc(videoId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      throw new functions.https.HttpsError("not-found", "Video not found.");
    }

    const video = snapshot.data() ?? {};
    const processedBucket = storage.bucket(processedVideoBucketName);

    const [folderFiles] = await processedBucket.getFiles(
      {prefix: `${videoId}/`}
    );
    const [legacyFiles] = await processedBucket.getFiles(
      {prefix: `${videoId}_`}
    );
    const allFiles = [...folderFiles, ...legacyFiles];
    if (allFiles.length > 0) {
      await Promise.all(
        allFiles.map(async (file) => {
          try {
            await file.delete();
          } catch (err) {
            logger.warn(`Admin: failed to delete ${file.name}`, err);
          }
        })
      );
    } else if (
      typeof video.filename === "string" && video.filename.length > 0
    ) {
      try {
        await processedBucket.file(video.filename).delete();
      } catch (err) {
        logger.warn(`Admin: failed to delete ${video.filename}`, err);
      }
    }

    if (
      typeof video.thumbnailUrl === "string" &&
      video.thumbnailUrl.length > 0
    ) {
      const thumbPrefix =
        `https://storage.googleapis.com/${processedVideoBucketName}/`;
      if (video.thumbnailUrl.startsWith(thumbPrefix)) {
        const thumbnailPath = video.thumbnailUrl.slice(
          thumbPrefix.length
        );
        try {
          await processedBucket.file(thumbnailPath).delete();
        } catch (err) {
          logger.warn(
            `Admin: failed to delete thumbnail ${thumbnailPath}`, err
          );
        }
      }
    }

    await docRef.delete();
    return {success: true};
  }
);

export const recordWatchHistory = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const videoId = request.data?.videoId;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    const uid = request.auth.uid;
    await firestore
      .collection(watchHistoryCollectionId)
      .doc(`${uid}_${videoId}`)
      .set(
        {uid, videoId, watchedAt: FieldValue.serverTimestamp()},
        {merge: true}
      );
    return {success: true};
  }
);

export const getWatchHistory = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const uid = request.auth.uid;
    const snap = await firestore
      .collection(watchHistoryCollectionId)
      .where("uid", "==", uid)
      .limit(50)
      .get();

    // Sort by watchedAt desc client-side (avoids composite index requirement)
    const historyDocs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().watchedAt?.toMillis?.() ?? 0;
      const tb = b.data().watchedAt?.toMillis?.() ?? 0;
      return tb - ta;
    });

    const videos: unknown[] = [];
    for (const doc of historyDocs) {
      const {videoId, watchedAt} = doc.data();
      const videoSnap = await firestore
        .collection(videoCollectionId)
        .doc(videoId)
        .get();
      if (!videoSnap.exists) continue;
      videos.push({
        ...videoSnap.data(),
        watchedAt: watchedAt?.toDate?.()?.toISOString() ?? null,
      });
    }
    return videos;
  }
);

export const clearWatchHistory = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const uid = request.auth.uid;
    let deleted = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snap = await firestore
        .collection(watchHistoryCollectionId)
        .where("uid", "==", uid)
        .limit(500)
        .get();
      if (snap.empty) break;
      const batch = firestore.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.docs.length;
      if (snap.docs.length < 500) break;
    }
    return {deleted};
  }
);

export const pinComment = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const {videoId, commentId} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    if (typeof commentId !== "string" || !commentId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A commentId is required."
      );
    }
    const videoSnap = await firestore
      .collection(videoCollectionId).doc(videoId).get();
    if (!videoSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Video not found.");
    }
    if ((videoSnap.data() ?? {}).uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "Only the channel owner can pin comments."
      );
    }
    const messagesRef = firestore
      .collection("comments").doc(videoId).collection("messages");
    // Unpin any currently pinned comments
    const pinnedSnap = await messagesRef.where("pinned", "==", true).get();
    const batch = firestore.batch();
    pinnedSnap.docs.forEach(
      (d) => batch.set(d.ref, {pinned: false}, {merge: true})
    );
    batch.set(messagesRef.doc(commentId), {pinned: true}, {merge: true});
    await batch.commit();
    return {success: true};
  }
);

export const unpinComment = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const {videoId, commentId} = request.data;
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    if (typeof commentId !== "string" || !commentId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A commentId is required."
      );
    }
    const videoSnap = await firestore
      .collection(videoCollectionId).doc(videoId).get();
    if (!videoSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Video not found.");
    }
    if ((videoSnap.data() ?? {}).uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "Only the channel owner can unpin comments."
      );
    }
    await firestore
      .collection("comments").doc(videoId)
      .collection("messages").doc(commentId)
      .set({pinned: false}, {merge: true});
    return {success: true};
  }
);

export const getNotifications = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const uid = request.auth.uid;
    const snap = await firestore
      .collection("notifications")
      .doc(uid)
      .collection("items")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        uid: data.uid,
        type: data.type,
        fromUid: data.fromUid,
        fromName: data.fromName,
        videoId: data.videoId ?? null,
        videoTitle: data.videoTitle ?? null,
        message: data.message,
        read: data.read === true,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });
  }
);

export const markNotificationsRead = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const uid = request.auth.uid;
    const snap = await firestore
      .collection("notifications")
      .doc(uid)
      .collection("items")
      .where("read", "==", false)
      .get();
    if (snap.empty) return {updated: 0};
    const batch = firestore.batch();
    snap.docs.forEach((d) => batch.update(d.ref, {read: true}));
    await batch.commit();
    return {updated: snap.docs.length};
  }
);

// ── Playlist functions ───────────────────────────────────────────────────────

const playlistCollectionId = "playlists";

export const createPlaylist = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const {title, description, visibility} = request.data;
    const rawTitle = typeof title === "string" ? title.trim() : "";
    if (!rawTitle) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A playlist title is required."
      );
    }
    if (rawTitle.length > 150) {
      throw new functions.https.HttpsError(
        "invalid-argument", "Title must be 150 characters or fewer."
      );
    }
    const vis = visibility === "private" ? "private" : "public";
    const uid = request.auth.uid;
    const ref = firestore.collection(playlistCollectionId).doc();
    await ref.set({
      uid,
      title: rawTitle,
      description: typeof description === "string" ? description.trim() : "",
      visibility: vis,
      videoIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {id: ref.id};
  }
);

export const getPlaylist = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    const {playlistId} = request.data;
    if (typeof playlistId !== "string" || !playlistId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A playlistId is required."
      );
    }
    const snap = await firestore
      .collection(playlistCollectionId).doc(playlistId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Playlist not found.");
    }
    const data = snap.data() ?? {};
    if (
      data.visibility === "private" &&
      (!request.auth || request.auth.uid !== data.uid)
    ) {
      throw new functions.https.HttpsError(
        "permission-denied", "This playlist is private."
      );
    }
    const videoIds: string[] =
      Array.isArray(data.videoIds) ? data.videoIds : [];
    const videos: unknown[] = [];
    for (const vid of videoIds) {
      const vSnap = await firestore
        .collection(videoCollectionId).doc(vid).get();
      if (vSnap.exists && vSnap.data()?.status === "processed") {
        videos.push({id: vSnap.id, ...vSnap.data()});
      }
    }
    return {
      id: snap.id,
      uid: data.uid,
      title: data.title,
      description: data.description ?? "",
      visibility: data.visibility,
      videoIds,
      videos,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    };
  }
);

export const getUserPlaylists = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const uid = request.auth.uid;
    const snap = await firestore
      .collection(playlistCollectionId)
      .where("uid", "==", uid)
      .limit(50)
      .get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        uid: data.uid,
        title: data.title,
        description: data.description ?? "",
        visibility: data.visibility ?? "public",
        videoIds: Array.isArray(data.videoIds) ? data.videoIds : [],
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
      };
    });
    rows.sort((a, b) => {
      const ta = a.createdAt ?? "";
      const tb = b.createdAt ?? "";
      return tb.localeCompare(ta);
    });
    return rows;
  }
);

export const getPublicUserPlaylists = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    const {uid} = request.data;
    if (typeof uid !== "string" || !uid) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A uid is required."
      );
    }
    const snap = await firestore
      .collection(playlistCollectionId)
      .where("uid", "==", uid)
      .where("visibility", "==", "public")
      .limit(50)
      .get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        uid: data.uid,
        title: data.title,
        description: data.description ?? "",
        visibility: data.visibility ?? "public",
        videoIds: Array.isArray(data.videoIds) ? data.videoIds : [],
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
      };
    });
    rows.sort((a, b) => {
      const ta = a.createdAt ?? "";
      const tb = b.createdAt ?? "";
      return tb.localeCompare(ta);
    });
    return rows;
  }
);

export const addToPlaylist = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const {playlistId, videoId} = request.data;
    if (typeof playlistId !== "string" || !playlistId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A playlistId is required."
      );
    }
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    const ref = firestore.collection(playlistCollectionId).doc(playlistId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Playlist not found.");
    }
    if ((snap.data() ?? {}).uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only modify your own playlists."
      );
    }
    await ref.update({
      videoIds: FieldValue.arrayUnion(videoId),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {success: true};
  }
);

export const removeFromPlaylist = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const {playlistId, videoId} = request.data;
    if (typeof playlistId !== "string" || !playlistId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A playlistId is required."
      );
    }
    if (typeof videoId !== "string" || !videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A videoId is required."
      );
    }
    const ref = firestore.collection(playlistCollectionId).doc(playlistId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Playlist not found.");
    }
    if ((snap.data() ?? {}).uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only modify your own playlists."
      );
    }
    await ref.update({
      videoIds: FieldValue.arrayRemove(videoId),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {success: true};
  }
);

export const deletePlaylist = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const {playlistId} = request.data;
    if (typeof playlistId !== "string" || !playlistId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A playlistId is required."
      );
    }
    const ref = firestore.collection(playlistCollectionId).doc(playlistId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Playlist not found.");
    }
    if ((snap.data() ?? {}).uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only delete your own playlists."
      );
    }
    await ref.delete();
    return {success: true};
  }
);

export const reorderPlaylist = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const {playlistId, videoIds} = request.data;
    if (typeof playlistId !== "string" || !playlistId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A playlistId is required."
      );
    }
    if (
      !Array.isArray(videoIds) ||
      !videoIds.every((v) => typeof v === "string")
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument", "videoIds must be an array of strings."
      );
    }
    const ref = firestore.collection(playlistCollectionId).doc(playlistId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Playlist not found.");
    }
    if ((snap.data() ?? {}).uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only reorder your own playlists."
      );
    }
    await ref.update({
      videoIds,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {success: true};
  }
);

export const updatePlaylistVisibility = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "Must be authenticated."
      );
    }
    const {playlistId, visibility} = request.data;
    if (typeof playlistId !== "string" || !playlistId) {
      throw new functions.https.HttpsError(
        "invalid-argument", "A playlistId is required."
      );
    }
    const vis = visibility === "private" ? "private" : "public";
    const ref = firestore.collection(playlistCollectionId).doc(playlistId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Playlist not found.");
    }
    if ((snap.data() ?? {}).uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied", "You can only update your own playlists."
      );
    }
    await ref.update({
      visibility: vis,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {success: true};
  }
);
