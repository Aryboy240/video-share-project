import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const generateUploadUrlFunction = httpsCallable(functions, 'generateUploadUrl');
const getVideosFunction = httpsCallable(functions, 'getVideos');
const getUserByIdFunction = httpsCallable(functions, 'getUserById');

export async function uploadVideo(file: File, title: string, description: string) {
  const response: any = await generateUploadUrlFunction({
    fileExtension: file.name.split('.').pop(),
    title,
    description,
  });

  // Upload the file to the signed URL
  const uploadResult = await fetch(response?.data?.url, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  return uploadResult;
}

export interface Video {
  id?: string,
  uid?: string,
  filename?: string,
  status?: 'processing' | 'processed',
  title?: string,
  description?: string  
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
}

export async function getUserById(uid: string): Promise<User | null> {
  const response: any = await getUserByIdFunction({ uid });
  return response.data as User | null;
}

export function formatUploader(user: User | null | undefined): string {
  return user?.displayName || user?.email || 'Unknown';
}
