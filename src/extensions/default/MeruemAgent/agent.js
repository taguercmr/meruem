/*
 * Agent turn loop: LLM ↔ tools (max rounds).
 */

define(function (require, exports, module) {
    "use strict";

    var ProjectManager = brackets.getModule("project/ProjectManager"),
        FileSystem     = brackets.getModule("filesystem/FileSystem"),
        llm            = require("./llm"),
        agentPrefs     = require("./prefs"),
        tools          = require("./tools");

    var MAX_ROUNDS = 6;

    function _loadRules() {
        var deferred = new $.Deferred();
        var root = ProjectManager.getProjectRoot();
        if (!root) {
            deferred.resolve("");
            return deferred.promise();
        }
        var file = FileSystem.getFileForPath(root.fullPath + ".meruem/rules.md");
        file.read(function (err, data) {
            if (err || !data) {
                deferred.resolve("");
            } else {
                deferred.resolve(String(data).slice(0, 8000));
            }
        });
        return deferred.promise();
    }

    function _baseSystem(rules) {
        var parts = [
            "Tu es Meruem Agent, assistant de code dans Meruem (UI Brackets / CodeMirror).",
            "Réponds de façon concise en français sauf si le code/commentaires sont en anglais.",
            tools.systemToolsBlurb()
        ];
        if (rules) {
            parts.push("Règles projet (.meruem/rules.md):\n" + rules);
        }
        return parts.join("\n\n");
    }

    /**
     * @param {Object} opts
     * @param {string} opts.userText
     * @param {Array} opts.history - prior {role,content} without system
     * @param {string=} opts.editorContext
     * @param {function(string)=} opts.onStatus
     * @param {function(Object)=} opts.onPatch - write_file proposal
     * @param {function(string,string)=} opts.onTool - (name, resultPreview)
     * @return {$.Promise} resolves { reply, historyDelta }
     */
    function runTurn(opts) {
        var deferred = new $.Deferred();
        var cfg = agentPrefs.getConfig();
        var historyDelta = [];
        var messages = [];

        _loadRules().done(function (rules) {
            messages.push({ role: "system", content: _baseSystem(rules) });
            (opts.history || []).forEach(function (m) {
                messages.push(m);
            });

            var userContent = opts.userText;
            if (opts.editorContext) {
                userContent += "\n\n[Contexte éditeur]\n" + opts.editorContext;
            }
            messages.push({ role: "user", content: userContent });
            historyDelta.push({ role: "user", content: opts.userText });

            var round = 0;

            function step() {
                round++;
                if (opts.onStatus) {
                    opts.onStatus("LLM round " + round + "…");
                }
                if (round > MAX_ROUNDS) {
                    deferred.resolve({
                        reply: "Limite d’outils atteinte. Reformule ou précise le chemin.",
                        historyDelta: historyDelta
                    });
                    return;
                }

                llm.chatCompletions({
                    baseUrl: cfg.baseUrl,
                    model: cfg.model,
                    apiKey: cfg.apiKey,
                    messages: messages
                })
                    .done(function (reply) {
                        var call = tools.parseToolCall(reply);
                        if (!call) {
                            historyDelta.push({ role: "assistant", content: reply });
                            deferred.resolve({ reply: reply, historyDelta: historyDelta });
                            return;
                        }

                        messages.push({ role: "assistant", content: reply });

                        if (call.name === "write_file") {
                            tools.runTool("write_file", call.arguments).done(function (proposal) {
                                if (proposal.error) {
                                    var errText = JSON.stringify(proposal);
                                    messages.push({
                                        role: "user",
                                        content: "Résultat outil write_file:\n" + errText
                                    });
                                    if (opts.onTool) {
                                        opts.onTool("write_file", errText);
                                    }
                                    step();
                                    return;
                                }
                                if (opts.onPatch) {
                                    opts.onPatch(proposal);
                                }
                                var ack =
                                    "Patch proposé pour " + proposal.path +
                                    " (en attente Accept/Reject utilisateur). " +
                                    "Ne réécris pas le fichier; résume brièvement le changement.";
                                messages.push({ role: "user", content: ack });
                                if (opts.onTool) {
                                    opts.onTool("write_file", proposal.path);
                                }
                                step();
                            });
                            return;
                        }

                        tools.runTool(call.name, call.arguments).done(function (result) {
                            var text = typeof result === "string" ? result : JSON.stringify(result);
                            if (text.length > 20000) {
                                text = text.slice(0, 20000) + "\n…[tronqué]";
                            }
                            if (opts.onTool) {
                                opts.onTool(call.name, text.slice(0, 120));
                            }
                            messages.push({
                                role: "user",
                                content: "Résultat outil " + call.name + ":\n" + text
                            });
                            step();
                        });
                    })
                    .fail(function (err) {
                        deferred.reject(err);
                    });
            }

            step();
        });

        return deferred.promise();
    }

    exports.runTurn = runTurn;
});
