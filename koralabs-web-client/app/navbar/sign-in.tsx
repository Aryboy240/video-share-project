'use client'

import { Fragment } from "react/jsx-runtime"

import { signInWithGoogle, signOut } from "../firebase/firebase";
import styles from "./sign-in.module.css"
import { User } from "firebase/auth";

interface SignInProps {
    user: User | null;
}

export default function SignIn({ user }: SignInProps) {
    return (
        <Fragment>
            {
                user ?
                (<button className={styles.signin} onClick={signOut}>Sign out</button>)
                :
                (<button className={styles.signin} onClick={signInWithGoogle}>Sign In</button>)
            }
        </Fragment>
    );
}