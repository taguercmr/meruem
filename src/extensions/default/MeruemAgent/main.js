/*
 * Meruem Agent — Phase 1
 * Bottom panel chat + local LLM + workspace tools + Accept/Reject writes.
 */

define(function (require, exports, module) {
    "use strict";

    var AppInit            = brackets.getModule("utils/AppInit"),
        CommandManager     = brackets.getModule("command/CommandManager"),
        Commands           = brackets.getModule("command/Commands"),
        Menus              = brackets.getModule("command/Menus"),
        WorkspaceManager   = brackets.getModule("view/WorkspaceManager"),
        ExtensionUtils     = brackets.getModule("utils/ExtensionUtils"),
        KeyBindingManager  = brackets.getModule("command/KeyBindingManager"),
        EditorManager      = brackets.getModule("editor/EditorManager"),
        DocumentManager    = brackets.getModule("document/DocumentManager"),
        Dialogs            = brackets.getModule("widgets/Dialogs"),
        DefaultDialogs     = brackets.getModule("widgets/DefaultDialogs"),
        llm                = require("./llm"),
        agentPrefs         = require("./prefs"),
        agent              = require("./agent"),
        tools              = require("./tools");

    var PANEL_ID   = "meruem.agent.panel",
        CMD_TOGGLE = "meruem.agent.togglePanel",
        CMD_PREFS  = "meruem.agent.configure",
        CMD_OLLAMA = "meruem.agent.provider.ollama",
        CMD_LMS    = "meruem.agent.provider.lmstudio",
        panelHtml  = require("text!./html/panel.html"),
        panel      = null,
        $panel     = null,
        $messages  = null,
        $input     = null,
        $status    = null,
        $send      = null,
        $patchBox  = null,
        $patchPath = null,
        $patchPrev = null,
        history    = [],
        busy       = false,
        pendingPatch = null;

    ExtensionUtils.loadStyleSheet(module, "styles/agent.css");

    function _scrollToBottom() {
        if ($messages && $messages[0]) {
            $messages[0].scrollTop = $messages[0].scrollHeight;
        }
    }

    function appendMessage(role, text) {
        if (!$messages) {
            return;
        }
        var $msg = $("<div>").addClass("meruem-agent-msg meruem-agent-msg-" + role);
        if (role === "assistant") {
            $msg.append($("<span>").addClass("meruem-agent-role").text("Agent"));
        }
        $msg.append(document.createTextNode(text));
        $messages.append($msg);
        _scrollToBottom();
    }

    function _refreshStatus(extra) {
        var cfg = agentPrefs.getConfig();
        var label = agentPrefs.statusLabel(cfg);
        if ($status) {
            $status.text(extra ? (label + " · " + extra) : label);
        }
    }

    function _editorContextHint() {
        var editor = EditorManager.getActiveEditor();
        if (!editor) {
            return "";
        }
        var doc = editor.document;
        var path = doc && doc.file ? doc.file.fullPath : "";
        var name = path ? path.split(/[/\\]/).pop() : "(sans fichier)";
        var sel = editor.getSelectedText();
        if (sel && sel.length) {
            var preview = sel.length > 120 ? sel.slice(0, 120) + "…" : sel;
            return "Fichier actif : " + name + "\nSélection :\n" + preview;
        }
        return "Fichier actif : " + name;
    }

    function _showPatch(proposal) {
        pendingPatch = proposal;
        if (!$patchBox) {
            return;
        }
        $patchPath.text(proposal.path + (proposal.isNew ? " (nouveau)" : ""));
        var preview = proposal.content || "";
        if (preview.length > 4000) {
            preview = preview.slice(0, 4000) + "\n…";
        }
        $patchPrev.text(preview);
        $patchBox.prop("hidden", false);
    }

    function _hidePatch() {
        pendingPatch = null;
        if ($patchBox) {
            $patchBox.prop("hidden", true);
            $patchPrev.text("");
            $patchPath.text("");
        }
    }

    function acceptPatch() {
        if (!pendingPatch) {
            return;
        }
        var patch = pendingPatch;
        tools.apply_write(patch.abs, patch.content)
            .done(function () {
                appendMessage("system", "Accepté : " + patch.path);
                var doc = DocumentManager.getOpenDocumentForPath(patch.abs);
                if (doc) {
                    doc.refreshText(patch.content, new Date());
                }
                CommandManager.execute(Commands.FILE_REFRESH);
                _hidePatch();
            })
            .fail(function (err) {
                appendMessage("system", "Écriture échouée : " + err);
            });
    }

    function rejectPatch() {
        if (!pendingPatch) {
            return;
        }
        appendMessage("system", "Rejeté : " + pendingPatch.path);
        _hidePatch();
    }

    function _setBusy(isBusy) {
        busy = isBusy;
        if ($send) {
            $send.prop("disabled", isBusy);
        }
        if ($input) {
            $input.prop("disabled", isBusy);
        }
    }

    function sendMessage() {
        if (!$input || busy) {
            return;
        }
        var text = String($input.val() || "").trim();
        if (!text) {
            return;
        }

        appendMessage("user", text);
        $input.val("");
        _setBusy(true);
        _refreshStatus("agent…");

        agent.runTurn({
            userText: text,
            history: history.slice(),
            editorContext: _editorContextHint(),
            onStatus: function (s) {
                _refreshStatus(s);
            },
            onTool: function (name, preview) {
                appendMessage("tool", "⚙ " + name + (preview ? " — " + preview : ""));
            },
            onPatch: function (proposal) {
                _showPatch(proposal);
            }
        })
            .done(function (result) {
                (result.historyDelta || []).forEach(function (m) {
                    history.push(m);
                });
                if (history.length > 24) {
                    history = history.slice(-24);
                }
                appendMessage("assistant", result.reply || "(vide)");
                _refreshStatus("ok");
            })
            .fail(function (err) {
                var msg = (err && err.message) ? err.message : String(err);
                appendMessage(
                    "assistant",
                    "Impossible de joindre le LLM local.\n" +
                        msg +
                        "\n\nVérifie Ollama / LM Studio, puis LLM…"
                );
                _refreshStatus("erreur");
            })
            .always(function () {
                _setBusy(false);
                if ($input) {
                    $input.focus();
                }
            });
    }

    function clearConversation() {
        history = [];
        _hidePatch();
        if (!$messages) {
            return;
        }
        $messages.empty();
        appendMessage(
            "system",
            "Conversation effacée. Préférences LLM inchangées (meruemAgent)."
        );
        _refreshStatus();
    }

    function _probeProvider() {
        var cfg = agentPrefs.getConfig();
        _refreshStatus("probe…");
        llm.listModels(cfg.baseUrl, cfg.apiKey)
            .done(function (models) {
                _refreshStatus(models.length ? ("connecté (" + models.length + " modèles)") : "connecté");
            })
            .fail(function () {
                _refreshStatus("hors ligne");
            });
    }

    function configureDialog() {
        var cfg = agentPrefs.getConfig();
        var html =
            "<div class='meruem-agent-prefs'>" +
            "<p>Provider local OpenAI-compatible (<code>meruemAgent</code> prefs).</p>" +
            "<label>Provider<br><select id='ma-provider'>" +
            "<option value='ollama'>Ollama (11434)</option>" +
            "<option value='lmstudio'>LM Studio (1234)</option>" +
            "<option value='custom'>Custom</option>" +
            "</select></label><br><br>" +
            "<label>Base URL<br><input id='ma-base' type='text' style='width:100%'></label><br><br>" +
            "<label>Modèle<br><input id='ma-model' type='text' style='width:100%'></label><br><br>" +
            "<label>API key<br><input id='ma-key' type='text' style='width:100%'></label>" +
            "</div>";

        var dialog = Dialogs.showModalDialog(
            DefaultDialogs.DIALOG_ID_INFO,
            "Meruem Agent — LLM local",
            html,
            [
                { className: Dialogs.DIALOG_BTN_CLASS_NORMAL, id: Dialogs.DIALOG_BTN_CANCEL, text: "Annuler" },
                { className: Dialogs.DIALOG_BTN_CLASS_PRIMARY, id: Dialogs.DIALOG_BTN_OK, text: "Enregistrer" }
            ]
        );

        var $dlg = dialog.getElement();
        $dlg.find("#ma-provider").val(cfg.provider);
        $dlg.find("#ma-base").val(cfg.baseUrl);
        $dlg.find("#ma-model").val(cfg.model);
        $dlg.find("#ma-key").val(cfg.apiKey);

        $dlg.find("#ma-provider").on("change", function () {
            var preset = llm.PRESETS[$(this).val()];
            if (preset) {
                $dlg.find("#ma-base").val(preset.baseUrl);
                $dlg.find("#ma-model").val(preset.model);
            }
        });

        dialog.done(function (id) {
            if (id !== Dialogs.DIALOG_BTN_OK) {
                return;
            }
            agentPrefs.prefs.set("provider", String($dlg.find("#ma-provider").val() || "ollama"));
            agentPrefs.prefs.set("baseUrl", String($dlg.find("#ma-base").val() || "").trim());
            agentPrefs.prefs.set("model", String($dlg.find("#ma-model").val() || "").trim());
            agentPrefs.prefs.set("apiKey", String($dlg.find("#ma-key").val() || "").trim() || "local");
            agentPrefs.prefs.save();
            _refreshStatus();
            _probeProvider();
        });
    }

    function _setProvider(provider) {
        agentPrefs.applyProviderPreset(provider);
        _refreshStatus();
        _probeProvider();
        appendMessage("system", "Provider : " + agentPrefs.statusLabel(agentPrefs.getConfig()));
    }

    function _setVisible(visible) {
        if (!panel) {
            return;
        }
        if (visible) {
            panel.show();
            _refreshStatus();
            _probeProvider();
            if ($input) {
                $input.focus();
            }
        } else {
            panel.hide();
        }
        var cmd = CommandManager.get(CMD_TOGGLE);
        if (cmd) {
            cmd.setChecked(visible);
        }
    }

    function togglePanel() {
        if (!panel) {
            return;
        }
        _setVisible(!panel.isVisible());
    }

    function _wireUi() {
        $messages  = $panel.find("#meruem-agent-messages");
        $input     = $panel.find("#meruem-agent-input");
        $status    = $panel.find("#meruem-agent-status");
        $send      = $panel.find("#meruem-agent-send");
        $patchBox  = $panel.find("#meruem-agent-patch");
        $patchPath = $panel.find("#meruem-agent-patch-path");
        $patchPrev = $panel.find("#meruem-agent-patch-preview");

        $panel.find("#meruem-agent-close").on("click", function (e) {
            e.preventDefault();
            _setVisible(false);
        });
        $panel.find("#meruem-agent-clear").on("click", function (e) {
            e.preventDefault();
            clearConversation();
        });
        $panel.find("#meruem-agent-settings").on("click", function (e) {
            e.preventDefault();
            configureDialog();
        });
        $panel.find("#meruem-agent-patch-accept").on("click", function (e) {
            e.preventDefault();
            acceptPatch();
        });
        $panel.find("#meruem-agent-patch-reject").on("click", function (e) {
            e.preventDefault();
            rejectPatch();
        });
        $send.on("click", function (e) {
            e.preventDefault();
            sendMessage();
        });
        $input.on("keydown", function (e) {
            if (e.keyCode === 13 && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        _refreshStatus();
    }

    function _createPanel() {
        $panel = $(panelHtml);
        panel = WorkspaceManager.createBottomPanel(PANEL_ID, $panel, 200);
        _wireUi();
    }

    function _registerCommands() {
        CommandManager.register("Meruem Agent", CMD_TOGGLE, togglePanel);
        CommandManager.register("Configurer LLM Meruem…", CMD_PREFS, configureDialog);
        CommandManager.register("Provider : Ollama", CMD_OLLAMA, function () { _setProvider("ollama"); });
        CommandManager.register("Provider : LM Studio", CMD_LMS, function () { _setProvider("lmstudio"); });

        KeyBindingManager.addBinding(CMD_TOGGLE, [
            {key: "Ctrl-Shift-M"},
            {key: "Cmd-Shift-M", platform: "mac"}
        ]);

        var viewMenu = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU);
        viewMenu.addMenuDivider();
        viewMenu.addMenuItem(CMD_TOGGLE, null, Menus.AFTER, Commands.VIEW_HIDE_SIDEBAR);
        viewMenu.addMenuItem(CMD_PREFS);
        viewMenu.addMenuItem(CMD_OLLAMA);
        viewMenu.addMenuItem(CMD_LMS);
    }

    AppInit.htmlReady(function () {
        _createPanel();
    });

    AppInit.appReady(function () {
        _registerCommands();
    });

    exports.togglePanel = togglePanel;
    exports.appendMessage = appendMessage;
    exports.sendMessage = sendMessage;
    exports.configureDialog = configureDialog;
});
