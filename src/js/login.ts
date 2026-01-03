import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    signInAnonymously,
    sendPasswordResetEmail
} from "firebase/auth";
import { auth } from "./firebase";

// Handle redirect result errors
getRedirectResult(auth).catch((error) => {
    console.error("Google Redirect Error:", error);
    showMessage(error.message || "Failed to complete Google login");
});

const loginForm = document.getElementById("login-form") as HTMLFormElement;
const emailInput = document.getElementById("email") as HTMLInputElement;
const pwInput = document.getElementById("pw") as HTMLInputElement;
const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;
const signupBtn = document.getElementById("signup-btn") as HTMLButtonElement;
const googleBtn = document.getElementById("google-btn") as HTMLButtonElement;
const forgotPwLink = document.getElementById("forgot-pw-link") as HTMLAnchorElement;
const authMessage = document.getElementById("auth-message") as HTMLDivElement;

console.log("[Auth] Login script loaded. Form found:", !!loginForm);

const showMessage = (msg: string, isError: boolean = true) => {
    const msgEl = document.getElementById("auth-message") as HTMLDivElement;
    if (msgEl) {
        msgEl.textContent = msg;
        msgEl.style.color = isError ? '#ff4444' : '#44ff44';
        msgEl.style.display = 'block';
    } else {
        alert(msg);
    }
};

const clearMessage = () => {
    const msgEl = document.getElementById("auth-message") as HTMLDivElement;
    if (msgEl) {
        msgEl.textContent = '';
        msgEl.style.display = 'none';
    }
};

// Redirect if already logged in
onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("[Auth] User detected:", user.uid, user.isAnonymous ? "(Anonymous)" : "(Authenticated)");
        localStorage.setItem('isAuthenticated', 'true');
        window.location.href = "/";
    }
});

if (forgotPwLink) {
    forgotPwLink.addEventListener('click', async (e) => {
        e.preventDefault();
        clearMessage();
        const email = emailInput?.value.trim();
        if (!email) {
            showMessage("Please enter your email address first.");
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            showMessage(`Password reset email sent to ${email}`, false);
        } catch (error: any) {
            console.error("Password reset error:", error);
            showMessage(error.message || "Failed to send password reset email");
        }
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessage();
        
        const email = emailInput?.value.trim();
        const password = pwInput?.value;

        if (!email || !password) {
            showMessage("Email and password required");
            return;
        }

        // TEST ACCOUNT BYPASS
        // Allow test@example.com with the dev password to log in (Development only)
        if (import.meta.env.DEV && email === 'test@example.com' && password === 'devtestpwd') {
            console.log("[Auth] Using test account bypass...");
            if (loginBtn) {
                loginBtn.disabled = true;
                loginBtn.dataset.authStatus = "attempting_bypass";
            }
            try {
                // Try anonymous first
                await signInAnonymously(auth);
                if (loginBtn) loginBtn.dataset.authStatus = "success_anon";
                return;
            } catch (anonError: any) {
                console.warn("[Auth] Anonymous login failed, trying email signup for test account:", anonError.message);
                if (loginBtn) loginBtn.dataset.authStatus = "trying_email_fallback";
                try {
                    // Fallback to real account for test credentials
                    await signInWithEmailAndPassword(auth, email, password);
                    if (loginBtn) loginBtn.dataset.authStatus = "success_email";
                    return;
                } catch (signInError: any) {
                    try {
                        await createUserWithEmailAndPassword(auth, email, password);
                        if (loginBtn) loginBtn.dataset.authStatus = "success_created";
                        return;
                    } catch (createError: any) {
                        console.error("[Auth] Bypass failed completely:", createError.message);
                        if (loginBtn) {
                            loginBtn.dataset.authStatus = "failed";
                            loginBtn.disabled = false;
                        }
                    }
                }
            }
        }

        if (loginBtn) loginBtn.disabled = true;
        try {
            await signInWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged will handle redirect
        } catch (error: any) {
            console.error("Login error:", error);
            showMessage(error.message || "Failed to login");
            if (loginBtn) loginBtn.disabled = false;
        }
    });
    loginForm.dataset.authReady = "true";
}

if (signupBtn) {
    signupBtn.addEventListener('click', async () => {
        clearMessage();
        const email = emailInput?.value.trim();
        const password = pwInput?.value;

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
}

if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        console.log("[Auth] Google button clicked");
        clearMessage();
        const provider = new GoogleAuthProvider();
        googleBtn.disabled = true;
        try {
            console.log("[Auth] Calling signInWithRedirect...");
            await signInWithRedirect(auth, provider);
            // Redirect will happen, onAuthStateChanged will handle the return
        } catch (error: any) {
            console.error("Google login error:", error);
            showMessage(error.message || "Failed to login with Google");
            googleBtn.disabled = false;
        }
    });
}
