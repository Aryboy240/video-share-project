import * as functions from "firebase-functions/v1";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

initializeApp();

const firestore = getFirestore("koralabs-video-web-client");
firestore.settings({preferRest: true});

export const createUser = functions
  .region("europe-west2")
  .auth.user()
  .onCreate(async (user) => {
    const userInfo = {
      uid: user.uid,
      email: user.email,
      photoUrl: user.photoURL,
    };

    try {
      await firestore.collection("users").doc(user.uid).set(userInfo);
      logger.info(`User Created: ${JSON.stringify(userInfo)}`);
    } catch (error) {
      logger.error(`Error creating user: ${error}`);
    }
  });
