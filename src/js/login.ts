import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signInAnonymously
} from "firebase/auth";
import { auth } from "./firebase";

const loginForm = document.getElementById("login-form") as HTMLFormElement;
const emailInput = document.getElementById("email") as HTMLInputElement;
const pwInput = document.getElementById("pw") as HTMLInputElement;
const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;
const signupBtn = document.getElementById("signup-btn") as HTMLButtonElement;
const googleBtn = document.getElementById("google-btn") as HTMLButtonElement;
const authMessage = document.getElementById("auth-message") as HTMLDivElement;

console.log("[Auth] Login script loaded");
console.log("[Auth] Google button element:", googleBtn);

const showMessage = (msg: string) => {
    authMessage.textContent = msg;
    authMessage.style.display = 'block';
};

const clearMessage = () => {
    authMessage.textContent = '';
    authMessage.style.display = 'none';
};

// Redirect if already logged in
onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("[Auth] User detected:", user.uid, user.isAnonymous ? "(Anonymous)" : "(Authenticated)");
        window.location.href = "/";
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage();
    
    const email = emailInput.value.trim();
    const password = pwInput.value;

    if (!email || !password) {
        showMessage("Email and password required");
        return;
    }

    // TEST ACCOUNT BYPASS
    // Allow test@example.com with the dev password to log in anonymously
    if (email === 'test@example.com' && password === 'devtestpwd') {
        console.log("[Auth] Using test account bypass...");
        loginBtn.disabled = true;
        try {
            await signInAnonymously(auth);
            return;
        } catch (error: any) {
            console.error("Anonymous login error:", error);
        }
    }

    loginBtn.disabled = true;
    try {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged will handle redirect
    } catch (error: any) {
        console.error("Login error:", error);
        showMessage(error.message || "Failed to login");
        loginBtn.disabled = false;
    }
});

signupBtn.addEventListener('click', async () => {
    clearMessage();
    const email = emailInput.value.trim();
    const password = pwInput.value;

    if (!email || !password) {
        showMessage("Email and password required for signup");
        return;
    }

    signupBtn.disabled = true;
    try {
        await createUserWithEmailAndPassword(auth, email, password);
        showMessage("Account created! Logging in...");
    } catch (error: any) {
        console.error("Signup error:", error);
        showMessage(error.message || "Failed to create account");
        signupBtn.disabled = false;
    }
});

googleBtn?.addEventListener('click', async () => {
    console.log("[Auth] Google button clicked");
    clearMessage();
    const provider = new GoogleAuthProvider();
    googleBtn.disabled = true;
    try {
        console.log("[Auth] Calling signInWithPopup...");
        await signInWithPopup(auth, provider);
        console.log("[Auth] signInWithPopup returned");
    } catch (error: any) {
        console.error("Google login error:", error);
        showMessage(error.message || "Failed to login with Google");
        googleBtn.disabled = false;
    }
});
