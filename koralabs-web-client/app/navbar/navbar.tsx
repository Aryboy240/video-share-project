'use client';

import Image from "next/image";
import Link from "next/link";
import styles from "./navbar.module.css";
import SignIn from "./sign-in";
import { onAuthStateChangedHelper } from "../firebase/firebase";
import { useEffect, useState } from "react";
import { User } from "@firebase/auth/cordova";
import Upload from "./upload";

export default function Navbar() {
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChangedHelper((user) => {
            setUser(user);
        });
        return () => unsubscribe();
    });

    return (
    <nav className={styles.nav}>
        <Link href="/" className={styles.navLink}>
            <Image width={50} height={50} src="/images/logos/KL-White.png" alt="KL Logo"/>
            <p>KoraLabs Video</p>
        </Link>
        {
        user && <Upload />
        }
        <SignIn user={user} />
    </nav>
    );
}