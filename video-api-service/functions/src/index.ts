import * as functions from "firebase-functions/v1";
import {initializeApp} from "firebase-admin/app";
import {Firestore, FieldValue} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {Storage} from "@google-cloud/storage";
import {onCall} from "firebase-functions/v2/https";

initializeApp();

const firestore = new Firestore({databaseId: "koralabs-video-web-client"});
const storage = new Storage();
const rawVideoBucketName = "koralabs-raw-videos";
const processedVideoBucketName = "koralabs-processed-videos";
const allowedThumbnailExtensions = new Set([
  "jpg", "jpeg", "png", "webp", "gif",
]);

export const createUser = functions
  .region("europe-west2")
  .auth.user()
  .onCreate(async (user) => {
    const userInfo = {
      uid: user.uid,
      email: user.email,
      photoUrl: user.photoURL,
    };
    await firestore.collection("users").doc(user.uid).set(userInfo);
    logger.info(`User Created: ${JSON.stringify(userInfo)}`);
    return;
  });

const videoCollectionId = "videos";

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
    };
    if (thumbnailUrl) {
      firestoreDoc.thumbnailUrl = thumbnailUrl;
    }

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
  thumbnailUrl?: string,
  resolutions?: string[],
}

export const getVideos = onCall(
  {maxInstances: 1, region: "europe-west2"},
  async () => {
    const querySnapshot =
      await firestore.collection(videoCollectionId).limit(10).get();
    return querySnapshot.docs.map((doc) => doc.data());
  });

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

    const updates: Record<string, unknown> = {
      title: rawTitle,
      description: rawDescription,
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
      updates.thumbnailUrl = thumbnailUrl;
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
    const snap = await firestore
      .collection("comments").doc(videoId).collection("messages")
      .orderBy("createdAt", "asc")
      .limit(50)
      .get();
    return snap.docs.map((d) => {
      const data = d.data();
      const ts = data.createdAt;
      return {
        id: d.id,
        uid: data.uid as string,
        text: data.text as string,
        createdAt: ts ? ts.toDate().toISOString() : null,
      };
    });
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

    const resolutions = Array.isArray(video.resolutions) ?
      video.resolutions as string[] :
      [];

    if (resolutions.length > 0) {
      await Promise.all(
        resolutions.map(async (res: string) => {
          const resFile = `${videoId}_${res}.mp4`;
          try {
            await processedBucket.file(resFile).delete();
          } catch (err) {
            logger.warn(`Failed to delete ${resFile}`, err);
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
      const prefix =
        `https://storage.googleapis.com/${processedVideoBucketName}/`;
      if (video.thumbnailUrl.startsWith(prefix)) {
        const thumbnailPath = video.thumbnailUrl.slice(prefix.length);
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
