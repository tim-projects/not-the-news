Text-to-Speech Enhancements
Control speed/voice with utterance.rate and utterance.voice, pausing via speechSynthesis.pause(). Add event listeners for article load to auto-read or use a shortcut like 'v'.​

----

Reader View / Extractor Integration
o key opens the website article in the right side pane (using the extractor)
Shift+o opens the website in a new tab

In order to do this we will need a folder containing website specific extractor modules, or a generic extraction module
ideally we could expose the per website settings to the user so that they could fix the extraction themselves and then submit upstream to the main app

---

Play Icon Visibility Scroll
If using the right arrows on an item to select the read, starred and play icon. Sometimes the item description is long and goes off the screen. In that case selecting the play icon happens off the screen and the user can't see it, so we will need to scroll the window to the play icon. But we should only perform the scroll if the bottom of the item window is off the screen.
