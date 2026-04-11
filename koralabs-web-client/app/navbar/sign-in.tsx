'use client'

import { signInWithGoogle, signOut } from "../firebase/firebase";
import styles from "./sign-in.module.css"
import { User } from "firebase/auth";

interface SignInProps {
    user: User | null;
}

export default function SignIn({ user }: SignInProps) {
    if (!user) {
        return (
            <button className={styles.signin} onClick={signInWithGoogle}>Sign In</button>
        );
    }

    return (
        <div className={styles.userBadge}>
            <div className={styles.avatar}>
                {user.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={user.photoURL}
                        alt={user.email ?? 'User avatar'}
                        className={styles.avatarImg}
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <svg
                        className={styles.avatarFallback}
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                )}
            </div>
            {user.email && <span className={styles.email}>{user.email}</span>}
            <button className={styles.signin} onClick={signOut}>Sign out</button>
        </div>
    );
}