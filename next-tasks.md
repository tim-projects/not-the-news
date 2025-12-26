Add a play button in the bottom right of the item, and a settings toggle to show/hide it

Text-to-Speech in PWA
Implement using the browser's SpeechSynthesis API, which works offline in modern PWAs.
Load articles into a reader view, then add a play button triggering speechSynthesis.speak(new SpeechSynthesisUtterance(articleText)). 

Control speed/voice with utterance.rate and utterance.voice, pausing via speechSynthesis.pause(). Add event listeners for article load to auto-read or use a shortcut like 'v'.​

----

Feed Auto-Discovery with JS
Fetch the website URL, parse <link rel="alternate" type="application/rss+xml"> tags from HTML head, or check Link headers via fetch(url, {headers: {Accept: 'application/rss+xml'}}).

Add an option ad the top of the rssfeed config screen to add a website, that then automatically finds the rss feed and adds it to the list

---

The undo button shouldn't appear in All filter mode

---

Search for starred items view. 

---

Shift + up or down should scroll normally

---

o key opens the website article in the right side pane (using the extractor)
Shift+o opents the website in a new tab

In order to do this we will need a folder containing website specific extractor modules, or a generic extraction module
ideally we could expose the per website settings to the user so that they could fix the extraction themselves and then submit upstream to the main app

---

close animation

the item description folds upward into the item-title, then the item title swipes off to the left, then selects the next item in the list

---

add a tiktok style mouse/touch and flick gesture to switch between feed items much in the same way that the up and down keys do it.

----

When selecting All filter mode in settings, the window should auto scroll to the current selected item after the feed is shown.

----

If using the right arrows on an item to select the read, starred and play icon. Sometimes the item description is long and goes off the screen. In that case selecting the play icon happens off the screen and the user can't see it, so we will need to scroll the window to the play icon. But we should only perform the scroll if the bottom of the item window is off the screen.

---

The settings icon should only be active when the settings modal is open. The help screen icon should only be active when the help screen is open.

----

The 'There's nothing here.' here message should be vertically centered on the screen.

----

In the settings have each setting has it's main option line, then underneath is a description line with a smaller font that explains what the setting does in a few words.
