'use client';

import {Fragment, useRef, useState} from "react";
import {uploadVideo} from "../firebase/functions";

import styles from "./upload.module.css";

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  const clearFileInput = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const clearThumbnailInput = () => {
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }
  };

  const revokePreview = (url: string | null) => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.item(0) ?? null;
    if (picked) {
      setFile(picked);
      setTitle("");
      setDescription("");
      revokePreview(thumbnailPreview);
      setThumbnail(null);
      setThumbnailPreview(null);
      clearThumbnailInput();
    }
    clearFileInput();
  };

  const handleThumbnailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.item(0) ?? null;
    if (picked) {
      revokePreview(thumbnailPreview);
      setThumbnail(picked);
      setThumbnailPreview(URL.createObjectURL(picked));
    }
    clearThumbnailInput();
  };

  const removeThumbnail = () => {
    revokePreview(thumbnailPreview);
    setThumbnail(null);
    setThumbnailPreview(null);
    clearThumbnailInput();
  };

  const closeModal = () => {
    clearFileInput();
    clearThumbnailInput();
    revokePreview(thumbnailPreview);
    setFile(null);
    setTitle("");
    setDescription("");
    setThumbnail(null);
    setThumbnailPreview(null);
    setUploading(false);
  };

  const canSubmit = !!file && title.trim().length > 0 && !uploading;

  const handleSubmit = async () => {
    if (!file || !title.trim()) return;
    setUploading(true);
    try {
      const response = await uploadVideo(file, title.trim(), description.trim(), thumbnail);
      alert(`File uploaded successfully. Server responded with: ${JSON.stringify(response)}`);
      closeModal();
    } catch (error) {
      alert(`Failed to upload file: ${error}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Fragment>
      <input
        id="upload"
        ref={inputRef}
        className={styles.uploadInput}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
      />
      <label htmlFor="upload" className={styles.uploadButton}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      </label>

      {file && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Upload video</h2>
            <p className={styles.modalFilename}>{file.name}</p>

            <label className={styles.fieldLabel} htmlFor="video-title">
              Title <span className={styles.required}>*</span>
            </label>
            <input
              id="video-title"
              className={styles.fieldInput}
              type="text"
              value={title}
              maxLength={100}
              placeholder="Give your video a title"
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className={styles.charCount}>{title.length}/100</div>

            <label className={styles.fieldLabel} htmlFor="video-description">
              Description
            </label>
            <textarea
              id="video-description"
              className={styles.fieldTextarea}
              value={description}
              maxLength={500}
              placeholder="Tell viewers about your video (optional)"
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
            <div className={styles.charCount}>{description.length}/500</div>

            <label className={styles.fieldLabel} htmlFor="video-thumbnail">
              Thumbnail
            </label>
            <input
              id="video-thumbnail"
              ref={thumbnailInputRef}
              className={styles.thumbnailInput}
              type="file"
              accept="image/*"
              onChange={handleThumbnailChange}
              disabled={uploading}
            />
            <div className={styles.thumbnailRow}>
              <label
                htmlFor="video-thumbnail"
                className={`${styles.thumbnailPickButton}${uploading ? " " + styles.thumbnailPickButtonDisabled : ""}`}
              >
                {thumbnail ? "Change image" : "Choose image (optional)"}
              </label>
              {thumbnailPreview && (
                <div className={styles.thumbnailPreviewWrap}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailPreview}
                    alt="Thumbnail preview"
                    className={styles.thumbnailPreview}
                  />
                  <button
                    type="button"
                    className={styles.thumbnailRemove}
                    onClick={removeThumbnail}
                    disabled={uploading}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={closeModal}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.submitButton}
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Fragment>
  );
}