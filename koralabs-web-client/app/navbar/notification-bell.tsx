'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getNotifications, markNotificationsRead, Notification } from '../firebase/functions';
import styles from './notification-bell.module.css';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface Props {
  uid: string;
}

export default function NotificationBell({ uid }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const unreadCount = notifications.filter((n) => !n.read).length;
  const badgeLabel = unreadCount > 9 ? '9+' : unreadCount > 0 ? String(unreadCount) : null;

  const load = async () => {
    try {
      const data = await getNotifications();
      setNotifications(data);
    } catch {
      // silent
    }
  };

  // Initial load + 60s poll
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  const handleMarkAllRead = async () => {
    if (marking || unreadCount === 0) return;
    setMarking(true);
    try {
      await markNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // silent
    } finally {
      setMarking(false);
    }
  };

  const handleNotificationClick = (n: Notification) => {
    setOpen(false);
    // Mark read locally immediately
    setNotifications((prev) =>
      prev.map((item) => item.id === n.id ? { ...item, read: true } : item)
    );
    if (n.videoId) {
      router.push(`/watch?v=${n.videoId}`);
    }
    // Background sync
    if (!n.read) markNotificationsRead().catch(() => {});
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bellBtn}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z"/>
        </svg>
        {badgeLabel && <span className={styles.badge}>{badgeLabel}</span>}
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropdownHeader}>
            <span className={styles.dropdownTitle}>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className={styles.markReadBtn}
                onClick={handleMarkAllRead}
                disabled={marking}
              >
                Mark all as read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className={styles.empty}>No notifications yet</p>
          ) : (
            <div className={styles.list}>
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`${styles.item} ${!n.read ? styles.itemUnread : ''} ${styles[`type_${n.type}`]}`}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div className={styles.itemAvatar}>
                    {n.fromName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className={styles.itemBody}>
                    <p className={styles.itemMessage}>{n.message}</p>
                    {n.videoTitle && (
                      <p className={styles.itemSub}>{n.videoTitle}</p>
                    )}
                    <span className={styles.itemTime}>{timeAgo(n.createdAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
