import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const generateUploadUrlFunction = httpsCallable(functions, 'generateUploadUrl');
const getVideosFunction = httpsCallable(functions, 'getVideos');
const getUserByIdFunction = httpsCallable(functions, 'getUserById');
const deleteVideoFunction = httpsCallable(functions, 'deleteVideo');
const toggleSubscriptionFunction = httpsCallable(functions, 'toggleSubscription');
const getSubscriptionStatusFunction = httpsCallable(functions, 'getSubscriptionStatus');

export async function uploadVideo(
  file: File,
  title: string,
  description: string,
  thumbnail?: File | null,
) {
  const thumbnailExtension = thumbnail
    ? thumbnail.name.split('.').pop()?.toLowerCase()
    : undefined;

  const response: any = await generateUploadUrlFunction({
    fileExtension: file.name.split('.').pop(),
    title,
    description,
    ...(thumbnailExtension ? { thumbnailExtension } : {}),
  });

  // Upload the video file to the signed URL
  const uploadResult = await fetch(response?.data?.url, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  // Upload the thumbnail image if one was selected
  if (thumbnail && response?.data?.thumbnailUploadUrl) {
    await fetch(response.data.thumbnailUploadUrl, {
      method: 'PUT',
      body: thumbnail,
      headers: {
        'Content-Type': thumbnail.type || 'image/jpeg',
      },
    });
  }

  return uploadResult;
}

export interface Video {
  id?: string,
  uid?: string,
  filename?: string,
  status?: 'processing' | 'processed',
  title?: string,
  description?: string,
  thumbnailUrl?: string,
}

export async function getVideos() {
  const response: any = await getVideosFunction();
  return response.data as Video[];
}

export interface User {
  uid?: string,
  email?: string,
  displayName?: string,
  photoUrl?: string,
  subscriberCount?: number,
}

export async function getUserById(uid: string): Promise<User | null> {
  const response: any = await getUserByIdFunction({ uid });
  return response.data as User | null;
}

export function formatUploader(user: User | null | undefined): string {
  return user?.displayName || user?.email || 'Unknown';
}

export async function deleteVideo(videoId: string): Promise<{ success: boolean }> {
  const response: any = await deleteVideoFunction({ videoId });
  return response.data as { success: boolean };
}

export async function toggleSubscription(channelUid: string): Promise<{ subscribed: boolean }> {
  const response: any = await toggleSubscriptionFunction({ channelUid });
  return response.data as { subscribed: boolean };
}

export async function getSubscriptionStatus(channelUid: string): Promise<{ subscribed: boolean }> {
  const response: any = await getSubscriptionStatusFunction({ channelUid });
  return response.data as { subscribed: boolean };
}
