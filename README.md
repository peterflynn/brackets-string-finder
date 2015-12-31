String Finder for Brackets
==========================
Find all string literals in your JS code, across your whole project - helpful for localization or for catching coding style problems
(using strings where you should use constants).

String Finder ignores the following:

* The empty string
* String literals in `require("...")`
* String literals in `Object.defineProperty(..., "...", ...`
* String literals in `new Error(...)`
* String literals in `console.log(...)` and warn/error/assert
* `"use strict"` alone on a line

To use String Finder, just choose _Find > Find All String Literals_.


How to Install
==============
String Finder is an extension for [Brackets](https://github.com/adobe/brackets/), an open-source code editor for web developers.

To install extensions:

1. Choose _File > Extension Manager_ and select the _Available_ tab
2. Search for this extension
3. Click _Install_!


Preferences
===========
The list of files/folders you excluded is saved as a preference - by default, Brackets-global. To save project-specific exclusions:

1. Create a _.brackets.json_ file in the root of your project, if you do not already have one
2. Add `"pflynn.string-finder.exclusions": []` to the JSON object
3. Now, whenever you have this project open String Finder will use the project-specific preference. If you have a different project open (that does
not have a project-specific preference set), it will continue to use the Brackets-global preference instead.


### License
MIT-licensed -- see `main.js` for details.

### Compatibility
Brackets 1.0 or newer.