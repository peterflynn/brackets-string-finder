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
/*jshint multistr: true */
/*global define, brackets, $, Mustache */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var _                   = brackets.getModule("thirdparty/lodash"),
        CommandManager      = brackets.getModule("command/CommandManager"),
        Commands            = brackets.getModule("command/Commands"),
        Menus               = brackets.getModule("command/Menus"),
        WorkspaceManager    = brackets.getModule("view/WorkspaceManager"),
        ProjectManager      = brackets.getModule("project/ProjectManager"),
        DocumentManager     = brackets.getModule("document/DocumentManager"),
        EditorManager       = brackets.getModule("editor/EditorManager"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils"),
        Async               = brackets.getModule("utils/Async"),
        StatusBar           = brackets.getModule("widgets/StatusBar"),
        Dialogs             = brackets.getModule("widgets/Dialogs"),
        PreferencesManager  = brackets.getModule("preferences/PreferencesManager");
    
    // Extension's modules
    var TokenIterator = require("TokenIterator");
    
    
    var resultsPanel;
    
    var prefs = PreferencesManager.getExtensionPrefs("pflynn.string-finder");
    prefs.definePreference("exclusions", "Array", []);
    
    /**
     * Want to use the current project's settings even if user happens to have a file from outside the project open. Just passing
     * CURRENT_PROJECT should be enough, but it's not - https://github.com/adobe/brackets/pull/10422#issuecomment-73654748
     */
    function projPrefsContext() {
        var context = _.cloneDeep(PreferencesManager.CURRENT_PROJECT);
        context.path = ProjectManager.getProjectRoot().fullPath;
        return context;
    }
    
    var filterStrings = [];
    
    // (code borrowed from SLOC extension)
    function filter(fileInfo) {
        var path = fileInfo.fullPath;
        var i;
        for (i = 0; i < filterStrings.length; i++) {
            if (path.indexOf(filterStrings[i]) !== -1) {
                return false;
            }
        }
        return true;
    }
    
    
    function destroyPanel() {
        resultsPanel.hide();
        resultsPanel.$panel.remove();
        resultsPanel = null;
    }
    
    /** Shows a large message in a dialog with a scrolling panel. Based on BracketsReports extension. */
    function showResult(fileList, totalStrings) {
        
        // (Adapted from the CodeInspection & FindInFiles code)
        var panelHtml = "<div id='allstrings-panel' class='bottom-panel vert-resizable top-resizer'>\
                            <div class='toolbar simple-toolbar-layout'>\
                                <div class='title'></div>\
                                <a href='#' class='close'>&times;</a>\
                            </div>\
                            <div class='table-container resizable-content'></div>\
                        </div>";
        var template = "<table class='bottom-panel-table table table-striped table-condensed row-highlight'>\
                            <tbody>\
                                {{#fileList}}\
                                <tr class='file-section'>\
                                    <td colspan='3'><span class='disclosure-triangle expanded'></span><span class='dialog-filename'>{{displayPath}}</span></td>\
                                </tr>\
                                {{#strings}}\
                                <tr data-fullpath='{{fullPath}}' data-line='{{startPos.line}}' data-ch='{{startPos.ch}}' data-endline='{{endPos.line}}' data-endch='{{endPos.ch}}'>\
                                    <td class='line-number'>{{friendlyLine}}</td>\
                                    <td>{{message}}</td>\
                                    <td>{{codeSnippet}}</td>\
                                </tr>\
                                {{/strings}}\
                                {{/fileList}}\
                            </tbody>\
                        </table>";
        
        resultsPanel = WorkspaceManager.createBottomPanel("all-strings", $(panelHtml), 100);
        
        var $selectedRow;
        var $tableContainer = resultsPanel.$panel.find(".table-container")
            .on("click", "tr", function (e) {
                var $row = $(e.currentTarget);
                if ($selectedRow) {
                    $selectedRow.removeClass("selected");
                }
                $selectedRow = $row;
                $selectedRow.addClass("selected");
                
                if ($row.hasClass("file-section")) {
                    // Clicking the file section header collapses/expands result rows for that file
                    $row.nextUntil(".file-section").toggle();
                    
                    var $triangle = $(".disclosure-triangle", $row);
                    $triangle.toggleClass("expanded").toggleClass("collapsed");
                    
                } else {
                    // Clicking individual error jumps to that line of code
                    var startLine = parseInt($selectedRow.data("line")),
                        startCh   = parseInt($selectedRow.data("ch")),
                        endCh     = parseInt($selectedRow.data("endch")),
                        fullPath  = $selectedRow.data("fullpath");
                    
                    CommandManager.execute(Commands.FILE_OPEN, {fullPath: fullPath})
                        .done(function (doc) {
                            // Opened document is now the current main editor
                            EditorManager.getCurrentFullEditor().setSelection({line: startLine, ch: startCh}, {line: startLine, ch: endCh});
                            EditorManager.getCurrentFullEditor().focus();
                        });
                }
            });

        $("#allstrings-panel .close").click(function () {
            destroyPanel();
        });
        
        var tableHtml = Mustache.render(template, {fileList: fileList});
        $tableContainer.append(tableHtml);
        
        resultsPanel.$panel.find(".title").text(totalStrings + " string literals in " + fileList.length + " files");
        
        resultsPanel.show();
    }
    
    
    function isIgnoredString(token, lineText) {
        // Ignore empty string
        if (token.string === "\"\"") {
            return true;
        }

        // Ignore "use strict" alone on a line
        if (token.string.match(/^["']use strict["']$/) && lineText.match(/\s*["']use strict["'];\s*/)) {
            return true;
        }

        var match;
        // Ignore require("...")
        if ( (match = lineText.match(/^\s*((var\s+)?[a-zA-Z0-9_]+\s*=\s*)?require\(["'][^"]+["']\)/)) ) {
            if (token.start < match[0].length) {
                return true;
            }
        }

        // Ignore Object.defineProperty(..., "...", {
        if ( (match = lineText.match(/^\s*Object\.defineProperty\(\s*[^,"']+\s*,\s*["'][^"']+["']/)) ) {
            if (token.start < match[0].length) {
                return true;
            }
        }

        // Ignore new Error(...)
        if ( (match = lineText.match(/new Error\([^)]+\)/)) ) {
            if (token.start < match.index + match[0].length && token.start > match.index) {  // this regexp isn't anchored to start of line
                return true;
            }
        }

        // Ignore console.log/warn/error/assert(...)
        if ( (match = lineText.match(/\s*console\.(log|warn|error|assert)\([^)]+\)/)) ) {
            if (token.start < match[0].length) {
                return true;
            }
        }
        
        return false;
    }
    
    function findStringsInText(text) {
        var token;
        var it = TokenIterator.textIterator(text);
        var hits = [];
        while ( (token = it.next()) ) {
            if (token.type === "string") {
                if (!isIgnoredString(token, it.getLineText())) {
                    hits.push({
                        startPos: {line: token.line, ch: token.start},
                        endPos: {line: token.line, ch: token.end},
                        codeSnippet: token.string
                    });
                }
            }
        }
        return hits;
    }
    
    
    function getAllResults(progress) {
        var result = new $.Deferred();
        
        // Figure out what "all the things" actually are
        var filesToScan = [];
        ProjectManager.getAllFiles(ProjectManager.getLanguageFilter("javascript")).done(function (files) {
            files.forEach(function (file) {
                if (filter(file)) {
                    filesToScan.push(file);
                }
            });
            
            progress.begin(filesToScan.length);
            
            // Scan each file for string literals
            var results = {};
            function findStringsInFile(file) {
                return DocumentManager.getDocumentText(file).done(function (text) {
                    var hits = findStringsInText(text);
                    if (hits.length) {
                        results[file.fullPath] = hits;
                    }
                    progress.increment();
                });
            }
            
            Async.doInParallel(filesToScan, findStringsInFile, false).done(function () {
                result.resolve(results);
            });
        });
        
        return result.promise();
    }
    
    // (code borrowed from SLOC extension)
    function getExclusions() {
        var $textarea;
        
        var message = "Exclude files/folders containing any of these substrings (one per line):<br><textarea id='string-finder-excludes' style='width:400px;height:160px'></textarea>";
        var promise = Dialogs.showModalDialog(Dialogs.DIALOG_ID_ERROR, "String Finder", message);
        
        promise.done(function (btnId) {
            if (btnId === Dialogs.DIALOG_BTN_OK) {  // as opposed to dialog's "X" button
                var substrings = $textarea.val();
                filterStrings = substrings.split("\n");
                filterStrings = filterStrings.map(function (substr) {
                    return substr.trim();
                }).filter(function (substr) {
                    return substr !== "";
                });
                
                // Save to project-specific prefs if setting exists there; else global prefs
                prefs.set("exclusions", filterStrings, {context: projPrefsContext()});
            }
        });
        
        // store now since it'll be orphaned by the time done() handler runs
        $textarea = $("#string-finder-excludes");
        
        // prepopulate with last-used filter within session
        $textarea.val(prefs.get("exclusions", projPrefsContext()).join("\n"));
        $textarea.focus();
        
        return promise;
    }
    
    function findAllStrings() {
        if (resultsPanel) {  // close prev results, if any
            destroyPanel();
        }
        
        getExclusions().done(function (btnId) {
            if (btnId !== Dialogs.DIALOG_BTN_OK) {  // i.e. dialog's "X" button
                return;
            }
            
            StatusBar.showBusyIndicator();
            
            // TODO: show progress bar?
            var progressCallbacks = {
                begin: function (totalFiles) { console.log("Searching for strings in " + totalFiles + " files"); },
                increment: function () {}
            };
            
            getAllResults(progressCallbacks).done(function (results) {
                // Convert the results into a format digestible by showResult()
                var totalResults = 0,
                    fileList = [];
                
                _.forEach(results, function (oneResult, fullPath) {
                    var fileResult = {
                        fullPath: fullPath,
                        displayPath: ProjectManager.makeProjectRelativeIfPossible(fullPath),
                        strings: oneResult
                    };
                    fileResult.strings.forEach(function (result) {  // (code borrowed from CodeInspection)
                        result.friendlyLine = result.startPos.line + 1;
                        result.fullPath = fullPath;
                    });
                    fileList.push(fileResult);
                    totalResults += fileResult.strings.length;
                });
                
                if (totalResults === 0) {
                    Dialogs.showModalDialog(Dialogs.DIALOG_ID_ERROR, "String Finder", "Whoa - no string literals found!")
                        .done(function () { EditorManager.focusEditor(); });
                    
                } else {
                    showResult(fileList, totalResults);
                }
                
            })
                .always(function () { StatusBar.hideBusyIndicator(); });
        });
    }
    
    
    // (adapted from brackets.less)
    ExtensionUtils.addEmbeddedStyleSheet(
        "#allstrings-panel .disclosure-triangle {\
            background-image: url('styles/images/jsTreeSprites.svg');\
            background-repeat: no-repeat;\
            background-color: transparent;\
            vertical-align: middle;\
            width: 18px;\
            height: 18px;\
            display: inline-block;\
        }\
        #allstrings-panel .disclosure-triangle.expanded {\
            background-position: 7px 5px;\
            -webkit-transform: translateZ(0) rotate(90deg);\
        }\
        #allstrings-panel .disclosure-triangle.collapsed {\
            background-position: 7px 5px;\
        }"
    );
    
    
    var COMMAND_ID = "pflynn.find-all-strings";
    
    CommandManager.register("Find All String Literals", COMMAND_ID, findAllStrings);
    
    var menu = Menus.getMenu(Menus.AppMenuBar.FIND_MENU);
    menu.addMenuItem(COMMAND_ID, null, Menus.AFTER, Commands.CMD_FIND_IN_FILES);
});