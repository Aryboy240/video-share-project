'use client'

import { signInWithGoogle, signOut } from "../firebase/firebase";
import styles from "./sign-in.module.css"
import { User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SignInProps {
    user: User | null;
}

export default function SignIn({ user }: SignInProps) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

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

    if (!user) {
        return (
            <button className={styles.signin} onClick={signInWithGoogle}>Sign In</button>
        );
    }

    const initial = (user.displayName || user.email || 'U').slice(0, 1).toUpperCase();

    return (
        <div className={styles.dropdownWrap} ref={wrapRef}>
            <button
                className={styles.avatarBtn}
                onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
                aria-label="Account menu"
            >
                {user.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={user.photoURL}
                        alt={user.email ?? 'User avatar'}
                        className={styles.avatarImg}
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <span className={styles.avatarInitial}>{initial}</span>
                )}
            </button>

            {open && (
                <div className={styles.dropdown}>
                    <button
                        className={styles.dropdownItem}
                        onClick={() => { setOpen(false); router.push(`/channel/${user.uid}`); }}
                    >
                        My Channel
                    </button>
                    <button
                        className={styles.dropdownItem}
                        onClick={() => { setOpen(false); router.push('/studio'); }}
                    >
                        Studio
                    </button>
                    <button
                        className={styles.dropdownItem}
                        onClick={() => { setOpen(false); signOut(); }}
                    >
                        Sign Out
                    </button>
                </div>
            )}
        </div>
    );
}
