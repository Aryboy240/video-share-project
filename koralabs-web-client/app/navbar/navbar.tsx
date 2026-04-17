'use client';

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./navbar.module.css";
import SignIn from "./sign-in";
import { onAuthStateChangedHelper } from "../firebase/firebase";
import { useEffect, useState } from "react";
import { User } from "@firebase/auth/cordova";
import Upload from "./upload";
import NotificationBell from "./notification-bell";

export default function Navbar() {
    const [user, setUser] = useState<User | null>(null);
    const [query, setQuery] = useState('');
    const router = useRouter();

    useEffect(() => {
        const unsubscribe = onAuthStateChangedHelper((user) => {
            setUser(user);
        });
        return () => unsubscribe();
    });

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const q = query.trim();
        if (q) {
            router.push(`/?search=${encodeURIComponent(q)}`);
        } else {
            router.push('/');
        }
    };

    return (
    <nav className={styles.nav}>
        <Link href="/" className={styles.navLink}>
            <Image width={50} height={50} src="/images/logos/KL-White.png" alt="KL Logo"/>
            <p>KoraLabs Video</p>
        </Link>

        <form className={styles.searchForm} onSubmit={handleSearch}>
            <input
                type="text"
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search videos…"
                aria-label="Search videos"
            />
            {query && (
                <button
                    type="button"
                    className={styles.clearButton}
                    aria-label="Clear search"
                    onClick={() => { setQuery(''); router.push('/'); }}
                >✕</button>
            )}
            <button type="submit" className={styles.searchButton} aria-label="Search">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
            </button>
        </form>

        <div className={styles.navRight}>
            {user && <Upload />}
            {user && <NotificationBell uid={user.uid} />}
            <SignIn user={user} />
        </div>
    </nav>
    );
}
