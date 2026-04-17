import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const generateUploadUrlFunction = httpsCallable(functions, 'generateUploadUrl');
const getVideosFunction = httpsCallable(functions, 'getVideos');
const getVideoByIdFunction = httpsCallable(functions, 'getVideoById');
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
const checkAdminStatusFunction = httpsCallable(functions, 'checkAdminStatus');
const adminGetAllVideosFunction = httpsCallable(functions, 'adminGetAllVideos');
const adminDeleteVideoFunction = httpsCallable(functions, 'adminDeleteVideo');
const backfillUserDisplayNamesFunction = httpsCallable(functions, 'backfillUserDisplayNames');
const getChannelVideosFunction = httpsCallable(functions, 'getChannelVideos');
const processThumbnailFunction = httpsCallable(functions, 'processThumbnail');
const refreshUserAvatarFunction = httpsCallable(functions, 'refreshUserAvatar');
const backfillUserAvatarsFunction = httpsCallable(functions, 'backfillUserAvatars');
const recordWatchHistoryFunction = httpsCallable(functions, 'recordWatchHistory');
const getWatchHistoryFunction = httpsCallable(functions, 'getWatchHistory');
const clearWatchHistoryFunction = httpsCallable(functions, 'clearWatchHistory');
const pinCommentFunction = httpsCallable(functions, 'pinComment');
const unpinCommentFunction = httpsCallable(functions, 'unpinComment');
const getNotificationsFunction = httpsCallable(functions, 'getNotifications');
const markNotificationsReadFunction = httpsCallable(functions, 'markNotificationsRead');
const createPlaylistFunction = httpsCallable(functions, 'createPlaylist');
const getPlaylistFunction = httpsCallable(functions, 'getPlaylist');
const getUserPlaylistsFunction = httpsCallable(functions, 'getUserPlaylists');
const getPublicUserPlaylistsFunction = httpsCallable(functions, 'getPublicUserPlaylists');
const addToPlaylistFunction = httpsCallable(functions, 'addToPlaylist');
const removeFromPlaylistFunction = httpsCallable(functions, 'removeFromPlaylist');
const deletePlaylistFunction = httpsCallable(functions, 'deletePlaylist');
const reorderPlaylistFunction = httpsCallable(functions, 'reorderPlaylist');
const updatePlaylistVisibilityFunction = httpsCallable(functions, 'updatePlaylistVisibility');

export async function uploadVideo(
  file: File,
  title: string,
  description: string,
  thumbnail?: File | null,
  onProgress?: (percent: number) => void,
  tags?: string[],
) {
  const thumbnailExtension = thumbnail
    ? thumbnail.name.split('.').pop()?.toLowerCase()
    : undefined;

  const response: any = await generateUploadUrlFunction({
    fileExtension: file.name.split('.').pop(),
    title,
    description,
    ...(thumbnailExtension ? { thumbnailExtension } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  });

  // Upload the video file via XHR so we can track progress
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', response?.data?.url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed (network error)'));
    xhr.send(file);
  });

  // Upload the thumbnail image if one was selected (small file, no progress needed)
  if (thumbnail && response?.data?.thumbnailUploadUrl) {
    await fetch(response.data.thumbnailUploadUrl, {
      method: 'PUT',
      body: thumbnail,
      headers: {
        'Content-Type': thumbnail.type || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
    // Generate compressed variants server-side
    const videoId = (response?.data?.fileName as string | undefined)?.split('.')[0];
    const ext = thumbnailExtension;
    if (videoId && ext) {
      try {
        await processThumbnailFunction({
          videoId,
          thumbnailPath: `thumbnails/${videoId}.${ext}`,
        });
      } catch (err) {
        console.warn('processThumbnail failed (non-fatal):', err);
      }
    }
  }
}

export async function processThumbnail(
  videoId: string,
  thumbnailPath: string,
): Promise<void> {
  await processThumbnailFunction({ videoId, thumbnailPath });
}

export interface Video {
  id?: string,
  uid?: string,
  filename?: string,
  status?: 'processing' | 'processed',
  title?: string,
  description?: string,
  tags?: string[],
  thumbnailUrl?: string,
  thumbnailSmallUrl?: string,
  thumbnailMediumUrl?: string,
  likeCount?: number,
  dislikeCount?: number,
  commentCount?: number,
  viewCount?: number,
  resolutions?: string[],
  hlsMasterUrl?: string,
  streamType?: string,
  duration?: number,
  progress?: number,
  processingStage?: string,
}

export interface Comment {
  id: string,
  uid: string,
  text: string,
  createdAt: string | null,
  pinned?: boolean,
}

export async function getVideos() {
  const response: any = await getVideosFunction();
  return response.data as Video[];
}

export async function getVideoById(videoId: string): Promise<Video | null> {
  const response: any = await getVideoByIdFunction({ videoId });
  return response.data as Video | null;
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
  tags?: string[],
): Promise<{ success: boolean; thumbnailUploadUrl?: string | null; thumbnailUrl?: string | null }> {
  const response: any = await updateVideoMetadataFunction({
    videoId,
    title,
    description,
    ...(thumbnailExtension ? { thumbnailExtension } : {}),
    ...(tags !== undefined ? { tags } : {}),
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

export async function checkAdminStatus(): Promise<{ isAdmin: boolean }> {
  const response: any = await checkAdminStatusFunction();
  return response.data as { isAdmin: boolean };
}

export async function adminGetAllVideos(): Promise<Video[]> {
  const response: any = await adminGetAllVideosFunction();
  return response.data as Video[];
}

export async function adminDeleteVideo(videoId: string): Promise<{ success: boolean }> {
  const response: any = await adminDeleteVideoFunction({ videoId });
  return response.data as { success: boolean };
}

export async function backfillUserDisplayNames(): Promise<{ updated: number }> {
  const response: any = await backfillUserDisplayNamesFunction();
  return response.data as { updated: number };
}

export async function getChannelVideos(uid: string): Promise<Video[]> {
  const response: any = await getChannelVideosFunction({ uid });
  return response.data as Video[];
}

export async function refreshUserAvatar(): Promise<{ photoUrl: string | null }> {
  const response: any = await refreshUserAvatarFunction();
  return response.data as { photoUrl: string | null };
}

export async function backfillUserAvatars(): Promise<{ updated: number }> {
  const response: any = await backfillUserAvatarsFunction();
  return response.data as { updated: number };
}

export interface VideoWithWatchedAt extends Video {
  watchedAt?: string | null;
}

export async function recordWatchHistory(videoId: string): Promise<{ success: boolean }> {
  const response: any = await recordWatchHistoryFunction({ videoId });
  return response.data as { success: boolean };
}

export async function getWatchHistory(): Promise<VideoWithWatchedAt[]> {
  const response: any = await getWatchHistoryFunction();
  return response.data as VideoWithWatchedAt[];
}

export async function clearWatchHistory(): Promise<{ deleted: number }> {
  const response: any = await clearWatchHistoryFunction();
  return response.data as { deleted: number };
}

export async function pinComment(videoId: string, commentId: string): Promise<{ success: boolean }> {
  const response: any = await pinCommentFunction({ videoId, commentId });
  return response.data as { success: boolean };
}

export async function unpinComment(videoId: string, commentId: string): Promise<{ success: boolean }> {
  const response: any = await unpinCommentFunction({ videoId, commentId });
  return response.data as { success: boolean };
}

export interface Notification {
  id: string;
  uid: string;
  type: 'comment' | 'subscribe' | 'like';
  fromUid: string;
  fromName: string;
  videoId?: string | null;
  videoTitle?: string | null;
  message: string;
  read: boolean;
  createdAt: string | null;
}

export async function getNotifications(): Promise<Notification[]> {
  const response: any = await getNotificationsFunction();
  return response.data as Notification[];
}

export async function markNotificationsRead(): Promise<{ updated: number }> {
  const response: any = await markNotificationsReadFunction();
  return response.data as { updated: number };
}

export interface Playlist {
  id: string;
  uid: string;
  title: string;
  description: string;
  visibility: 'public' | 'private';
  videoIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PlaylistDetail extends Playlist {
  videos: Video[];
}

export async function createPlaylist(
  title: string,
  description: string,
  visibility: 'public' | 'private',
): Promise<{ id: string }> {
  const response: any = await createPlaylistFunction({ title, description, visibility });
  return response.data as { id: string };
}

export async function getPlaylist(playlistId: string): Promise<PlaylistDetail> {
  const response: any = await getPlaylistFunction({ playlistId });
  return response.data as PlaylistDetail;
}

export async function getUserPlaylists(): Promise<Playlist[]> {
  const response: any = await getUserPlaylistsFunction();
  return response.data as Playlist[];
}

export async function getPublicUserPlaylists(uid: string): Promise<Playlist[]> {
  const response: any = await getPublicUserPlaylistsFunction({ uid });
  return response.data as Playlist[];
}

export async function addToPlaylist(
  playlistId: string,
  videoId: string,
): Promise<{ success: boolean }> {
  const response: any = await addToPlaylistFunction({ playlistId, videoId });
  return response.data as { success: boolean };
}

export async function removeFromPlaylist(
  playlistId: string,
  videoId: string,
): Promise<{ success: boolean }> {
  const response: any = await removeFromPlaylistFunction({ playlistId, videoId });
  return response.data as { success: boolean };
}

export async function deletePlaylist(playlistId: string): Promise<{ success: boolean }> {
  const response: any = await deletePlaylistFunction({ playlistId });
  return response.data as { success: boolean };
}

export async function reorderPlaylist(
  playlistId: string,
  videoIds: string[],
): Promise<{ success: boolean }> {
  const response: any = await reorderPlaylistFunction({ playlistId, videoIds });
  return response.data as { success: boolean };
}

export async function updatePlaylistVisibility(
  playlistId: string,
  visibility: 'public' | 'private',
): Promise<{ success: boolean }> {
  const response: any = await updatePlaylistVisibilityFunction({ playlistId, visibility });
  return response.data as { success: boolean };
}
