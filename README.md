# Vietboard - Ô Chữ Tiếng Việt

This is a Vietnamese Scrabble-type word game implemented in pure JavaScript and played against the computer with a very fast engine. You can [play the game online](https://www.vietboard.org/play/) or download the code and open *index.html* in your browser.

The code comprises an engine (*engine.js*) that does the game logic and a user interface (*ui.js*) that renders the board and manages user interactions. This design allows one to easily create alternative user interfaces. The code is also designed to be easily localized to other languages.

The fast game play is made possible by leveraging Regular Expressions to conduct searches. The current UI makes use of the excellent [REDIPS.drag](https://github.com/dbunic/REDIPS_drag) drag-and-drop library. Other credits go to [Hồ Ngọc Đức](https://www.informatik.uni-leipzig.de/~duc/software/misc/wordlist.html) for the original 22K word list (continuously being updated) and [VDict](https://vdict.com/) for the word definitions.

Corrections and comments are welcome by [sending an email](mailto:feedback@vietboard.org?subject=Vietboard) or [creating an Issue](https://github.com/thdoan/vietboard/issues).

## Major changes from [JScrab](https://github.com/amnond/jscrab)

- Localized to Vietnamese language
- Added ability to use compound words via the Space tile (fundamental to Vietnamese vocabulary)
- Optimized images using [RIOT](https://riot-optimizer.com/)
- Changed opponent tile border to solid for consistency
- Moved `index.html` to root
- Added sound effects
- Deleted unused JavaScript files
- Optimized JavaScript code and prepared it for minification
- Added local build script (concatenates and minifies)
- Fixed a couple of missing translation strings and miscellaneous typos
- Increased rack size to eight tiles (improves playability in Vietnamese)
- Replaced hardcoded `g_wstr` with a dynamically created list
- Improved modal dialog formatting and spacing
- Added subtle animation and shadow to modal dialog
- Added Play Again button to the "game over" dialog
- Increased computer AI so it can create up to 15-letter words
- Added AJAX request to retrieve word definitions from the internet
- Improved modal dialog sizing and centering logic
- Increased computer playing speed
- Added tooltips for icons and computer level
- Added ability to close modals by pressing the Escape key
- Added ability to remember selected computer level
- Added feedback footer link
- Increased to 10 difficulty levels that have a smoother progression
- Fixed move cursor shown for opponent tiles
- Added icon effect on mouse hover
- Added favicon for all platforms
- Added Open Graph and JSON-LD tags (SEO)
- Added language selector for the UI
- Fixed ability to drag tiles onto opponent's button
- Added GA event tracking
- Added ability to close modals by clicking on the shadow
- Added loading animation and fade-in transition
- Removed dependency on Sizzle
- Added message for unsupported legacy browsers
- Fixed modal rendering on mobile
- Removed dependency on subModal
- Added option to choose different tilesets
- Simplified and polished user interface
- Added debug mode
- Removed button to show computer rack (still available in debug mode)
- Removed hardcoded `g_vowels` since AI doesn't rely on that anymore
- Fixed computer sometimes starting off the star
- Fixed incorrect scoring in many cases
- Fixed JS error when clicking Pass repeatedly (button disabled while animating tiles)
- Updated code to be HTML5 compliant
- Redesigned swap modal dialog
- Replaced bitmaps with vectors for HiDPI screens
- Introduced randomness to make computer more human
- Enhanced desktop gameboard to be fluid (scales to window size)
- Added responsive design for mobile devices
- Improved bonuses layout (more evenly spread out)
- Added option to change bonuses layout
- Added "what's new" update notification
- Added proper Game Over modal
- Fixed possibility to swap more tiles than remaining
- Changed position of Pass button
- Added Shuffle feature
- Added saved sessions
- Added Restart button
- Enhanced computer AI so it swaps instead of passes
- Added high scores table

## Dependencies for local build

- [Microsoft Ajax Minifier](https://github.com/microsoft/ajaxmin)
- [Find And Replace Text](https://github.com/lionello/fart-it)
