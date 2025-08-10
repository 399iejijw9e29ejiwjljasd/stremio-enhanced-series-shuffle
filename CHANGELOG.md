# Changelog

## **5.5.0** – *2025-08-10*

**Enhancements**

* **Language-Aware Playback:**

  * Automatically selects streams matching the user’s preferred language in Stremio Enhanced settings.
  * Defaults to **English** if no preference is set.

* **Playback Stability:**

  * Fixed bug where shuffle would rapidly skip through episodes before playback started.
  * Added \~10-second load buffer for streams before shuffle logic runs.

* **Navigation Improvements:**

  * After stopping playback, user is returned directly to the series details page.
  * Eliminates the need to click “Back” through each shuffled episode.

**Bug Fixes**

* Shuffle buttons not appearing on the series page in some cases — improved detection logic.
* Shuffle session handling improvements to reduce state loss between episodes.

---

## **5.4.1** – *Previous Release*

* Added persistent shuffle sessions per series for up to 24 hours.
* Added player-bar shuffle toggle for mid-playback activation/deactivation.
* Improved autoplay randomization logic.

---

