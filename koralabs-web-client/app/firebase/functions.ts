import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const generateUploadUrlFunction = httpsCallable(functions, 'generateUploadUrl');
const getVideosFunction = httpsCallable(functions, 'getVideos');
const getUserVideosFunction = httpsCallable(functions, 'getUserVideos');
const getUserByIdFunction = httpsCallable(functions, 'getUserById');
const deleteVideoFunction = httpsCallable(functions, 'deleteVideo');
const updateVideoMetadataFunction = httpsCallable(functions, 'updateVideoMetadata');
const addCommentFunction = httpsCallable(functions, 'addComment');
const getCommentsFunction = httpsCallable(functions, 'getComments');
const deleteCommentFunction = httpsCallable(functions, 'deleteComment');
const toggleLikeFunction = httpsCallable(functions, 'toggleLike');
const getLikeStatusFunction = httpsCallable(functions, 'getLikeStatus');
const toggleSubscriptionFunction = httpsCallable(functions, 'toggleSubscription');
const getSubscriptionStatusFunction = httpsCallable(functions, 'getSubscriptionStatus');
const recordViewFunction = httpsCallable(functions, 'recordView');
const editCommentFunction = httpsCallable(functions, 'editComment');

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
        'Cache-Control': 'public, max-age=31536000, immutable',
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
  likeCount?: number,
  dislikeCount?: number,
  commentCount?: number,
  viewCount?: number,
  resolutions?: string[],
}

export interface Comment {
  id: string,
  uid: string,
  text: string,
  createdAt: string | null,
}

export async function getVideos() {
  const response: any = await getVideosFunction();
  return response.data as Video[];
}

export async function getUserVideos() {
  const response: any = await getUserVideosFunction();
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

export async function updateVideoMetadata(
  videoId: string,
  title: string,
  description: string,
  thumbnailExtension?: string,
): Promise<{ success: boolean; thumbnailUploadUrl?: string | null; thumbnailUrl?: string | null }> {
  const response: any = await updateVideoMetadataFunction({
    videoId,
    title,
    description,
    ...(thumbnailExtension ? { thumbnailExtension } : {}),
  });
  return response.data;
}

export async function addComment(videoId: string, text: string): Promise<{ id: string }> {
  const response: any = await addCommentFunction({ videoId, text });
  return response.data;
}

export async function getComments(videoId: string): Promise<Comment[]> {
  const response: any = await getCommentsFunction({ videoId });
  return response.data as Comment[];
}

export async function deleteComment(videoId: string, commentId: string): Promise<{ success: boolean }> {
  const response: any = await deleteCommentFunction({ videoId, commentId });
  return response.data;
}

export async function toggleLike(
  videoId: string,
  action: 'like' | 'dislike',
): Promise<{ action: 'like' | 'dislike' | null }> {
  const response: any = await toggleLikeFunction({ videoId, action });
  return response.data;
}

export async function getLikeStatus(
  videoId: string,
): Promise<{ action: 'like' | 'dislike' | null }> {
  const response: any = await getLikeStatusFunction({ videoId });
  return response.data;
}

export async function toggleSubscription(channelUid: string): Promise<{ subscribed: boolean }> {
  const response: any = await toggleSubscriptionFunction({ channelUid });
  return response.data as { subscribed: boolean };
}

export async function getSubscriptionStatus(channelUid: string): Promise<{ subscribed: boolean }> {
  const response: any = await getSubscriptionStatusFunction({ channelUid });
  return response.data as { subscribed: boolean };
}

export async function recordView(videoId: string): Promise<{ viewCount: number }> {
  const response: any = await recordViewFunction({ videoId });
  return response.data as { viewCount: number };
}

export async function editComment(
  videoId: string,
  commentId: string,
  text: string,
): Promise<{ success: boolean }> {
  const response: any = await editCommentFunction({ videoId, commentId, text });
  return response.data as { success: boolean };
}
