import { AppState } from '@/types/app.ts';
import { saveSimpleState, loadSimpleState } from '../data/dbUserState.ts';
import { createStatusBarMessage } from './uiUpdaters.ts';
import { parseRssFeedsConfig } from '../helpers/dataUtils.ts';

export async function loadThemeStyle(app: AppState): Promise<void> {
    const [, lightRes, darkRes] = await Promise.all([
        loadSimpleState('themeStyle'),
        loadSimpleState('themeStyleLight'),
        loadSimpleState('themeStyleDark')
    ]);
    
    app.themeStyleLight = typeof lightRes.value === 'string' ? lightRes.value : 'originalLight';
    app.themeStyleDark = typeof darkRes.value === 'string' ? darkRes.value : 'originalDark';
    
    // If we just loaded, set themeStyle based on current theme to ensure consistency
    if (app.theme === 'light') {
        app.themeStyle = app.themeStyleLight;
    } else {
        app.themeStyle = app.themeStyleDark;
    }
    
    applyThemeStyle(app);
}

export async function updateThemeAndStyle(app: AppState, newStyle: string, newTheme: 'light' | 'dark'): Promise<void> {
    console.log(`Updating theme to ${newTheme} and style to ${newStyle}`);
    
    app.theme = newTheme;
    app.themeStyle = newStyle;
    
    // Apply UI change immediately
    applyThemeStyle(app);
    
    // Persist to DB and sync in background
    (async () => {
        const htmlEl = document.documentElement;
        htmlEl.classList.remove('light', 'dark');
        htmlEl.classList.add(newTheme);
        localStorage.setItem('theme', newTheme);
        
        await saveSimpleState('theme', newTheme, 'userSettings', app);
        
        if (newTheme === 'light') {
            app.themeStyleLight = newStyle;
            localStorage.setItem('themeStyleLight', newStyle);
            await saveSimpleState('themeStyleLight', newStyle, 'userSettings', app);
        } else {
            app.themeStyleDark = newStyle;
            localStorage.setItem('themeStyleDark', newStyle);
            await saveSimpleState('themeStyleDark', newStyle, 'userSettings', app);
        }
        
        await saveSimpleState('themeStyle', newStyle, 'userSettings', app);
        createStatusBarMessage(app, `Theme set to ${newTheme} (${newStyle}).`);
    })();
}

export async function saveThemeStyle(app: AppState): Promise<void> {
    // This method is now mostly handled by updateThemeAndStyle
    // But we keep it for backward compatibility or if called directly
    if (app.theme === 'light') {
        app.themeStyleLight = app.themeStyle;
        localStorage.setItem('themeStyleLight', app.themeStyleLight);
        await saveSimpleState('themeStyleLight', app.themeStyleLight, 'userSettings', app);
    } else {
        app.themeStyleDark = app.themeStyle;
        localStorage.setItem('themeStyleDark', app.themeStyleDark);
        await saveSimpleState('themeStyleDark', app.themeStyleDark, 'userSettings', app);
    }
    
    await saveSimpleState('themeStyle', app.themeStyle, 'userSettings', app);
    applyThemeStyle(app);
}

export function applyThemeStyle(app: AppState): void {
    const htmlEl = document.documentElement;
    
    // Manage light/dark base classes
    htmlEl.classList.remove('light', 'dark');
    htmlEl.classList.add(app.theme);
    
    // Manage theme style specific classes - remove ALL theme- classes
    const classes = Array.from(htmlEl.classList);
    classes.forEach(c => {
        if (c.startsWith('theme-')) {
            htmlEl.classList.remove(c);
        }
    });
    
    // Add the theme class (now including original themes)
    if (app.themeStyle) {
        htmlEl.classList.add(`theme-${app.themeStyle}`);
    }
}

export async function loadFontSize(app: AppState): Promise<void> {
    const { value } = await loadSimpleState('fontSize');
    app.fontSize = (typeof value === 'number') ? value : 100;
    applyFontSize(app);
}

export async function saveFontSize(app: AppState): Promise<void> {
    await saveSimpleState('fontSize', app.fontSize, 'userSettings', app);
    applyFontSize(app);
}

export function applyFontSize(app: AppState): void {
    document.documentElement.style.setProperty('--font-scale', (app.fontSize / 100).toString());
}

export async function loadFeedWidth(app: AppState): Promise<void> {
    const { value } = await loadSimpleState('feedWidth');
    app.feedWidth = (typeof value === 'number') ? value : 50;
    applyFeedWidth(app);
}

export async function saveFeedWidth(app: AppState): Promise<void> {
    await saveSimpleState('feedWidth', app.feedWidth, 'userSettings', app);
    applyFeedWidth(app);
}

export function applyFeedWidth(app: AppState): void {
    document.documentElement.style.setProperty('--feed-width', `${app.feedWidth}%`);
}

export async function saveFonts(app: AppState): Promise<void> {
    await Promise.all([
        saveSimpleState('fontTitle', app.fontTitle, 'userSettings', app),
        saveSimpleState('fontBody', app.fontBody, 'userSettings', app)
    ]);
    applyFonts(app);
}

export function applyFonts(app: AppState): void {
    document.documentElement.style.setProperty('--font-title', app.fontTitle);
    document.documentElement.style.setProperty('--font-body', app.fontBody);
}

export async function loadAnimationSpeed(app: AppState): Promise<void> {
    const { value } = await loadSimpleState('animationSpeed');
    app.animationSpeed = (typeof value === 'number') ? value : 100;
    applyAnimationSpeed(app);
}

export async function saveAnimationSpeed(app: AppState): Promise<void> {
    await saveSimpleState('animationSpeed', app.animationSpeed, 'userSettings', app);
    applyAnimationSpeed(app);
}

export function applyAnimationSpeed(app: AppState): void {
    // 200% speed means 0.5x duration, 50% speed means 2x duration
    const factor = 100 / (app.animationSpeed || 100);
    document.documentElement.style.setProperty('--animation-duration-factor', factor.toString());
}

export async function loadCustomCss(app: AppState): Promise<void> {
    const { value } = await loadSimpleState('customCss');
    app.customCss = (typeof value === 'string' && value.trim() !== '') ? value : generateCustomCssTemplate(app);
    applyCustomCss(app);
}

export async function saveCustomCss(app: AppState): Promise<void> {
    try {
        await saveSimpleState('customCss', app.customCss, 'userSettings', app);
        applyCustomCss(app);
        createStatusBarMessage(app, 'Custom CSS saved!');
    } catch (error: any) {
        console.error('Error saving custom CSS:', error);
        createStatusBarMessage(app, `Failed to save custom CSS: ${error.message}`);
    }
}

export async function resetCustomCss(app: AppState): Promise<void> {
    if (!confirm('Reset Custom CSS to default template? This will overwrite your current customizations.')) {
        return;
    }
    app.customCss = generateCustomCssTemplate(app);
    await saveCustomCss(app);
    createStatusBarMessage(app, 'Custom CSS reset to template!');
}

export function generateCustomCssTemplate(app: AppState): string {
    const style = getComputedStyle(document.documentElement);
    const vars = [
        '--bg', '--fg', '--primary', '--secondary', '--card-bg', 
        '--card-border', '--card-shadow-color', '--fg-muted', '--border-radius'
    ];
    
    let template = `/* Custom CSS Template - Current theme: ${app.theme} ${app.themeStyle} */\n:root {\n`;
    vars.forEach(v => {
        const val = style.getPropertyValue(v).trim();
        if (val) template += `  ${v}: ${val};
`;
    });
    template += `}\n\n/* Add custom styles below */\n`;
    return template;
}

export function applyCustomCss(app: AppState): void {
    let styleEl = document.getElementById('custom-user-css');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'custom-user-css';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = app.customCss;
}

export function preloadThemes(): void {
    console.log("[Theme] Preloading all theme styles into browser cache...");
    // Just force the browser to request these by creating temporary hidden elements
    const themes = [
        'sepia', 'solarized-light', 'github-light', 'atom-one-light', 
        'gruvbox-light', 'catppuccin-latte', 'rose-pine-dawn', 'paper', 'morning',
        'midnight', 'nord', 'dracula', 'monokai', 'gruvbox-dark', 
        'catppuccin-mocha', 'tokyo-night', 'synthwave', 'material-dark'
    ];
    
    const container = document.createElement('div');
    container.style.display = 'none';
    container.id = 'theme-preloader';
    document.body.appendChild(container);
    
    themes.forEach(theme => {
        const el = document.createElement('div');
        el.className = `theme-${theme}`;
        container.appendChild(el);
        // Accessing a property forces style calculation
        window.getComputedStyle(el).getPropertyValue('--bg');
    });
    
    // Cleanup after a short delay
    setTimeout(() => {
        document.body.removeChild(container);
        console.log("[Theme] Preloading completed.");
    }, 2000);
}
