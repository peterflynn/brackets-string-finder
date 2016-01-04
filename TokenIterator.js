/*
 * Copyright (c) 2015 Peter Flynn.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4 */
/*global define, brackets */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var CodeMirror  = brackets.getModule("thirdparty/CodeMirror/lib/codemirror");
    
    
    function TokenIterator(text) {
        var mode = CodeMirror.getMode({}, "javascript");
        var modeState = CodeMirror.startState(mode);
        
        var lineText;
        var nextEol = -1;
        var pos = { line: -1 };
        var index;
        var stream;
        
        function nextLine() {
            do {
                index = nextEol + 1;
                if (index >= text.length) {
                    return false;
                }
                nextEol = text.indexOf("\n", index);
                if (nextEol === -1) {
                    nextEol = text.length;  // last line
                }
                pos.line++;
                pos.ch = 1;

                lineText = text.substring(index, nextEol);
            } while (lineText === "");

            stream = new CodeMirror.StringStream(lineText);
            return true;
            // at this point, stream.pos and index both point to the start of the line; and pos.ch points to 1 char later
        }
        
        function next() {
            if (!stream) {
                return null;  // special case if fed empty string or string of nothing but empty lines
            }

            stream.start = stream.pos;  // move stream to start of next token (just past end of prev token)

            // Advance our position before trying to advance stream, since we want our state to point past EOF if we bail due to EOF
            var oldPos = pos.ch;
            pos.ch = stream.start + 1;  // +1 to line up with the odd way editor-driven iteration works
            index += (pos.ch - oldPos);
            // now pos.ch and _index also reflect the start of the token we're about to emit

            if (stream.eol()) {
                if (!nextLine()) {
                    return null;
                }
            }

            var style = mode.token(stream, modeState);  // advances stream.pos to end of token
            var tokenText = stream.current();

            console.assert(stream.pos - stream.start === tokenText.length);
            // at this point, stream.pos points to 1st char AFTER the token (which may be past EOL); index still points to start of token,
            // and pos.ch still points to 1 char later (may also be past EOL if token was len 1)
            
            return {
                line: pos.line,
                start: stream.start,        // inclusive
                end: stream.pos,            // exclusive (end === start + string.length)
                string: tokenText,
                type: style || null  // normalize undefined style to null, just like CM does
            };
        }
        
        
        this.next = next;
        this.getLineText = function () {
            return lineText;
        };
        
        nextLine();
    }
    
    
    function textIterator(text) {
        return new TokenIterator(text);
    }
    
    exports.textIterator = textIterator;
});