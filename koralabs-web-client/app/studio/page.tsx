'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { User as FirebaseAuthUser } from 'firebase/auth';
import styles from './page.module.css';
import {
  getUserVideos,
  uploadVideo,
  deleteVideo,
  updateVideoMetadata,
  Video,
} from '../firebase/functions';
import { onAuthStateChangedHelper } from '../firebase/firebase';

function parseUploadDate(id?: string): Date | null {
  if (!id) return null;
  const idx = id.lastIndexOf('-');
  if (idx < 0) return null;
  const ts = Number(id.slice(idx + 1));
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function StudioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editParam = searchParams.get('edit');

  const [currentUser, setCurrentUser] = useState<FirebaseAuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const editParamHandled = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChangedHelper((u) => {
      setCurrentUser(u);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (authChecked && !currentUser) {
      router.push('/');
    }
  }, [authChecked, currentUser, router]);

  const loadVideos = useCallback(async () => {
    if (!currentUser) return;
    setLoadingVideos(true);
    try {
      const vids = await getUserVideos();
      setVideos(vids);
    } catch (err) {
      console.error('Failed to load videos', err);
    } finally {
      setLoadingVideos(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      loadVideos();
    }
  }, [currentUser, loadVideos]);

  // Open edit modal when ?edit param is present and videos are loaded
  const openEditModal = useCallback((video: Video) => {
    // Reset everything first
    setIsEditMode(true);
    setEditingVideo(video);
    setStep(2);
    setFile(null);
    setTitle(video.title || '');
    setDescription(video.description || '');
    setThumbnail(null);
    setThumbnailPreview(video.thumbnailUrl || null);
    setSaving(false);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
    setModalOpen(true);
  }, []);

  useEffect(() => {
    if (!editParam || videos.length === 0 || editParamHandled.current || modalOpen) return;
    const target = videos.find((v) => v.id === editParam);
    if (target) {
      editParamHandled.current = true;
      openEditModal(target);
    }
  }, [editParam, videos, modalOpen, openEditModal]);

  const revokePreview = (url: string | null) => {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  };

  const resetModal = () => {
    setIsEditMode(false);
    setEditingVideo(null);
    setStep(1);
    setFile(null);
    setTitle('');
    setDescription('');
    revokePreview(thumbnailPreview);
    setThumbnail(null);
    setThumbnailPreview(null);
    setSaving(false);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
  };

  const openUploadModal = () => {
    resetModal();
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    resetModal();
    setModalOpen(false);
    if (editParam) {
      editParamHandled.current = false;
      router.replace('/studio');
    }
  };

  const selectFile = (picked: File) => {
    setFile(picked);
    setStep(2);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.item(0) ?? null;
    if (picked) selectFile(picked);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const picked = e.dataTransfer.files?.item(0) ?? null;
    if (picked && picked.type.startsWith('video/')) {
      selectFile(picked);
    }
  };

  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.item(0) ?? null;
    if (picked) {
      revokePreview(thumbnailPreview);
      setThumbnail(picked);
      setThumbnailPreview(URL.createObjectURL(picked));
    }
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
  };

  const removeThumbnail = () => {
    revokePreview(thumbnailPreview);
    setThumbnail(null);
    // In edit mode revert to the existing thumbnail, in upload mode clear
    setThumbnailPreview(isEditMode ? (editingVideo?.thumbnailUrl || null) : null);
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
  };

  const canSave = title.trim().length > 0 && !saving;
  const canPublish = !!file && title.trim().length > 0 && !saving;

  const handlePublish = async () => {
    if (!file || !title.trim()) return;
    setSaving(true);
    try {
      await uploadVideo(file, title.trim(), description.trim(), thumbnail);
      resetModal();
      setModalOpen(false);
      await loadVideos();
    } catch (err) {
      alert(`Failed to upload: ${err}`);
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editingVideo?.id || !title.trim()) return;
    setSaving(true);
    try {
      const thumbnailExtension = thumbnail
        ? thumbnail.name.split('.').pop()?.toLowerCase()
        : undefined;

      const result = await updateVideoMetadata(
        editingVideo.id,
        title.trim(),
        description.trim(),
        thumbnailExtension,
      );

      if (thumbnail && result.thumbnailUploadUrl) {
        await fetch(result.thumbnailUploadUrl, {
          method: 'PUT',
          body: thumbnail,
          headers: {
            'Content-Type': thumbnail.type || 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      resetModal();
      setModalOpen(false);
      editParamHandled.current = false;
      router.replace('/studio');
      await loadVideos();
    } catch (err) {
      alert(`Failed to save: ${err}`);
      setSaving(false);
    }
  };

  const handleDelete = async (video: Video) => {
    if (!video.id || deletingId) return;
    if (!window.confirm(`Delete "${video.title || 'this video'}"? This cannot be undone.`)) return;
    setDeletingId(video.id);
    try {
      await deleteVideo(video.id);
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
    } catch (err) {
      alert(`Failed to delete video: ${err}`);
    } finally {
      setDeletingId(null);
    }
  };

  if (!authChecked) {
    return <div className={styles.studioPage}><p className={styles.loading}>Loading…</p></div>;
  }
  if (!currentUser) {
    return null;
  }

  return (
    <div className={styles.studioPage}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Channel content</h1>
        <button type="button" className={styles.uploadCta} onClick={openUploadModal}>
          Upload video
        </button>
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.tableHeader}>
          <div className={styles.colVideo}>Video</div>
          <div className={styles.colStatus}>Status</div>
          <div className={styles.colDate}>Date</div>
          <div className={styles.colLikes}>Likes</div>
          <div className={styles.colComments}>Comments</div>
          <div className={styles.colActions}></div>
        </div>

        {loadingVideos && videos.length === 0 && (
          <div className={styles.emptyRow}>Loading videos…</div>
        )}
        {!loadingVideos && videos.length === 0 && (
          <div className={styles.emptyRow}>
            No videos yet. Click <strong>Upload video</strong> to get started.
          </div>
        )}

        {videos.map((v) => {
          const date = parseUploadDate(v.id);
          const thumb = v.thumbnailUrl && v.thumbnailUrl.length > 0
            ? v.thumbnailUrl
            : '/images/thumbnails/thumbnail.png';
          const isProcessed = v.status === 'processed';
          return (
            <div key={v.id} className={styles.tableRow}>
              <div className={styles.colVideo}>
                <Link href={`/watch?v=${v.filename}`} className={styles.thumbnailLink}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumb}
                    alt={v.title || 'Thumbnail'}
                    className={styles.rowThumbnail}
                  />
                </Link>
                <div className={styles.rowTitleBlock}>
                  <p className={styles.rowTitle}>{v.title || 'Untitled'}</p>
                  {v.description && v.description.length > 0 && (
                    <p className={styles.rowDescription}>{v.description}</p>
                  )}
                </div>
              </div>
              <div className={styles.colStatus}>
                <span className={`${styles.statusBadge} ${isProcessed ? styles.statusProcessed : styles.statusProcessing}`}>
                  {isProcessed ? 'Processed' : 'Processing'}
                </span>
              </div>
              <div className={styles.colDate}>{formatDate(date)}</div>
              <div className={styles.colLikes}>
                <span className={styles.likeRatio}>
                  👍 {v.likeCount ?? 0} / 👎 {v.dislikeCount ?? 0}
                </span>
              </div>
              <div className={styles.colComments}>
                <Link href={`/watch?v=${v.filename}#comments`} className={styles.commentCount}>
                  💬 {v.commentCount ?? 0}
                </Link>
              </div>
              <div className={styles.colActions}>
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={() => openEditModal(v)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => handleDelete(v)}
                  disabled={deletingId === v.id}
                >
                  {deletingId === v.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

            {/* Upload step 1 — file picker */}
            {!isEditMode && step === 1 && (
              <>
                <h2 className={styles.modalTitle}>Upload video</h2>
                <p className={styles.modalSubtitle}>
                  Drag and drop a video file to upload
                </p>
                <div
                  className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <div className={styles.dropZoneIcon}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                  </div>
                  <p className={styles.dropZoneText}>Drag and drop a video here</p>
                  <p className={styles.dropZoneHint}>or</p>
                  <input
                    ref={fileInputRef}
                    id="studio-file-input"
                    type="file"
                    accept="video/*"
                    className={styles.hiddenInput}
                    onChange={handleFileInputChange}
                  />
                  <label htmlFor="studio-file-input" className={styles.selectFilesButton}>
                    Select files
                  </label>
                </div>
                <div className={styles.modalActions}>
                  <button type="button" className={styles.cancelButton} onClick={closeModal}>
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* Upload step 2 — details form */}
            {!isEditMode && step === 2 && file && (
              <>
                <h2 className={styles.modalTitle}>Upload video</h2>
                <p className={styles.modalFilename}>{file.name}</p>
                {renderDetailsForm()}
                <div className={styles.modalActions}>
                  <button type="button" className={styles.cancelButton} onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="button" className={styles.publishButton} onClick={handlePublish} disabled={!canPublish}>
                    {saving ? 'Publishing…' : 'Publish'}
                  </button>
                </div>
              </>
            )}

            {/* Edit mode — details form pre-filled, no file picker */}
            {isEditMode && (
              <>
                <h2 className={styles.modalTitle}>Edit video</h2>
                <p className={styles.modalFilename}>{editingVideo?.title || 'Untitled'}</p>
                {renderDetailsForm()}
                <div className={styles.modalActions}>
                  <button type="button" className={styles.cancelButton} onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="button" className={styles.publishButton} onClick={handleSave} disabled={!canSave}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

  function renderDetailsForm() {
    return (
      <>
        <label className={styles.fieldLabel} htmlFor="studio-title">
          Title <span className={styles.required}>*</span>
        </label>
        <input
          id="studio-title"
          className={styles.fieldInput}
          type="text"
          value={title}
          maxLength={100}
          placeholder="Give your video a title"
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
        />
        <div className={styles.charCount}>{title.length}/100</div>

        <label className={styles.fieldLabel} htmlFor="studio-description">
          Description
        </label>
        <textarea
          id="studio-description"
          className={styles.fieldTextarea}
          value={description}
          maxLength={500}
          placeholder="Tell viewers about your video (optional)"
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          disabled={saving}
        />
        <div className={styles.charCount}>{description.length}/500</div>

        <label className={styles.fieldLabel} htmlFor="studio-thumbnail">
          Thumbnail
        </label>
        <input
          id="studio-thumbnail"
          ref={thumbnailInputRef}
          className={styles.hiddenInput}
          type="file"
          accept="image/*"
          onChange={handleThumbnailChange}
          disabled={saving}
        />
        <div className={styles.thumbnailRow}>
          <label
            htmlFor="studio-thumbnail"
            className={`${styles.thumbnailPickButton}${saving ? ' ' + styles.thumbnailPickButtonDisabled : ''}`}
          >
            {thumbnail ? 'Change image' : thumbnailPreview ? 'Replace image' : 'Choose image (optional)'}
          </label>
          {thumbnailPreview && (
            <div className={styles.thumbnailPreviewWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailPreview}
                alt="Thumbnail preview"
                className={styles.thumbnailPreview}
              />
              {thumbnail && (
                <button
                  type="button"
                  className={styles.thumbnailRemove}
                  onClick={removeThumbnail}
                  disabled={saving}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      </>
    );
  }
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#aaa' }}>Loading…</div>}>
      <StudioContent />
    </Suspense>
  );
}
